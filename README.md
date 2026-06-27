# TokenStork

**An authoritative, self-hosted directory and explorer for every BCH CashToken ever minted.**

Live at <https://tokenstork.com>.

TokenStork indexes every fungible (FT) and non-fungible (NFT) CashToken category created since activation at block **792,772** (May 2023) and keeps the list continuously up to date as new tokens are minted and existing ones are (partially or fully) burned. For each category it serves supply, holders, NFT instances, BCMR metadata, and market data across the AMMs (Cauldron + Fex) and the P2P marketplace (Tapswap).

The entire pipeline runs on a single VPS. There is no dependency on any external blockchain indexer — TokenStork runs its own archival BCHN and its own Postgres, self-indexing everything directly from the node via the event-driven `sync-tail` daemon. The BCH ecosystem already has several token explorers; this is one open-source take, hosted directly by the team that publishes it.

---

## Status

**v0.1.4**, in production. SvelteKit app, Postgres schema, HTTP API, and all Rust sync workers are live and feeding the directory. Per-category holders, live UTXO counts, supply, and fully-burned detection are maintained by `sync-tail` Pass 6 (event-driven enrichment from BCHN blocks) and stored in `token_state` / `token_holders` / `nft_instances` with `verified_source='bchn'`. Holder counts surface on the directory grid; the per-category detail page shows a top-holders table with %-of-supply plus a **Gini distribution score** (5-tier badge from Excellent to Whale-controlled), and `/stats` aggregates a directory-wide median Gini + per-tier histogram.

**2026-06-27:** BlockBook (`blockbook-bcash`) was decommissioned after a full self-index migration. See [docs/blockbook-decommission.md](docs/blockbook-decommission.md) for the implementation record and [docs/decommission-blockbook-plan.md](docs/decommission-blockbook-plan.md) for the architecture plan.

---

## Architecture

Everything runs on one Netcup RS 2000 G12 VPS (8 EPYC cores, 16 GB ECC, 512 GB NVMe). No cross-host latency, no third-party indexer dependency.

| Component | Role | Listens on |
|---|---|---|
| Archival **BCHN** v29 (`prune=0`, `txindex=1`) | Source of truth on-chain. Feeds `sync-tail` via ZMQ; serves `getblock` / `getrawtransaction` / `scantxoutset` to every worker. | `127.0.0.1:8332` (RPC) + `127.0.0.1:28332` (ZMQ) |
| **Postgres 17** | Cached directory and UI backend state. | `127.0.0.1:5432` (Unix socket, peer auth) |
| **SvelteKit app** (Node adapter, Svelte 5 runes) | UI + JSON API, SSR. | `127.0.0.1:3000` behind Caddy |
| **Sync workers** (Rust crate) | Populate Postgres from BCHN + venue scans. | systemd services + timers |
| **Caddy** | TLS termination, HSTS/CSP/XFO, reverse proxy. | `0.0.0.0:443` |

