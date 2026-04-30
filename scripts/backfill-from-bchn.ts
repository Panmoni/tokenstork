// scripts/backfill-from-bchn.ts
// Phase 2b — walk blocks 792,772 → tip via our own BCHN, extract every
// CashToken category, insert into the `tokens` table.
//
// Usage (on the VPS after BCHN IBD is complete):
//   pnpm run sync:backfill
//
// Resumable: checkpoints sync_state.backfill_through every 1000 blocks so a
// Ctrl-C or crash loses at most ~1000 blocks of work (< 1 minute).

import { performance } from "perf_hooks";
import * as bchn from "../lib/bchn";
import {
  bytesFromHex,
  closePool,
  query,
  withTransaction,
} from "../lib/pg";

const CASHTOKEN_START_BLOCK = 792_772;
const CHECKPOINT_EVERY = 1000;
const PROGRESS_EVERY = 500;

interface FoundCategory {
  categoryHex: string;
  tokenType: "FT" | "NFT" | "FT+NFT";
  genesisBlock: number;
  genesisTxid: string;
  genesisTime: number;
}

function classifyType(hasFT: boolean, hasNFT: boolean): "FT" | "NFT" | "FT+NFT" {
  if (hasFT && hasNFT) return "FT+NFT";
  if (hasNFT) return "NFT";
  return "FT";
}

// Merge the per-block observations of a single category into a FoundCategory.
// If the category already exists in `acc`, upgrade its token_type toward
// FT+NFT but never regress.
function observe(
  acc: Map<string, FoundCategory>,
  categoryHex: string,
  hasFT: boolean,
  hasNFT: boolean,
  height: number,
  time: number,
  txid: string
) {
  const existing = acc.get(categoryHex);
  if (!existing) {
    acc.set(categoryHex, {
      categoryHex,
      tokenType: classifyType(hasFT, hasNFT),
      genesisBlock: height,
      genesisTxid: txid,
      genesisTime: time,
    });
    return;
  }
  // Upgrade toward FT+NFT. Never downgrade. Don't rewrite genesis.
  const wasFT = existing.tokenType === "FT" || existing.tokenType === "FT+NFT";
  const wasNFT = existing.tokenType === "NFT" || existing.tokenType === "FT+NFT";
  existing.tokenType = classifyType(wasFT || hasFT, wasNFT || hasNFT);
}

async function loadBackfillThrough(): Promise<number> {
  const r = await query<{ backfill_through: number | null }>(
    "SELECT backfill_through FROM sync_state WHERE id = 1"
  );
  return r.rows[0]?.backfill_through ?? CASHTOKEN_START_BLOCK - 1;
}

async function saveBackfillThrough(height: number, complete: boolean): Promise<void> {
  await query(
    `UPDATE sync_state
        SET backfill_through = $1,
            backfill_complete = $2,
            updated_at = now()
      WHERE id = 1`,
    [height, complete]
  );
}

// Flush a batch of observed categories into Postgres. We insert new rows with
// ON CONFLICT DO NOTHING (genesis is immutable), then separately UPDATE
// token_type upward for categories that might have existed before.
async function flushBatch(batch: Map<string, FoundCategory>): Promise<number> {
  if (batch.size === 0) return 0;

  const rows = [...batch.values()];
  await withTransaction(async (client) => {
    for (const r of rows) {
      const categoryBytes = bytesFromHex(r.categoryHex);
      const txidBytes = bytesFromHex(r.genesisTxid);
      await client.query(
        `INSERT INTO tokens
          (category, token_type, genesis_txid, genesis_block, genesis_time, discovery_source)
         VALUES ($1, $2, $3, $4, to_timestamp($5), 'bchn')
         ON CONFLICT (category) DO UPDATE
           SET token_type = CASE
             WHEN tokens.token_type = EXCLUDED.token_type THEN tokens.token_type
             WHEN tokens.token_type = 'FT+NFT' OR EXCLUDED.token_type = 'FT+NFT' THEN 'FT+NFT'
             WHEN (tokens.token_type = 'FT' AND EXCLUDED.token_type = 'NFT')
               OR (tokens.token_type = 'NFT' AND EXCLUDED.token_type = 'FT') THEN 'FT+NFT'
             ELSE tokens.token_type
           END`,
        [categoryBytes, r.tokenType, txidBytes, r.genesisBlock, r.genesisTime]
      );
    }
  });
  return rows.length;
}

