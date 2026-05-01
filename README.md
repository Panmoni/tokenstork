# TokenStork

**An authoritative, self-hosted directory and explorer for every BCH CashToken ever minted.**

Live at <https://tokenstork.com>.

TokenStork indexes every fungible (FT) and non-fungible (NFT) CashToken category created since activation at block **792,772** (May 2023) and keeps the list continuously up to date as new tokens are minted and existing ones are (partially or fully) burned. For each category it serves supply, holders, NFT instances, BCMR metadata, and market data across the AMMs (Cauldron + Fex) and the P2P marketplace (Tapswap).

The entire pipeline runs on a single VPS. There is no dependency on Chaingraph, third-party BlockBook, or any other external blockchain indexer — TokenStork runs its own archival BCHN, its own BlockBook instance, and its own Postgres. The BCH ecosystem already has several token explorers; this is one open-source take, hosted directly by the team that publishes it.

---

## Status

**v0.1.1**, in production. SvelteKit app, Postgres schema, HTTP API, and all ten Rust sync workers are live and feeding the directory, including the BlockBook-dependent enrichment pass — per-category holders, live UTXO counts, and fully-burned detection are populated from a paginated tx-history walk (the fork's `/api/v2/utxo/<category>` endpoint returns empty, so we reconstruct the live UTXO set from token-bearing vouts whose `spent` flag is not set). Holder counts surface on the directory grid and the per-category detail page now shows a top-holders table with %-of-supply.

See [docs/cashtoken-index-plan.md](docs/cashtoken-index-plan.md) (gitignored — local copy) for the full rollout plan and progress log.

---

## Architecture

Everything runs on one Netcup RS 2000 G12 VPS (8 EPYC cores, 16 GB ECC, 512 GB NVMe). No cross-host latency, no third-party indexer dependency.

| Component | Role | Listens on |
|---|---|---|
| Archival **BCHN** v29 (`prune=0`, `txindex=1`) | Source of truth on-chain. Feeds BlockBook; wakes the tail worker via ZMQ; serves `scantxoutset` to the venue scanners. | `127.0.0.1:8332` (RPC) + `127.0.0.1:28332` (ZMQ) |
| **BlockBook** (mainnet-pat fork, `cashtokens` branch) | Category-indexed rich-data API: holders, NFTs per category, transfers, BCMR. | `127.0.0.1:9131` |
| **Postgres 17** | Cached directory and UI backend state. | `127.0.0.1:5432` (Unix socket, peer auth) |
| **SvelteKit app** (Node adapter, Svelte 5 runes) | UI + JSON API, SSR. | `127.0.0.1:3000` behind Caddy |
| **Sync workers** (Rust crate) | Populate Postgres from BCHN + BlockBook + venue scans. | systemd services + timers |
| **Caddy** | TLS termination, HSTS/CSP/XFO, reverse proxy. | `0.0.0.0:443` |

**External data sources** are confined to two narrow surfaces:

- **BCMR metadata** (names, symbols, icons) from [Paytaca's BCMR indexer](https://github.com/paytaca/bcmr-indexer) and published BCMR JSON feeds, polled every 4 h and cached in `token_metadata`.
- **Cauldron price / TVL** from [`indexer.cauldron.quest`](https://indexer.cauldron.quest), polled every 4 h (full discovery) + every 10 min (fast price refresh) and cached in `token_venue_listings`.

**Tapswap** (P2P fixed-price listings via the MPSW OP_RETURN protocol) and **Fex.cash** (UniswapV2-style AMM via the AssetCovenant P2SH) are detected on-chain from our own BCHN — no external API.

---

## Repository layout

```
db/schema.sql              Idempotent Postgres schema. CREATE TABLE IF NOT EXISTS only.
src/                       SvelteKit app (Svelte 5 + Node adapter).
  routes/
    +page.server.ts        Directory front page (server-side DB read).
    token/[category]/      Per-category detail page with holders + venues + BCMR.
    moderated/             Public list of categories filtered out of the directory.
    stats/                 Ecosystem dashboard (counts, growth, venue overlap).
    learn/ faq/ roadmap/ about/ tos/   Static pages.
    api/tokens/            Directory + per-category holders/nfts/report endpoints.
    api/bchPrice/          BCH spot price proxy (CryptoCompare).
  lib/
    components/            Svelte 5 components (TokenGrid, MetricsBar, Sparkline, …).
    server/db.ts           pg pool + hex ↔ BYTEA helpers.
    server/external.ts     BCMR + Cauldron clients (timed, hex-validated).
    venues.ts              Single source of truth for the {cauldron, tapswap, fex} venues.
    moderation.ts          NOT_MODERATED_CLAUSE shared across every read path.
    types.ts               TokenApiRow + venue listing shapes.
workers/                   Rust crate. cargo build --release produces 10 binaries.
  src/{bchn,bcmr,blockbook,cauldron,fex,pg,tapswap,tapswap_walker}.rs   Library modules.
  src/bin/{backfill,bcmr,cauldron,cauldron-stats,enrich,fex,tail,
           tapswap-backfill,tapswap-spend-backfill,verify}.rs   Binaries.
infra/
  Caddyfile                Reverse proxy + CSP/HSTS/XFO.
  redeploy.sh              One-shot deploy: git pull → pnpm + cargo build → schema → systemd.
  systemd/                 Service + timer units for tokenstork.service + every worker.
  blockbook-resetinconsistentstate.patch   Local patch for mainnet-pat/blockbook recovery.
public/.well-known/bitcoin-cash-metadata-registry.json   Self-hosted BCMR.
scripts/                   Legacy TypeScript sync prototypes — superseded by workers/.
```

---

## Data model

Schema is idempotent and lives in [db/schema.sql](db/schema.sql). Every `CREATE TABLE` is `IF NOT EXISTS`, every column add is `ADD COLUMN IF NOT EXISTS` — re-running `pnpm run db:init` on a deployed instance is safe.

Core tables:

- **`tokens`** — canonical category record keyed by `category BYTEA` (32-byte raw).
- **`token_metadata`** — BCMR-derived name / symbol / decimals / description / icon, with a `pg_trgm` GIN index on `name` for cheap ILIKE search.
- **`token_state`** — current supply (`NUMERIC(78,0)`), live UTXO count, NFT count, holder count, minting flag, burn flag.
- **`token_holders`** — `(category, address)` with balance and NFT count.
- **`nft_instances`** — `(category, commitment)` with capability and owner.
- **`sync_state`** — singleton row tracking backfill / tail / enrich / verify / bcmr / cauldron / tapswap / fex run timestamps.

Venue + market tables:

- **`token_venue_listings`** — keyed by `(venue, category)`; `price_sats DOUBLE PRECISION`, `tvl_satoshis NUMERIC(30,0)`. **Unit convention**: `tvl_satoshis` is single-side BCH-reserve sats for AMM venues; the UI applies `× 2` at render to reflect both halves of a constant-product pool. One unambiguous unit across `cauldron` + `fex`.
- **`token_price_history`** — `(category, venue, ts, price_sats, tvl_satoshis)`. One row per successful Cauldron / Fex fetch. Drives the directory's 1h / 24h / 7d % change columns + the 7-day sparkline column.
- **`tapswap_offers`** — one row per on-chain MPSW listing. `has_*` columns describe what the maker offers, `want_*` columns describe what they want. `status IN ('open','taken','cancelled')`; day-one ships open offers only.
- **`token_moderation`** — keyed by `category`; `reason` (public) + `moderator_note` (operator-private) + `hidden_at`. Categories present in this table 410 from `/token/[hex]` and are filtered from every read path via `NOT_MODERATED_CLAUSE` in `src/lib/moderation.ts`.
- **`token_reports`** — incoming user reports against problematic tokens. Triaged by hand into `token_moderation` decisions.

Two design decisions worth calling out:

- `category` and `genesis_txid` are stored as raw `BYTEA`, not hex text — half the storage, faster comparisons. Hex encoding happens at the API boundary in [src/lib/server/db.ts](src/lib/server/db.ts).
- `NUMERIC(78,0)` comfortably holds any CashToken fungible amount and **must be stringified at the UI boundary** — JS numbers lose precision above 2^53.

Deploy:

```
pnpm run db:init    # psql "$DATABASE_URL" -f db/schema.sql
```

---

## HTTP API

All endpoints return JSON. Response shapes are stable.

| Endpoint | Purpose |
|---|---|
| `GET /api/tokens` | Directory listing (paginated, search across name + symbol + description + category, venue filters). |
| `GET /api/tokens/[category]/holders` | Holders for a category, ordered by balance. |
| `GET /api/tokens/[category]/nfts` | NFT instances in a category. |
| `POST /api/tokens/[category]/report` | Submit a user report for moderation review. Rate-limited; webhook-alerts the operator. |
| `GET /api/bchPrice` | BCH spot price (CryptoCompare, cached). |

Page routes (`/`, `/token/[category]`, `/stats`, `/moderated`, `/learn`, `/faq`, `/roadmap`, `/about`, `/tos`) all render server-side from Postgres on every request — no client-side hydration of the data. The BCH price + theme switcher are the only client-state pieces.

---

## Local development

Prerequisites: Node 22, Postgres 17, Rust 1.75+ (only if you want to run the workers locally).

```
git clone https://github.com/Panmoni/tokenstork.git
cd tokenstork
pnpm install --frozen-lockfile

createdb tokenstork
export DATABASE_URL="postgres:///tokenstork"
pnpm run db:init

pnpm run dev           # http://localhost:5173
```

The app runs fine against an empty schema — every loader handles the no-data case. To populate, you'll need a reachable BCH node + the workers crate built:

```
cd workers && cargo build --release
# Binaries land in workers/target/release/{backfill,bcmr,cauldron,fex,tail,tapswap-backfill,verify}
```

**Environment variables** (only `DATABASE_URL` is required by the app):

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. Unix-socket form works: `postgres:///tokenstork`. |
| `CRYPTO_COMPARE_KEY` | no | Unlocks `/api/bchPrice`; returns `null` when absent. |
| `BCHN_RPC_URL`, `BCHN_RPC_AUTH`, `BCHN_ZMQ_URL` | worker-only | Needed by `workers/`; not by the app. |
| `BLOCKBOOK_URL` | worker-only | Needed by the enrich + verify workers. |
| `CAULDRON_URL`, `CAULDRON_MAX_RPS`, `CAULDRON_MODE` | worker-only | Cauldron client knobs; `CAULDRON_MODE=fast` selects the 10-min listed-set refresh path. |
| `TOKENSTORK_REPORT_WEBHOOK` | optional | Operator webhook hit on each `/api/tokens/[category]/report` POST. |

**Useful scripts:**

```
pnpm run dev           # Vite dev server
pnpm run build         # production build (output in build/)
pnpm run start         # node build  — what systemd runs
pnpm run check         # svelte-check + tsc
pnpm run db:init       # apply db/schema.sql idempotently
```

The legacy `pnpm run sync:*` commands run the [scripts/](scripts/) TypeScript prototypes; they predate the Rust port and are kept only as a fallback path.

---

## Production deployment

All of the moving parts are checked in:

- [infra/Caddyfile](infra/Caddyfile) — reverse proxy, caching rules, full CSP/HSTS/XFO header chain. Assumes Cloudflare proxy in front with SSL/TLS **Full (strict)** and a Cloudflare Origin Certificate on disk at `/etc/caddy/tls/`. Comments at the top explain how to swap in Let's Encrypt for a non-CF deploy.
- [infra/systemd/](infra/systemd/) — hardened unit files for `tokenstork.service`, `blockbook-bcash.service`, `sync-tail.service` (always-on with `Type=notify` + `WatchdogSec=120s`), `sync-bcmr.{service,timer}`, `sync-cauldron{,-fast}.{service,timer}`, `sync-fex.{service,timer}`, `sync-enrich.{service,timer}`, `sync-verify.{service,timer}`, `sync-tapswap-backfill.service`. Same hardening profile across the board: `ProtectSystem=strict`, `CapabilityBoundingSet=`, filtered syscalls, `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6`.
- [infra/redeploy.sh](infra/redeploy.sh) — one-shot deploy script: `git pull`, `pnpm install --frozen-lockfile && pnpm run build`, `cargo build --release`, schema apply, systemd unit refresh + `daemon-reload`, Caddyfile validate + sync, restart `tokenstork.service` + always-on workers.
- Secrets load from `/etc/tokenstork/env` (chmod 600, owner `tokenstork`).

The step-by-step VPS runbook — BCHN install, Postgres tuning, UFW, fail2ban, Caddy + Cloudflare Origin Cert, systemd, smoke tests — lives in [docs/cashtoken-index-plan.md](docs/cashtoken-index-plan.md) under Phase 2a. The BlockBook install runbook (including the `-resetinconsistentstate` recovery patch and the memory-cap rationale) is at [docs/blockbook-install.md](docs/blockbook-install.md).

---

## Indexing pipeline

Ten cooperating workers, all in the Rust [workers/](workers/) crate. Each is idempotent and crash-safe.

| Worker | Trigger | Job |
|---|---|---|
| **backfill** | one-shot (~25 min after BCHN IBD) | Walk blocks 792,772 → tip via BCHN RPC. Insert every new CashToken category into `tokens`. |
| **tail** | always-on, ZMQ-driven | Subscribe to `hashblock`; on each new block, run three walkers — token discovery, Tapswap MPSW listing detection, and Tapswap close detection (open → taken/cancelled). Sub-second latency from block arrival to DB row. `Type=notify` + `WatchdogSec=120s` for liveness. |
| **bcmr** | every 4 h | Pull names / symbols / decimals / icons from Paytaca's BCMR indexer. Refresh `token_metadata`. |
| **cauldron** (full mode) | every 4 h | Walk every FT category, fetch price + TVL from `indexer.cauldron.quest`, upsert `token_venue_listings`, prune stale rows, append a `token_price_history` point per success. |
| **cauldron** (fast mode) | every 10 min | Refresh price + TVL only for already-listed categories. Skips pruning — the listed-set view can't confirm delistings of unlisted categories. |
| **cauldron-stats** | every 30 min | Pull ecosystem aggregates (total TVL, 24h/7d/30d swap volume, pool counts, unique-addresses-by-month) from Cauldron's global endpoints; cache in `cauldron_global_stats` for `/stats` SSR. Read-modify-write: per-endpoint failure preserves the prior value rather than overwriting with zero. |
| **fex** | every 4 h | One `scantxoutset raw(<asset_covenant_p2sh>)` against BCHN; decode each Fex pool UTXO; upsert with `venue='fex'`; prune; append history. |
| **tapswap-backfill** | one-shot | Cold-walk blocks 794,520 → tip looking for MPSW OP_RETURN listings. Resumable via `sync_state.last_tapswap_backfill_through`; each block range checkpointed. |
| **tapswap-spend-backfill** | one-shot | Cold-walk 794,520 → tip looking for spend events to retroactively close listings populated by the listing-backfill before the lifecycle walker shipped. Reuses `tapswap_walker::process_block_spends` — the same code the live tail walker uses, so historical and live processing are guaranteed to agree. |
| **enrich** | every 6 h | For each known category, walk BlockBook's address history (`/api/v2/address/<category>?details=txs`, paginated, double-fetched to dodge truncated responses) and reconstruct the live token-bearing UTXO set. Refresh `token_state.holder_count`, `live_utxo_count`, `live_nft_count`, `is_fully_burned`, plus `token_holders` and `nft_instances`. OP_RETURN-locked vouts are skipped during holder aggregation. |
| **verify** | weekly | Sample reconciliation between BCHN and BlockBook (using the same tx-history walk path as enrich). Flags drift. |

Current Postgres-resident state is tracked in the `sync_state` singleton row — every worker writes a `last_<phase>_run_at` timestamp at the end of each run, so a staleness watchdog can spot a silently-stuck worker independently of block cadence.

---

## Data freshness

How quickly each kind of data on the site reflects on-chain reality. Same information as the indexing-pipeline table above but framed by what a visitor actually sees.

| What you see on the site | Source worker | Typical lag | Notes |
|---|---|---|---|
| **New token category appears in the directory** | `sync-tail` (ZMQ-driven) | sub-second | A `hashblock` notification from BCHN wakes the tail worker; the new row is in Postgres before the next block arrives. |
| **Token name / symbol / icon (BCMR metadata)** | `sync-bcmr` (4 h timer) | 0-4 h | Names land on first-fire after a category is minted. Until then, the directory shows the bare hex. |
| **Cauldron per-token price + TVL** | `sync-cauldron` (4 h full + 10 min fast) | 0-10 min for already-listed; 0-4 h for newly-listed | `fast` mode re-queries the ~317-token already-listed set every 10 min; `full` mode re-discovers every 4 h. |
| **Cauldron ecosystem aggregates on `/stats`** (total TVL, 24h/7d/30d volume, pool counts, unique addresses by month) | `sync-cauldron-stats` (30 min timer) | 0-30 min | Cached in `cauldron_global_stats` so the SSR loader doesn't pay a network round-trip per page hit. |
| **Fex per-pool price + TVL** | `sync-fex` (4 h timer) | 0-4 h | One `scantxoutset` per tick walks all Fex pools at once. |
| **Tapswap new open listing appears** | `sync-tail` (ZMQ-driven, Pass 2) | sub-second | The MPSW OP_RETURN at `outputs[1]` is detected on the same block-fetch the tokens walker uses. |
| **Tapswap listing transitions `open → taken / cancelled`** | `sync-tail` (ZMQ-driven, Pass 3) | sub-second | Detects the spending transaction's contract input + classifies by inspecting `vout[0]`'s recipient PKH. |
| **Cross-venue spreads on `/arbitrage`** | derived from the above on every page render | matches whichever underlying source is freshest | Pure SQL CTE; no separate worker. |
| **Sparkline + 1h / 24h / 7d % change columns** | `token_price_history` (one row per `sync-cauldron` fetch) | accumulates 6 points / day / token | Sparklines need ~7 days of history to fully populate; first hours after deploy show partial data. |
| **Holders / NFT instances / fully-burned flag** | `sync-enrich` (6 h timer) | 0-6 h | Holder counts surface on the directory grid; the per-category detail page renders a top-holders table sorted numerically with a %-of-supply column. |

**BCH spot price** (the `$X.XX` in the header) is fetched from CryptoCompare on each request, cached at the SvelteKit-app process level for ~60 seconds. Independent of the indexer pipeline.

**The general rule**: anything blockchain-ZMQ-driven (token discovery, Tapswap listings + closes) is sub-second. Anything timer-driven runs at the cadence in the table above.

---

## BCMR

TokenStork publishes its own Bitcoin Cash Metadata Registry at:

<https://tokenstork.com/.well-known/bitcoin-cash-metadata-registry.json>

The file lives in the repo at [public/.well-known/bitcoin-cash-metadata-registry.json](public/.well-known/bitcoin-cash-metadata-registry.json).

---

## Contributing

Issues and PRs welcome at <https://github.com/Panmoni/tokenstork>. The architectural plan and progress log live in [docs/cashtoken-index-plan.md](docs/cashtoken-index-plan.md) (gitignored locally — ask if you need a current snapshot). Public-roadmap framing of the same lives at [/roadmap](https://tokenstork.com/roadmap).

Before opening a PR, please run:

```
pnpm run check                         # svelte-check + tsc
pnpm run build                         # adapter-node output
cd workers && cargo test --release --lib && cargo clippy --all-targets --release
```

If your change touches a worker, the heavy-duty 3-pass review skill in `.claude/skills/heavy-duty-review/` is a good way to self-review the diff before opening a PR — it catches financial-correctness issues, race conditions, and TVL-unit-style cross-file invariants that are easy to miss.

---

## Credits

- [@mainnet_pat](https://github.com/mainnet-pat) — the `cashtokens` BlockBook fork that every CashToken-aware explorer depends on, and the Tapswap MPSW protocol whose on-chain reference implementation we reverse-engineered against.
- [Paytaca](https://github.com/paytaca/bcmr-indexer) — BCMR indexer API, the source of authoritative CashToken metadata.
- [Cauldron](https://cauldron.quest) — the public AMM indexer that drives our price + TVL columns.
- [Fex.cash](https://docs.fex.cash/) — open-source UniswapV2-style AMM with parameter-free covenants that let us index the full ecosystem in a single `scantxoutset` call.
- [@mr-zwets](https://github.com/mr-zwets) — early encouragement and technical guidance.

Original release announcement: <https://twitter.com/BitcoinCashSite/status/1687565837169819648>

---

## License

MIT © 2023-2026 [Panmoni](https://panmoni.com). See [LICENSE](LICENSE).
