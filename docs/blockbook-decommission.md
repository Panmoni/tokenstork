# BlockBook decommission — implementation record

**Date:** 2026-06-27 · **Plan:** [`decommission-blockbook-plan.md`](./decommission-blockbook-plan.md)

## What happened

BlockBook (`blockbook-bcash`) — a Trezor address indexer consuming ~4.4 GB RAM, ~150 GB
disk, and 5 CPU cores — was removed from carson. It caused the 2026-06-13 swap-thrash
freeze and had been running behind resource cages since. TokenStork now self-indexes
everything it needs directly from BCHN via `sync-tail`.

## Architecture: before vs after

```
BEFORE (BlockBook)                          AFTER (self-indexed)
─────────────────────                       ──────────────────────
                                              ┌─────────────────┐
┌──────────────┐                              │   sync-tail     │
│  BlockBook   │── enrichment ──► token_state │  (Pass 1-7)     │
│  (4.4 GB)    │── authchain ──► bcmr-onchain │                 │
│              │── UTXOs ──────► walletUtxos  │ Pass 1: tokens  │
└──────────────┘                              │ Pass 5: CRC-20  │
                                              │ Pass 6: enrich  │──► token_state
       replaced by                            │ Pass 7: authchn │──► authchain_edge
       ──────────                             └────────┬────────┘
                                              ┌────────┴────────┐
┌──────────────┐                              │    BCHN node    │
│   BCHN RPC   │── blocks ────► sync-tail     │  (ZMQ + RPC)    │
└──────────────┘                              └─────────────────┘
```

## Data flow: how each capability was replaced

### A. Enrichment (tx-history → token_state/token_holders/nft_instances)

**Before:** `enrich` binary polled BlockBook `/api/v2/address/<cat>?details=txs` every 6h,
paginating through a category's full transaction history to reconstruct the live UTXO set.

**After:** `sync-tail` Pass 6 (event-driven). Per block:
1. `derive_block_deltas()` — extracts all token-bearing outputs + spent outpoints from
   `getblock <hash> 2`
2. `apply_live_utxo_deltas()` — upserts creates, deletes spends in `live_token_utxo`
3. `aggregate()` + `write_token_state("bchn")` — re-aggregates touched categories
   and writes `token_state` / `token_holders` / `nft_instances`

**Tables:** `live_token_utxo` (source of truth, 823k rows), `token_state` (15,254 rows,
`verified_source='bchn'`), `token_holders` (92k rows), `nft_instances` (102k rows)

**Migration:** One-time SQL rebuild from `live_token_utxo` on 2026-06-27 populated all
three tables from the seeded UTXO set.

### B. Transaction output decode

**Before:** BlockBook `/api/v2/tx/<txid>?spending=true` provided `vout[].hex` and `tokenData`
for authchain walks and token-data verification.

**After:** `BchnClient::get_raw_transaction_verbose(txid)` (verbosity=2). BCHN's txindex is
enabled (`txindex=1` in `bitcoin.conf`), so `getrawtransaction <txid> 2` returns the full
decoded tx with `vout[].scriptPubKey.hex` and `vout[].tokenData`. The Rust `VerboseTx` type
and TS `getRawTransactionVerbose()` wrap this.

**Consumers:**
- `bcmr-onchain` (Rust) — authchain hop output parsing
- `verifyUtxoTokenData()` (TS) — defense-in-depth cross-check against BCHN
- `authchain.ts` (TS) — scriptPubKey → locking-bytecode comparison

### C. Forward spend pointer (vout[0].spent_tx_id)

**Before:** BlockBook's `?spending=true` populated `vout[0].spentTxId` with the hex txid
that spent the output.

**After:** `authchain_edge` table, maintained by `sync-tail` Pass 7:
- Per block, `derive_block_deltas()` populates `vout0_spends: Vec<Vout0Spend>` (every
  non-coinbase input whose prevout index is 0)
- Pass 7 filters against the in-memory authchain member set (genesis_txids + recorded
  child_txids, ~442k entries) and records new edges
- `lookup_authchain_child(parent_txid)` reads the forward pointer
- Reorg-safe via `unwind_authchain_edges(height)` (DELETE WHERE spent_height >= N)

**Head confirmation:** `gettxout <txid> 0` as a safety net — if the edge table says
unspent but BCHN says spent, the walk fails loud rather than silently truncating.

**Table:** `authchain_edge` — 476k rows, PK `(parent_txid)`, index on `(spent_height)`

### D. Per-address UTXO set (incl. mempool)

**Before:** BlockBook `/api/v2/utxo/<cashaddr>` returned confirmed + mempool UTXOs for a
wallet address. Used by airdrop builder, mint funding, and BCMR publish wizard.

**After:** Two-source merge in `fetchWalletUtxos(cashaddr)`:

1. **Confirmed UTXOs:** `SELECT FROM live_token_utxo WHERE address = $1` via
   `live_token_utxo_address_idx (address, category)`. Keyed by `txid:vout` for dedup.