async function main(): Promise<void> {
  const startedAt = performance.now();
  console.error(`[backfill] starting against ${process.env.BCHN_RPC_URL}`);

  const info = await bchn.getBlockchainInfo();
  const tip = info.blocks;
  const through = await loadBackfillThrough();
  const startHeight = Math.max(through + 1, CASHTOKEN_START_BLOCK);

  if (startHeight > tip) {
    console.error(`[backfill] already at tip (${tip}); nothing to do`);
    await saveBackfillThrough(tip, true);
    await closePool();
    return;
  }

  console.error(
    `[backfill] scanning ${tip - startHeight + 1} blocks (${startHeight}..${tip})`
  );

  // We buffer observations for up to CHECKPOINT_EVERY blocks, then flush to
  // Postgres in a single transaction and advance the checkpoint. This keeps
  // the DB write rate sane and the crash-loss window bounded.
  let batch = new Map<string, FoundCategory>();
  let flushedTotal = 0;
  let lastCheckpoint = startHeight - 1;

  for (let height = startHeight; height <= tip; height++) {
    let block: Awaited<ReturnType<typeof bchn.getBlockByHeight>>;
    try {
      block = await bchn.getBlockByHeight(height);
    } catch (err) {
      console.error(`[backfill] error fetching block ${height}: ${(err as Error).message}`);
      // On error, flush what we have and abort — a human should investigate.
      await flushBatch(batch);
      await saveBackfillThrough(lastCheckpoint, false);
      await closePool();
      process.exit(1);
    }

    for (const tx of block.tx) {
      // Per-tx accumulators so we can attribute the genesis_txid correctly.
      const perTx = new Map<string, { hasFT: boolean; hasNFT: boolean }>();
      for (const vout of tx.vout) {
        const td = vout.tokenData;
        if (!td?.category) continue;
        const entry = perTx.get(td.category) ?? { hasFT: false, hasNFT: false };
        if (td.amount && BigInt(td.amount) > 0n) entry.hasFT = true;
        if (td.nft) entry.hasNFT = true;
        perTx.set(td.category, entry);
      }
      for (const [cat, { hasFT, hasNFT }] of perTx) {
        observe(batch, cat, hasFT, hasNFT, height, block.time, tx.txid);
      }
    }

    if (height % PROGRESS_EVERY === 0) {
      const elapsed = (performance.now() - startedAt) / 1000;
      const done = height - startHeight + 1;
      const total = tip - startHeight + 1;
      const rate = done / elapsed;
      const eta = (total - done) / Math.max(rate, 0.1);
      console.error(
        `[backfill] ${height}/${tip} (${((done / total) * 100).toFixed(1)}%) ` +
          `${rate.toFixed(1)} blocks/s, ETA ${Math.round(eta)}s, ` +
          `buffered ${batch.size} cats`
      );
    }

    if (height - lastCheckpoint >= CHECKPOINT_EVERY) {
      flushedTotal += await flushBatch(batch);
      batch = new Map();
      await saveBackfillThrough(height, false);
      lastCheckpoint = height;
    }
  }

  // Final flush.
  flushedTotal += await flushBatch(batch);
  await saveBackfillThrough(tip, true);

  const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
  console.error(
    `[backfill] done. ${tip - startHeight + 1} blocks scanned in ${elapsed}s, ` +
      `${flushedTotal} category writes.`
  );

  const total = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM tokens");
  console.error(`[backfill] tokens row count: ${total.rows[0].count}`);

  await closePool();
}

main().catch(async (err) => {
  console.error("[backfill] fatal:", err);
  await closePool().catch(() => {});
  process.exit(1);
});
