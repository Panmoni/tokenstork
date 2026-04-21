# TokenStork

**The authoritative, self-hosted directory and explorer for every BCH CashToken ever minted.**

Live at <https://tokenstork.com>.

TokenStork indexes every fungible (FT) and non-fungible (NFT) CashToken category created since activation at block **792,772** (May 2023) and keeps the list continuously up to date as new tokens are minted and existing ones are (partially or fully) burned. For each category it serves supply, holders, NFT instances, BCMR metadata, and market data.

The entire pipeline runs on a single VPS. There is no dependency on Chaingraph, third-party BlockBook, or any other external blockchain indexer — TokenStork runs its own archival BCHN, its own BlockBook instance, and its own Postgres.

---

## Status

**v0.0.2 beta.** The SvelteKit app, schema, and HTTP API are live in production. The sync workers currently exist as TypeScript prototypes in [scripts/](scripts/) and are being ported to a Rust `workers/` crate. Until that port lands, the TS prototypes are functional and drive backfill/tail during bring-up.

See [docs/cashtoken-index-plan.md](docs/cashtoken-index-plan.md) for the full rollout plan and progress log.

---

## Architecture

Everything runs on one Netcup RS 2000 G12 VPS (8 EPYC cores, 16 GB ECC, 512 GB NVMe). No cross-host latency, no third-party indexer dependency.

| Component | Role | Listens on |
|---|---|---|
| Archival **BCHN** (`prune=0`, `txindex=1`) | Source of truth on-chain. Feeds BlockBook; wakes the tail worker via ZMQ. | `127.0.0.1:8332` (RPC) + `127.0.0.1:28332` (ZMQ) |
| **BlockBook** (mainnet-pat fork, `cashtokens` branch) | Category-indexed rich-data API: holders, NFTs per category, transfers, BCMR. | `127.0.0.1:9130` |
| **Postgres 17** | Cached directory and UI backend state. | `127.0.0.1:5432` (Unix socket, peer auth) |
| **SvelteKit app** (Node adapter) | UI + JSON API, SSR. | `127.0.0.1:3000` behind Caddy |
| **Sync workers** (backfill / tail / enrich / verify) | Populate Postgres from BCHN + BlockBook. | systemd services |
| **Caddy** | TLS termination, HSTS/CSP/XFO, reverse proxy. | `0.0.0.0:443` |

**External data sources** are confined to two narrow surfaces:

- **BCMR metadata** (names, symbols, icons) from [Paytaca's BCMR indexer](https://github.com/paytaca/bcmr-indexer) and published BCMR JSON feeds. Polled and cached in `token_metadata`.
- **Cauldron price / TVL** from `indexer.cauldron.quest`, fetched live on per-token SSR render only.

---

## Repository layout

```
db/schema.sql              Idempotent Postgres schema (6 tables).
src/                       SvelteKit app (Svelte 5 + Node adapter).
  routes/
    +page.server.ts        Directory front page (server-side DB read).
    token/[category]/      Per-category detail page with live Cauldron data.
    api/tokens/            Directory + per-category holders/nfts JSON.
    api/bchPrice/          BCH spot price proxy (CryptoCompare).
    api/fearAndGreed/      F&G index proxy.
  lib/
    server/db.ts           pg pool + hex ↔ BYTEA helpers.
    server/external.ts     BCMR + Cauldron clients (timed, hex-validated).
    server/fetch.ts        timedFetch helper (strict timeouts on every call).
scripts/                   TS sync workers (backfill, tail, enrich, verify).
lib/                       Shared TS clients (bchn.ts, blockbook.ts, pg.ts).
infra/
  Caddyfile                Reverse proxy + CSP/HSTS.
  systemd/tokenstork.service
docs/cashtoken-index-plan.md   Canonical rollout plan and progress log.
public/.well-known/bitcoin-cash-metadata-registry.json   Self-hosted BCMR.
```

---

## Data model

Six tables, one idempotent file: [db/schema.sql](db/schema.sql).

- **`tokens`** — canonical category record keyed by `category BYTEA` (32-byte raw).
- **`token_metadata`** — BCMR-derived name/symbol/decimals/description/icon, with a `pg_trgm` GIN index on `name` for cheap ILIKE search.
- **`token_state`** — current supply (`NUMERIC(78,0)`), live UTXO count, NFT count, holder count, minting flag, burn flag.
- **`token_holders`** — `(category, address)` with balance and NFT count.
- **`nft_instances`** — `(category, commitment)` with capability and owner.
- **`sync_state`** — singleton row tracking backfill / tail / enrich / verify progress.

Two design decisions worth calling out:

- `category` and `genesis_txid` are stored as raw `BYTEA`, not hex text — half the storage, faster comparisons. Hex encoding happens at the API boundary in [src/lib/server/db.ts](src/lib/server/db.ts).
- `NUMERIC(78,0)` comfortably holds any CashToken fungible amount and **must be stringified at the UI boundary** — JS numbers lose precision above 2^53.

Deploy:

```
npm run db:init    # psql "$DATABASE_URL" -f db/schema.sql
```

---

## HTTP API

All endpoints return JSON. Response shapes are stable and byte-compatible with the pre-migration Next.js app.

| Endpoint | Purpose |
|---|---|
| `GET /api/tokens` | Directory listing (paginated, searchable by name). |
| `GET /api/tokens/[category]/holders` | Holders for a category, ordered by balance. |
| `GET /api/tokens/[category]/nfts` | NFT instances in a category. |
| `GET /api/bchPrice` | BCH spot price (CryptoCompare, cached). |
| `GET /api/fearAndGreed` | Crypto Fear & Greed index. |

The same page routes (`/`, `/token/[category]`) render server-side from Postgres on every request — no client-side hydration of the data.

---

## Local development

Prerequisites: Node 22, Postgres 17, a reachable BCH node (for the backfill prototypes only — the UI runs fine against an empty schema).

```
git clone https://github.com/Panmoni/tokenstork.git
cd tokenstork
npm ci

createdb tokenstork
export DATABASE_URL="postgres:///tokenstork"
npm run db:init

npm run dev           # http://localhost:5173
```

**Environment variables** (all optional except `DATABASE_URL`):

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. Unix-socket form works: `postgres:///tokenstork`. |
| `CRYPTO_COMPARE_KEY` | no | Unlocks `/api/bchPrice`; returns `null` when absent. |
| `FEAR_AND_GREED_API_KEY` | no | Unlocks `/api/fearAndGreed`. |
| `PUBLIC_BEAM_ANALYTICS_TOKEN` | no | Client-side Beam Analytics tag. |
| `BCHN_RPC_URL`, `BCHN_ZMQ_URL` | worker-only | Needed by `scripts/` but not by the app. |
| `BLOCKBOOK_URL` | worker-only | Needed by the enrich worker. |

**Useful scripts:**

```
npm run dev           # Vite dev server
npm run build         # production build (output in build/)
npm run start         # node build  — what systemd runs
npm run check         # svelte-check + tsc
npm run typecheck     # workers tsconfig

npm run sync:backfill # one-shot: walk BCHN 792,772 → tip, populate tokens
npm run sync:tail     # long-running: follow ZMQ hashblock
npm run sync:enrich   # periodic: pull holders/NFTs/BCMR via BlockBook
npm run sync:verify   # periodic: reconcile state against live chain
```

---

## Production deployment

All of the moving parts are checked in:

- [infra/Caddyfile](infra/Caddyfile) — reverse proxy, caching rules, full CSP/HSTS/XFO header chain. Assumes Cloudflare proxy in front with SSL/TLS **Full (strict)** and a Cloudflare Origin Certificate on disk at `/etc/caddy/tls/`. Comments at the top explain how to swap in Let's Encrypt for a non-CF deploy.
- [infra/systemd/tokenstork.service](infra/systemd/tokenstork.service) — hardened unit file (`ProtectSystem=strict`, `CapabilityBoundingSet=`, filtered syscalls, `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6`).
- Secrets load from `/etc/tokenstork/env` (chmod 600, owner `tokenstork`).

The step-by-step VPS runbook — BCHN install, Postgres tuning, UFW, fail2ban, Caddy + Cloudflare Origin Cert, systemd, smoke tests — lives in [docs/cashtoken-index-plan.md](docs/cashtoken-index-plan.md) under Phase 2a.

---

## Indexing pipeline

The sync side is four cooperating workers. Each is idempotent and crash-safe.

| Worker | Trigger | Job |
|---|---|---|
| **backfill** | one-shot (~90 min after BCHN IBD) | Walk blocks 792,772 → tip via BCHN RPC. Insert every new CashToken category into `tokens`. |
| **tail** | long-running, ZMQ-driven | Subscribe to `hashblock`; on each new block, scan for new categories and upsert. Sub-second latency from block arrival to DB row. |
| **enrich** | cron, every 6h | For each known category, pull holders / NFTs / BCMR via BlockBook. Refresh `token_state`, `token_holders`, `nft_instances`, `token_metadata`. |
| **verify** | cron, weekly | Reconcile `token_state` against `scantxoutset` + BlockBook; flag drift, set `is_fully_burned`, update `verified_at`. |

Current Postgres-resident state is tracked in the `sync_state` singleton row.

The TS prototypes in [scripts/](scripts/) are the reference implementation and are what currently runs. The Rust `workers/` port is in progress; the shape of the jobs does not change, only the runtime.

---

## BCMR

TokenStork publishes its own Bitcoin Cash Metadata Registry at:

<https://tokenstork.com/.well-known/bitcoin-cash-metadata-registry.json>

The file lives in the repo at [public/.well-known/bitcoin-cash-metadata-registry.json](public/.well-known/bitcoin-cash-metadata-registry.json).

---

## Contributing

Issues and PRs welcome at <https://github.com/Panmoni/tokenstork>. The near-term roadmap lives in [TODO](TODO); the architectural plan and progress log live in [docs/cashtoken-index-plan.md](docs/cashtoken-index-plan.md).

Before opening a PR, please run:

```
npm run check
npm run build
```

---

## Credits

- [Paytaca](https://github.com/paytaca/bcmr-indexer) — BCMR indexer API, the source of authoritative CashToken metadata.
- [@mainnet_pat](https://github.com/mainnet-pat) — the `cashtokens` BlockBook fork that every CashToken-aware explorer depends on.
- [@mr-zwets](https://github.com/mr-zwets) — early encouragement and technical guidance.

Original release announcement: <https://twitter.com/BitcoinCashSite/status/1687565837169819648>

---

## License

MIT © 2023-2026 [Panmoni](https://panmoni.com). See [LICENSE](LICENSE).
