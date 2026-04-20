// scripts/enrich-from-blockbook.ts
// Phase 4 — for each token category, pull current UTXO + holder + NFT state
// from our local BlockBook and write it to Postgres. Intended to run on a
// schedule (systemd timer every 6 hours).
//
// For each run, we pick a batch of categories whose token_state is either
// missing or older than ACTIVE_STALE_AGE (for non-burned ones) /
// BURNED_STALE_AGE (for fully-burned ones). Burned categories get refreshed
// much less often since they can't change without the tail detecting new
// chain activity — and the tail will reset their row when that happens.

import * as bb from "../lib/blockbook";
import {
  bytesFromHex,
  closePool,
  hexFromBytes,
  query,
  withTransaction,
} from "../lib/pg";

const BATCH_SIZE = Number(process.env.ENRICH_BATCH ?? "200");
const ACTIVE_STALE_AGE_HOURS = 6;
const BURNED_STALE_AGE_HOURS = 24 * 7;

// Addresses returned by BlockBook are cashaddr-style, sometimes prefixed with
// `bitcoincash:`. Strip the prefix to normalize.
function normalizeAddress(a: string | undefined): string | null {
  if (!a) return null;
  return a.startsWith("bitcoincash:") ? a.slice("bitcoincash:".length) : a;
}

interface CategoryRow {
  category: Buffer;
}

async function pickBatch(limit: number): Promise<string[]> {
  // Priority order:
  //   1. Categories in `tokens` with no row in `token_state` yet.
  //   2. Categories whose row is older than the relevant stale threshold.
  // Randomize within a priority to spread load across runs.
  const r = await query<CategoryRow>(
    `
    WITH candidates AS (
      SELECT t.category,
             ts.verified_at,
             ts.is_fully_burned
        FROM tokens t
        LEFT JOIN token_state ts ON ts.category = t.category
    )
    SELECT category
      FROM candidates
     WHERE verified_at IS NULL
        OR (is_fully_burned IS NOT TRUE AND verified_at < now() - $1 * interval '1 hour')
        OR (is_fully_burned IS TRUE     AND verified_at < now() - $2 * interval '1 hour')
     ORDER BY verified_at NULLS FIRST, random()
     LIMIT $3
    `,
    [ACTIVE_STALE_AGE_HOURS, BURNED_STALE_AGE_HOURS, limit]
  );
  return r.rows.map((row) => hexFromBytes(row.category)!).filter(Boolean) as string[];
}

interface AggregatedState {
  currentSupply: bigint;
  liveUtxoCount: number;
  liveNftCount: number;
  holderCount: number;
  hasActiveMinting: boolean;
  holders: Map<string, { balance: bigint; nftCount: number }>;
  nfts: Array<{ commitmentHex: string; capability: "none" | "mutable" | "minting"; owner: string | null }>;
}

function aggregate(utxos: bb.BbUtxo[]): AggregatedState {
  const holders = new Map<string, { balance: bigint; nftCount: number }>();
  const nfts: AggregatedState["nfts"] = [];
  let supply = 0n;
  let nftCount = 0;
  let hasMinting = false;

  for (const u of utxos) {
    const td = u.tokenData;
    if (!td) continue;
    const owner = normalizeAddress(u.address);
    const amount = td.amount ? BigInt(td.amount) : 0n;
    supply += amount;

    if (owner) {
      const h = holders.get(owner) ?? { balance: 0n, nftCount: 0 };
      h.balance += amount;
      if (td.nft) h.nftCount += 1;
      holders.set(owner, h);
    }

    if (td.nft) {
      nftCount += 1;
      if (td.nft.capability === "minting") hasMinting = true;
      nfts.push({
        commitmentHex: td.nft.commitment ?? "",
        capability: td.nft.capability,
        owner,
      });
    }
  }

  return {
    currentSupply: supply,
    liveUtxoCount: utxos.length,
    liveNftCount: nftCount,
    holderCount: holders.size,
    hasActiveMinting: hasMinting,
    holders,
    nfts,
  };
}

