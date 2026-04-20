// scripts/tail-from-bchn.ts
// Phase 3 — permanent tail worker. Wakes on every new block via ZMQ, walks
// the delta, and inserts any new CashToken categories into Postgres.
//
// Starts only after Phase 2b backfill has completed
// (sync_state.backfill_complete = true). Until then, exits with a clear
// message.

import * as bchn from "../lib/bchn";
import { bytesFromHex, closePool, query, withTransaction } from "../lib/pg";

const POLL_FALLBACK_MS = 30_000;

interface SyncState {
  backfill_complete: boolean;
  tail_last_block: number | null;
  backfill_through: number | null;
}

async function loadSyncState(): Promise<SyncState> {
  const r = await query<SyncState>(
    `SELECT backfill_complete, tail_last_block, backfill_through
       FROM sync_state WHERE id = 1`
  );
  if (!r.rows[0]) throw new Error("sync_state singleton row missing");
  return r.rows[0];
}

async function saveTailLast(height: number): Promise<void> {
  await query(
    `UPDATE sync_state
        SET tail_last_block = $1, updated_at = now()
      WHERE id = 1`,
    [height]
  );
}

// Extract categories from one block and upsert them into `tokens`.
// Returns the number of distinct categories found (including re-observations).
async function processBlock(
  block: Awaited<ReturnType<typeof bchn.getBlock>>
): Promise<number> {
  interface Obs {
    tokenType: "FT" | "NFT" | "FT+NFT";
    genesisTxid: string;
  }
  const found = new Map<string, Obs>();

  for (const tx of block.tx) {
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
      const tokenType =
        hasFT && hasNFT ? "FT+NFT" : hasNFT ? "NFT" : "FT";
      // First observation of this category in this block wins the genesis_txid
      // assignment for this tail pass — but we only insert if the category is
      // actually new to the DB. Existing categories won't have their genesis
      // overwritten thanks to ON CONFLICT DO UPDATE below.
      if (!found.has(cat)) {
        found.set(cat, { tokenType, genesisTxid: tx.txid });
      } else {
        const ex = found.get(cat)!;
        const wasFT = ex.tokenType === "FT" || ex.tokenType === "FT+NFT";
        const wasNFT = ex.tokenType === "NFT" || ex.tokenType === "FT+NFT";
        ex.tokenType =
          (wasFT || hasFT) && (wasNFT || hasNFT)
            ? "FT+NFT"
            : wasNFT || hasNFT
              ? "NFT"
              : "FT";
      }
    }
  }

  if (found.size === 0) return 0;

  await withTransaction(async (client) => {
    for (const [catHex, obs] of found) {
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
        [
          bytesFromHex(catHex),
          obs.tokenType,
          bytesFromHex(obs.genesisTxid),
          block.height,
          block.time,
        ]
      );
    }
  });

  return found.size;
}

// Catch up from `from` through `to` inclusive. Called both on startup and
// whenever we receive a ZMQ notification.
async function catchUp(from: number, to: number): Promise<void> {
  for (let h = from; h <= to; h++) {
    const block = await bchn.getBlockByHeight(h);
    const n = await processBlock(block);
    await saveTailLast(h);
    if (n > 0) {
      console.error(`[tail] block ${h}: ${n} categor${n === 1 ? "y" : "ies"} touched`);
    } else {
      console.error(`[tail] block ${h}: no tokens`);
    }
  }
}

async function main(): Promise<void> {
  const state = await loadSyncState();

  if (!state.backfill_complete) {
    console.error("[tail] backfill is not complete; refusing to start. Run sync:backfill first.");
    await closePool();
    process.exit(2);
  }

  let lastSeen = state.tail_last_block ?? state.backfill_through ?? 0;
  if (lastSeen === 0) {
    throw new Error("neither tail_last_block nor backfill_through is set");
  }

  // Initial catch-up in case we were offline.
  const tipAtStart = await bchn.getBlockCount();
  if (tipAtStart > lastSeen) {
    console.error(`[tail] catch-up: ${lastSeen + 1}..${tipAtStart}`);
    await catchUp(lastSeen + 1, tipAtStart);
    lastSeen = tipAtStart;
  } else {
    console.error(`[tail] at tip (${lastSeen}); waiting for new blocks`);
  }

  // Track ZMQ stream; fall back to polling if the subscription dies.
  let running = true;
  process.on("SIGINT", () => {
    running = false;
    console.error("[tail] SIGINT; shutting down");
  });
  process.on("SIGTERM", () => {
    running = false;
    console.error("[tail] SIGTERM; shutting down");
  });

  // Kick off a polling fallback in parallel. If ZMQ is working it'll just find
  // nothing new each tick.
  const pollLoop = (async () => {
    while (running) {
      await new Promise((r) => setTimeout(r, POLL_FALLBACK_MS));
      if (!running) break;
      try {
        const tip = await bchn.getBlockCount();
        if (tip > lastSeen) {
          console.error(`[tail] poll caught delta: ${lastSeen + 1}..${tip}`);
          await catchUp(lastSeen + 1, tip);
          lastSeen = tip;
        }
      } catch (err) {
        console.error(`[tail] poll error: ${(err as Error).message}`);
      }
    }
  })();

  try {
    for await (const _hashHex of bchn.subscribeHashBlock()) {
      if (!running) break;
      try {
        const tip = await bchn.getBlockCount();
        if (tip <= lastSeen) continue;
        await catchUp(lastSeen + 1, tip);
        lastSeen = tip;
      } catch (err) {
        console.error(`[tail] catch-up error: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    console.error(`[tail] ZMQ stream error: ${(err as Error).message}`);
  }

  await pollLoop;
  await closePool();
}

main().catch(async (err) => {
  console.error("[tail] fatal:", err);
  await closePool().catch(() => {});
  process.exit(1);
});