**Data sources:**
- **BCMR metadata** (names, symbols, icons, full rich card) is read directly from the on-chain CashTokens authchain — `sync-bcmr-onchain` walks each category's authchain forward via our BCHN node every 1 h, parses the on-chain `OP_RETURN BCMR` locator, sha256-verifies the publisher's JSON body against the on-chain commit, and caches the body in `token_metadata.bcmr_body`. The detail page reads the rich card from Postgres without any per-request HTTP call. No third-party indexer dependency.
- **Cauldron price / TVL** from [`indexer.cauldron.quest`](https://indexer.cauldron.quest), polled every 4 h (full discovery) + every 10 min (fast price refresh) and cached in `token_venue_listings`.
- **CryptoCompare** — live BCH/USD spot price, cached at the process level for 60 s.

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
    airdrops/              Wallet-tied airdrop wizard + history + receipt pages.
    learn/ faq/ roadmap/ about/ tos/   Static pages.
    api/tokens/            Directory + per-category holders/nfts/history/eligibility/recipientPreview/report endpoints (JSON + CSV).
    api/airdrops/          Draft + per-chunk broadcast + status endpoints for the airdrop flow.
    api/bchPrice/          BCH spot price proxy (CryptoCompare).
  lib/
    airdrop/               Browser + shared helpers: distribute (equal/weighted BigInt), connector (WC2, scaffolded for v2).
    components/            Svelte 5 components (TokenGrid, MetricsBar, Sparkline, …).
    server/db.ts           pg pool + hex ↔ BYTEA helpers.
    server/external.ts     BCMR + Cauldron clients (timed, hex-validated).
    server/airdrops.ts     Airdrop persistence + eligibility helpers.
    server/airdropBuilder.ts  Server-side libauth-direct multi-output token tx builder.
    server/walletUtxos.ts  Sender UTXO fetcher (BCHN-sourced, mempool-inclusive).
    venues.ts              Single source of truth for the {cauldron, tapswap, fex} venues.
    moderation.ts          NOT_MODERATED_CLAUSE shared across every read path.
    types.ts               TokenApiRow + venue listing shapes.
workers/                   Rust crate. cargo build --release produces 10 binaries.
  src/{bchn,bcmr,bcmr_onchain,cauldron,fex,pg,tapswap,tapswap_walker
       enrich_core,enrich_walker}.rs   Library modules.
  src/bin/{backfill,bcmr-onchain,cauldron,cauldron-stats,fex,
           tail,tapswap-backfill,tapswap-spend-backfill}.rs   Binaries.
infra/
  Caddyfile                Reverse proxy + CSP/HSTS/XFO.
  redeploy.sh              One-shot deploy: git pull → pnpm + cargo build → schema → systemd.
  systemd/                 Service + timer units for tokenstork.service + every worker.
public/.well-known/bitcoin-cash-metadata-registry.json   Self-hosted BCMR.
scripts/                   Legacy TypeScript sync prototypes — superseded by workers/.
```

---

## Data model

Schema is idempotent and lives in [db/schema.sql](db/schema.sql). Every `CREATE TABLE` is `IF NOT EXISTS`, every column add is `ADD COLUMN IF NOT EXISTS` — re-running `pnpm run db:init` on a deployed instance is safe.

Core tables:

- **`tokens`** — canonical category record keyed by `category BYTEA` (32-byte raw).
- **`token_metadata`** — BCMR-derived name / symbol / decimals / description / icon, written by the on-chain walker after sha256-verifying the publisher's JSON body. `bcmr_source IN ('onchain', …)` records the provenance; `bcmr_publication_uri` carries the publisher's raw on-chain URI; `bcmr_body JSONB` caches the verified JSON body so the detail-page rich card renders without a live HTTP call. `pg_trgm` GIN index on `name` for cheap ILIKE search.
- **`token_metadata_history`** — append-only record of every BCMR publication observed on the authchain. One row per `(category, authchain_tx)` carrying the locator's `content_hash`, the `publication_uri`, and a `body_verified` flag. Powers a future revision-diff UI.
- **`token_state`** — current supply (`NUMERIC(78,0)`), live UTXO count, NFT count, holder count, minting flag, burn flag, `gini_coefficient REAL` (holder-distribution score, 0=equal / 1=whale, NULL when fewer than 10 holders). `verified_source IN ('blockbook','bchn')` tracks provenance.
- **`token_holders`** — `(category, address)` with balance and NFT count.
- **`nft_instances`** — `(category, commitment)` with capability and owner.
- **`live_token_utxo`** — source of truth for event-driven enrichment. Maintained by `sync-tail` Pass 6: per block, token-bearing outputs are upserted and spent outpoints deleted. Indexed by `(txid, vout)` PK, by `category`, by `created_height` (for reorg unwind), and by `(address, category)` (for wallet UTXO lookups).
- **`authchain_edge`** — self-maintained spend index replacing BlockBook's `vout[0].spent_tx_id`. Records every vout[0] spend of a known authchain member with the spending txid and block height. Maintained by `sync-tail` Pass 7; reorg-safe via `DELETE WHERE spent_height >= N`.
- **`sync_state`** — singleton row tracking backfill / tail / enrich / bcmr_onchain / cauldron / tapswap / fex run timestamps.

Venue + market tables:

- **`token_venue_listings`** — keyed by `(venue, category)`; `price_sats DOUBLE PRECISION`, `tvl_satoshis NUMERIC(30,0)`. **Unit convention**: `tvl_satoshis` is single-side BCH-reserve sats for AMM venues; the UI applies `× 2` at render to reflect both halves of a constant-product pool. One unambiguous unit across `cauldron` + `fex`.
- **`token_price_history`** — `(category, venue, ts, price_sats, tvl_satoshis)`. One row per successful Cauldron / Fex fetch. Drives the directory's 1h / 24h / 7d % change columns + the 7-day sparkline column.
- **`tapswap_offers`** — one row per on-chain MPSW listing. `status IN ('open','taken','cancelled')`.
- **`token_moderation`** — keyed by `category`; `reason` (public) + `moderator_note` (operator-private) + `hidden_at`. Categories present in this table 410 from `/token/[hex]` and are filtered from every read path via `NOT_MODERATED_CLAUSE`.
- **`token_reports`** — incoming user reports against problematic tokens. Triaged by hand into `token_moderation` decisions.

Airdrop tables (sender = authenticated wallet; one row per draft, per chunked tx, per recipient):

- **`airdrops`** — `id UUID PK`, `sender_cashaddr` (FK → `users`), source + recipient `BYTEA` categories, `mode IN ('equal','weighted')`, `total_amount NUMERIC(78,0)`, `output_value_sats` (per-recipient BCH dust, 546-2000 with default 800), `holders_snapshot_at`, `state IN ('drafting','signing','broadcasting','complete','failed','partial')`, `tx_count`.
- **`airdrop_txs`** — one row per chunk (≤ 600 recipients); `(airdrop_id, tx_index)` PK, `txid BYTEA`, `state IN ('pending','signed','broadcast','failed')`, `fail_reason TEXT`.
- **`airdrop_outputs`** — one row per recipient; `(airdrop_id, recipient_cashaddr)` PK, `amount NUMERIC(78,0)`, `tx_index`, `vout_index`.

Two design decisions worth calling out:

- `category` and `genesis_txid` are stored as raw `BYTEA`, not hex text — half the storage, faster comparisons. Hex encoding happens at the API boundary in [src/lib/server/db.ts](src/lib/server/db.ts).
- `NUMERIC(78,0)` comfortably holds any CashToken fungible amount and **must be stringified at the UI boundary** — JS numbers lose precision above 2^53.

Deploy:

```
pnpm run db:init    # psql "$DATABASE_URL" -f db/schema.sql
```

---

## HTTP API

All endpoints return JSON by default. Response shapes are stable.

| Endpoint | Purpose |
|---|---|
| `GET /api/tokens` | Directory listing (paginated, search across name + symbol + description + category, venue filters). Add `?format=csv` for a spreadsheet-friendly export — RFC-4180 quoted, UTF-8 BOM-prefixed for Excel. Same row cap (1000) as the JSON form. |
| `GET /api/tokens/[category]/holders` | Holders for a category, ordered by balance. |
| `GET /api/tokens/[category]/nfts` | NFT instances in a category. |
| `GET /api/tokens/[category]/history` | Per-category price + TVL history from `token_price_history`, oldest-first. Optional `?venue=cauldron\|fex` and `?from=<unix-seconds>&to=<unix-seconds>` filters. Add `?format=csv` for the CSV form. |
| `POST /api/tokens/[category]/report` | Submit a user report for moderation review. Rate-limited; webhook-alerts the operator. |
| `GET /api/tokens/[category]/eligibility` | Auth-gated. Returns the authenticated cashaddr's holding of this category (FT balance + NFT count + BCMR display fields), or 410 if they don't hold any. Drives the airdrop wizard's source-token preview. |
| `GET /api/tokens/[category]/recipientPreview` | Public. Returns holder count + display name + latest `token_holders.snapshot_at` for a category. Drives the airdrop wizard's recipient-token preview. |
| `POST /api/airdrops` | Auth-gated, rate-limited (1 draft / 15 min / cashaddr). Creates an airdrop draft and returns the first chunk's unsigned hex. Body: `{sourceCategory, recipientCategory, mode: 'equal'\|'weighted', totalAmount, outputValueSats?}`. |
| `POST /api/airdrops/[id]/broadcast` | Auth-gated, ownership-checked. Body: `{txIndex, signedHex}`. Forwards to BCHN's `sendrawtransaction`, updates per-tx + per-recipient state, re-checks holder snapshot freshness, and rebuilds the next chunk's unsigned hex against fresh on-chain UTXOs. |
| `GET /api/airdrops/[id]` | Auth-gated, ownership-checked. Receipt payload: parent airdrop record + per-chunk tx state + per-recipient outputs. |
| `GET /api/bchPrice` | BCH spot price (CryptoCompare, cached). |

CSV-emitting endpoints share a per-IP rate limit (30 requests / minute, in-memory, per process) and a CDN-cacheable response (`s-maxage=300`) so a hostile scraper bounces off Cloudflare instead of our origin. The 429 response carries an RFC 7231 `Retry-After` header.

Page routes (`/`, `/token/[category]`, `/stats`, `/moderated`, `/airdrops`, `/airdrops/new`, `/airdrops/[id]`, `/learn`, `/faq`, `/roadmap`, `/about`, `/tos`) all render server-side from Postgres on every request — no client-side hydration of the data. The airdrop wizard at `/airdrops/new` is auth-gated; the BCH price + theme switcher are the only client-state pieces shared across the rest of the site.

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
# Binaries land in workers/target/release/{backfill,bcmr-onchain,cauldron,fex,tail,tapswap-backfill}
```

**Environment variables** (only `DATABASE_URL` is required by the app):

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. Unix-socket form works: `postgres:///tokenstork`. |
| `CRYPTO_COMPARE_KEY` | no | Unlocks `/api/bchPrice`; returns `null` when absent. |
| `BCHN_RPC_URL`, `BCHN_RPC_AUTH` | required for mint + airdrop broadcast | The app forwards signed txs to BCHN's `sendrawtransaction` and reads UTXOs / mempool / authchain data. Default URL `http://127.0.0.1:8332`. Without these, `/mint` and `/airdrops/new` still load but signed-tx broadcast 503's. |
| `BCHN_ZMQ_URL` | worker-only | Needed by `workers/sync-tail`; not by the app. |
| `WALLET_MEMPOOL_CACHE_MS` | optional | Mempool UTXO cache TTL for `walletUtxos.ts` (default 5000 ms). |
| `PUBLIC_WALLETCONNECT_PROJECT_ID` | optional | WalletConnect v2 project id for the wallet-login + (future) airdrop direct-sign flows. The paste-signed-hex fallback works without it. |
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
- [infra/systemd/](infra/systemd/) — hardened unit files for `tokenstork.service`, `bchn.service`, `sync-tail.service` (always-on with `Type=notify` + `WatchdogSec=120s`), `sync-bcmr-onchain.{service,timer}`, `sync-cauldron{,-fast}.{service,timer}`, `sync-fex.{service,timer}`, `sync-tapswap-backfill.service`. Same hardening profile across the board: `ProtectSystem=strict`, `CapabilityBoundingSet=`, filtered syscalls, `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6`.
- [infra/redeploy.sh](infra/redeploy.sh) — one-shot deploy script: `git pull`, `pnpm install --frozen-lockfile && pnpm run build`, `cargo build --release`, schema apply, systemd unit refresh + `daemon-reload`, Caddyfile validate + sync, restart `tokenstork.service` + always-on workers.
- Secrets load from `/etc/tokenstork/env` (chmod 600, owner `tokenstork`).

The step-by-step VPS runbook — BCHN install, Postgres tuning, UFW, fail2ban, Caddy + Cloudflare Origin Cert, systemd, smoke tests — lives in [docs/vps-setup.md](docs/vps-setup.md).

---

## Indexing pipeline

Ten cooperating workers, all in the Rust [workers/](workers/) crate. Each is idempotent and crash-safe.

| Worker | Trigger | Job |
|---|---|---|
| **backfill** | one-shot (~25 min after BCHN IBD) | Walk blocks 792,772 → tip via BCHN RPC. Insert every new CashToken category into `tokens`. |
| **tail** | always-on, ZMQ-driven | Subscribe to `hashblock`; on each new block, run seven passes — token discovery, Tapswap MPSW listing detection, Tapswap close detection, per-block economics, CRC-20 covenant detection, event-driven enrichment (`live_token_utxo` → `token_state`/`token_holders`/`nft_instances`), and authchain frontier (`vout[0]` spend index → `authchain_edge`). Sub-second latency from block arrival to DB row. `Type=notify` + `WatchdogSec=120s` for liveness. |
| **bcmr-onchain** | every 1 h | **Sole BCMR source.** Walk each category's authchain forward via BCHN RPC + the self-maintained `authchain_edge` spend index, parse the on-chain `OP_RETURN BCMR <hash> <URI>` locator at every hop, fetch + sha256-verify the JSON body, and write the latest verified publication into `token_metadata` with `bcmr_source='onchain'` (including the full body in `bcmr_body JSONB` for the detail-page rich card). Records every locator-bearing hop in `token_metadata_history` for a future revision-diff UI. |
| **cauldron** (full mode) | every 4 h | Walk every FT category, fetch price + TVL from `indexer.cauldron.quest`, upsert `token_venue_listings`, prune stale rows, append a `token_price_history` point per success. |
| **cauldron** (fast mode) | every 10 min | Refresh price + TVL only for already-listed categories. Skips pruning — the listed-set view can't confirm delistings of unlisted categories. |
| **cauldron-stats** | every 30 min | Pull ecosystem aggregates (total TVL, 24h/7d/30d swap volume, pool counts, unique-addresses-by-month) from Cauldron's global endpoints; cache in `cauldron_global_stats` for `/stats` SSR. |
| **fex** | every 4 h | One `scantxoutset raw(<asset_covenant_p2sh>)` against BCHN; decode each Fex pool UTXO; upsert with `venue='fex'`; prune; append history. |
| **tapswap-backfill** | one-shot | Cold-walk blocks 794,520 → tip looking for MPSW OP_RETURN listings. Resumable via `sync_state.last_tapswap_backfill_through`. |
| **tapswap-spend-backfill** | one-shot | Cold-walk 794,520 → tip looking for spend events to retroactively close listings populated by the listing-backfill before the lifecycle walker shipped. Reuses `tapswap_walker::process_block_spends`. |

Current Postgres-resident state is tracked in the `sync_state` singleton row — every worker writes a `last_<phase>_run_at` timestamp at the end of each run, so a staleness watchdog can spot a silently-stuck worker independently of block cadence.

---

## Data freshness

How quickly each kind of data on the site reflects on-chain reality. Same information as the indexing-pipeline table above but framed by what a visitor actually sees.

| What you see on the site | Source worker | Typical lag | Notes |
|---|---|---|---|
| **New token category appears in the directory** | `sync-tail` (ZMQ-driven) | sub-second | A `hashblock` notification from BCHN wakes the tail worker; the new row is in Postgres before the next block arrives. |
| **Token name / symbol / icon (BCMR metadata)** | `sync-bcmr-onchain` (1 h timer) | 0-1 h once the publisher's on-chain authchain is observed; otherwise never (no third-party fallback) | The walker reads the publisher's own copy by walking the CashTokens authchain via our BCHN node + the `authchain_edge` spend index, sha256-verifying the JSON body against the on-chain locator. The detail page links out to the publisher's URI directly. Tokens whose issuers have not put a BCMR locator on their authchain show the bare category hex. |
| **Cauldron per-token price + TVL** | `sync-cauldron` (4 h full + 10 min fast) | 0-10 min for already-listed; 0-4 h for newly-listed | `fast` mode re-queries the already-listed set every 10 min; `full` mode re-discovers every 4 h. |
| **Cauldron ecosystem aggregates on `/stats`** (total TVL, 24h/7d/30d volume, pool counts, unique addresses by month) | `sync-cauldron-stats` (30 min timer) | 0-30 min | Cached in `cauldron_global_stats` so the SSR loader doesn't pay a network round-trip per page hit. |
| **Fex per-pool price + TVL** | `sync-fex` (4 h timer) | 0-4 h | One `scantxoutset` per tick walks all Fex pools at once. |
| **Tapswap new open listing appears** | `sync-tail` (ZMQ-driven, Pass 2) | sub-second | The MPSW OP_RETURN at `outputs[1]` is detected on the same block-fetch the tokens walker uses. |
| **Tapswap listing transitions `open → taken / cancelled`** | `sync-tail` (ZMQ-driven, Pass 3) | sub-second | Detects the spending transaction's contract input + classifies by inspecting `vout[0]`'s recipient PKH. |
| **Cross-venue spreads on `/arbitrage`** | derived from the above on every page render | matches whichever underlying source is freshest | Pure SQL CTE; no separate worker. |
| **Sparkline + 1h / 24h / 7d % change columns** | `token_price_history` (one row per `sync-cauldron` fetch) | accumulates 6 points / day / token | Sparklines need ~7 days of history to fully populate; first hours after deploy show partial data. |
| **Holders / NFT instances / fully-burned flag / Gini distribution score** | `sync-tail` Pass 6 (event-driven) | sub-second per block | Maintained continuously from BCHN blocks via `live_token_utxo` → `token_state`/`token_holders`/`nft_instances`. Holder counts surface on the directory grid; the per-category detail page renders a top-holders table sorted numerically with a %-of-supply column, plus a Gini coefficient + 5-tier badge. `/stats` shows the directory-wide median Gini + a per-tier histogram. |
| **Airdrop draft + per-chunk broadcast** | wizard at `/airdrops/new` (built on demand, no worker) | sub-second per chunk | Each chunk's unsigned tx is built server-side via libauth-direct against freshly-fetched on-chain UTXOs (`live_token_utxo` + BCHN mempool cache). Sender pastes the signed hex back; broadcast forwards to local BCHN's `sendrawtransaction`. |

**BCH spot price** (the `$X.XX` in the header) is fetched from CryptoCompare on each request, cached at the SvelteKit-app process level for ~60 seconds. Independent of the indexer pipeline.

**The general rule**: anything blockchain-ZMQ-driven (token discovery, Tapswap listings + closes, enrichment, authchain) is sub-second. Anything timer-driven runs at the cadence in the table above.

---

## BCMR

TokenStork publishes its own Bitcoin Cash Metadata Registry at:

<https://tokenstork.com/.well-known/bitcoin-cash-metadata-registry.json>

The file lives in the repo at [public/.well-known/bitcoin-cash-metadata-registry.json](public/.well-known/bitcoin-cash-metadata-registry.json).

---

## Contributing

Issues and PRs welcome at <https://github.com/Panmoni/tokenstork>. See [docs/blockbook-decommission.md](docs/blockbook-decommission.md) for the implementation record of the self-index migration.

Before opening a PR, please run:

```
pnpm run check                         # svelte-check + tsc
pnpm run build                         # adapter-node output
cd workers && cargo test --release --lib && cargo clippy --all-targets --release
```

---

## Credits

- [@mainnet_pat](https://github.com/mainnet-pat) — the Tapswap MPSW protocol whose on-chain reference implementation we reverse-engineered against, and the BlockBook CashTokens fork that carried the enrichment pipeline through its first two years of operation.
- [CHIP-BCMR](https://github.com/bitjson/chip-bcmr) — the on-chain metadata-registry standard our authchain walker reads directly from each token's authchain, no third-party indexer in the path.
- [Cauldron](https://cauldron.quest) — the public AMM indexer that drives our price + TVL columns.
- [Fex.cash](https://docs.fex.cash/) — open-source UniswapV2-style AMM with parameter-free covenants that let us index the full ecosystem in a single `scantxoutset` call.

Original release announcement: <https://twitter.com/BitcoinCashSite/status/1687565837169819648>

---

## License

MIT © 2023-2026 [Panmoni](https://panmoni.com). See [LICENSE](LICENSE).