async function writeState(
  categoryHex: string,
  agg: AggregatedState
): Promise<void> {
  const categoryBytes = bytesFromHex(categoryHex);
  const isFullyBurned = agg.liveUtxoCount === 0;

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO token_state
         (category, current_supply, live_utxo_count, live_nft_count,
          holder_count, has_active_minting, is_fully_burned,
          verified_source, verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'blockbook', now())
       ON CONFLICT (category) DO UPDATE SET
         current_supply = EXCLUDED.current_supply,
         live_utxo_count = EXCLUDED.live_utxo_count,
         live_nft_count = EXCLUDED.live_nft_count,
         holder_count = EXCLUDED.holder_count,
         has_active_minting = EXCLUDED.has_active_minting,
         is_fully_burned = EXCLUDED.is_fully_burned,
         verified_source = EXCLUDED.verified_source,
         verified_at = EXCLUDED.verified_at`,
      [
        categoryBytes,
        agg.currentSupply.toString(),
        agg.liveUtxoCount,
        agg.liveNftCount,
        agg.holderCount,
        agg.hasActiveMinting,
        isFullyBurned,
      ]
    );

    // Rebuild per-category: simplest correct approach.
    await client.query("DELETE FROM token_holders WHERE category = $1", [categoryBytes]);
    for (const [addr, { balance, nftCount }] of agg.holders) {
      await client.query(
        `INSERT INTO token_holders (category, address, balance, nft_count, snapshot_at)
         VALUES ($1, $2, $3, $4, now())`,
        [categoryBytes, addr, balance.toString(), nftCount]
      );
    }

    await client.query("DELETE FROM nft_instances WHERE category = $1", [categoryBytes]);
    for (const n of agg.nfts) {
      if (!n.commitmentHex) continue; // skip malformed — unlikely, belt+braces
      await client.query(
        `INSERT INTO nft_instances (category, commitment, capability, owner_address, snapshot_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (category, commitment) DO UPDATE SET
           capability = EXCLUDED.capability,
           owner_address = EXCLUDED.owner_address,
           snapshot_at = EXCLUDED.snapshot_at`,
        [categoryBytes, bytesFromHex(n.commitmentHex), n.capability, n.owner]
      );
    }
  });
}

async function enrichOne(categoryHex: string): Promise<{ ok: boolean; liveUtxos: number }> {
  try {
    const utxos = await bb.getUtxosByCategory(categoryHex);
    const agg = aggregate(utxos);
    await writeState(categoryHex, agg);
    return { ok: true, liveUtxos: agg.liveUtxoCount };
  } catch (err) {
    console.error(`[enrich] ${categoryHex}: ${(err as Error).message}`);
    return { ok: false, liveUtxos: 0 };
  }
}

async function main(): Promise<void> {
  const startedAt = Date.now();

  // Sanity-check BlockBook is reachable before we start churning through the DB.
  const info = await bb.getNodeInfo();
  if (info.blockbook.inSync === false) {
    console.error("[enrich] BlockBook is not in sync; aborting");
    await closePool();
    process.exit(2);
  }
  console.error(
    `[enrich] BlockBook ok, tip=${info.blockbook.bestHeight ?? info.backend?.blocks}`
  );

  const batch = await pickBatch(BATCH_SIZE);
  if (batch.length === 0) {
    console.error("[enrich] nothing stale; exiting");
    await query(
      `UPDATE sync_state SET last_enrich_run_at = now(), updated_at = now() WHERE id = 1`
    );
    await closePool();
    return;
  }

  console.error(`[enrich] processing ${batch.length} categor${batch.length === 1 ? "y" : "ies"}`);

  let okCount = 0;
  let burnedCount = 0;
  for (const catHex of batch) {
    const { ok, liveUtxos } = await enrichOne(catHex);
    if (ok) okCount += 1;
    if (ok && liveUtxos === 0) burnedCount += 1;
  }

  await query(
    `UPDATE sync_state SET last_enrich_run_at = now(), updated_at = now() WHERE id = 1`
  );

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.error(
    `[enrich] done. ${okCount}/${batch.length} succeeded, ${burnedCount} fully-burned, ${elapsed}s`
  );
  await closePool();
}

main().catch(async (err) => {
  console.error("[enrich] fatal:", err);
  await closePool().catch(() => {});
  process.exit(1);
});