2. **Mempool UTXOs:** Module-scoped cache (TTL 5s, `WALLET_MEMPOOL_CACHE_MS` env var):
   - `getRawMempool()` → list of mempool txids
   - `getRawTransactionVerbose(txid)` per tx → `vout[].scriptPubKey.hex` +
     `vout[].tokenData`
   - Built into `Map<scriptHex, WalletUtxo[]>` — per-request lookup is O(1) via
     `cashAddressToLockingBytecode(cashaddr)`
   - Confirmed UTXOs take precedence over mempool on the same outpoint

**TokenData verification:** `verifyUtxoTokenData()` re-checks every unique txid against
BCHN `getrawtransaction` (defense-in-depth against index lag). For confirmed UTXOs this
is a no-op (the `live_token_utxo` data IS BCHN-sourced). For mempool UTXOs it catches
txs that disappeared between cache builds.

## New schema

```sql
-- Authchain spend index (replaces BlockBook vout[0].spent_tx_id)
CREATE TABLE authchain_edge (
  parent_txid  BYTEA   PRIMARY KEY,
  child_txid   BYTEA   NOT NULL,
  spent_height INTEGER NOT NULL
);
CREATE INDEX authchain_edge_height_idx ON authchain_edge (spent_height);

-- Per-address UTXO lookup (replaces BlockBook /api/v2/utxo/<addr>)
CREATE INDEX live_token_utxo_address_idx ON live_token_utxo (address, category);
```

## Files changed

| Layer | Files | What |
|-------|-------|------|
| Schema | `db/schema.sql` | `authchain_edge` table, `live_token_utxo_address_idx` |
| Rust | `workers/src/bchn.rs` | `VerboseTx`, `get_raw_transaction_verbose`, `gettxout`, `block_header_height` |
| Rust | `workers/src/enrich_walker.rs` | `Vout0Spend` struct, `vout0_spends` in `BlockDeltas` |
| Rust | `workers/src/pg.rs` | `record/unwind/lookup/load` authchain functions; `write_token_state` accepts `verified_source` |
| Rust | `workers/src/bcmr_onchain.rs` | `walk_authchain` rewritten for BchnClient + PgPool |
| Rust | `workers/src/bin/tail.rs` | Pass 6 authoritative enrich, Pass 7 authchain frontier, genesis member seeding, reorg unwind |
| Rust | `workers/src/bin/bcmr-onchain.rs` | Swapped BlockbookClient → BchnClient |
| Rust | `workers/src/bin/enrich.rs` | Passes `"blockbook"` as `verified_source` |
| TS | `src/lib/server/bchn.ts` | `getRawMempool`, `getRawTransactionVerbose`, `getTxOut` exports |
| TS | `src/lib/server/walletUtxos.ts` | Rewritten: confirmed from `live_token_utxo` + mempool from cached BCHN scan |
| TS | `src/lib/server/authchain.ts` | Rewritten: `authchain_edge` + BCHN RPC instead of BlockBook |
| TS | `src/lib/server/blockbookPacer.ts` | Orphaned (0 imports) |

## Operational notes

### Seed procedure (for fresh installs or re-seeds)

```sql
-- 1. Run backfill for token discovery (populates `tokens`)
-- 2. Reset tail checkpoint to CashTokens activation
UPDATE sync_state SET tail_last_block = 792771 WHERE id = 1;

-- 3. Start tail WITHOUT ENRICH_SHADOW (authoritative mode)
-- Tail replays all blocks from 792772 to tip, populating:
--   - live_token_utxo (823k rows)
--   - authchain_edge (476k rows)
--   - token_state / token_holders / nft_instances (via one-time SQL migration)

-- 4. One-time migration to rebuild enrichment tables:
--    See the INSERT INTO token_state / token_holders / nft_instances
--    queries in the deployment log (2026-06-27 12:28 UTC)
```

### Reorg handling

All self-indexed tables unwind on reorg:
- `live_token_utxo`: `DELETE WHERE created_height >= N`
- `token_crc20`: `DELETE WHERE height = N`
- `authchain_edge`: `DELETE WHERE spent_height >= N`
- Authchain member set: reloaded from DB after unwind

### Mempool cache TTL

The mempool UTXO cache for `walletUtxos.ts` rebuilds every 5 seconds. Override via
`WALLET_MEMPOOL_CACHE_MS` env var. A shorter TTL means fresher mempool data but more
BCHN RPC load. The cache build cost is O(mempool_size) — acceptable for typical BCH
mempools (hundreds to low thousands of txs).

### What was NOT changed

- `workers/src/blockbook.rs` — module still exists (compiled but not called at runtime)
- `workers/src/bin/enrich.rs` — exists but timer is disabled
- `workers/src/bin/verify.rs` — exists but timer is disabled
- `workers/src/bin/enrich-seed.rs` — exists but timer is disabled
- `src/lib/server/blockbookPacer.ts` — orphaned (0 imports)
- `infra/systemd/sync-enrich.*` — unit files exist but timer disabled

These can be deleted in a follow-up cleanup pass.

### Resource reclamation

- **RAM:** ~4.4 GB freed (BlockBook RSS)
- **Disk:** ~150 GB freed (BlockBook RocksDB index in `/opt/blockbook/`)
- **CPU:** 5 cores freed (BlockBook CPUQuota)
- **Swap:** 4 GB swap cap removed
