// scripts/verify-current-state.ts
// Phase 5 — cross-check supply numbers between our local BlockBook (via the
// Phase 4 enrichment pipeline) and our local BCHN (via scantxoutset). Runs
// weekly. Purely a correctness canary — never blocks or rewrites state.
//
// Sample size is small (default 50 categories) because scantxoutset is
// relatively heavy on BCHN. Disagreements go to stderr with enough context to
// triage by hand.

import * as bchn from "../lib/bchn";
import * as bb from "../lib/blockbook";
import { closePool, hexFromBytes, query } from "../lib/pg";

const SAMPLE_SIZE = Number(process.env.VERIFY_SAMPLE ?? "50");

async function pickSample(n: number): Promise<string[]> {
  const r = await query<{ category: Buffer }>(
    `SELECT t.category
       FROM tokens t
      WHERE EXISTS (SELECT 1 FROM token_state ts WHERE ts.category = t.category)
      ORDER BY random()
      LIMIT $1`,
    [n]
  );
  return r.rows.map((row) => hexFromBytes(row.category)!).filter(Boolean) as string[];
}

interface BchnAgg {
  supply: bigint;
  utxoCount: number;
  nftCount: number;
}

function bchnAggFromScan(
  result: Awaited<ReturnType<typeof bchn.scanTxOutSetByCategory>>
): BchnAgg {
  let supply = 0n;
  let nftCount = 0;
  for (const u of result.unspents) {
    const td = u.tokenData;
    if (!td) continue;
    if (td.amount) supply += BigInt(td.amount);
    if (td.nft) nftCount += 1;
  }
  return { supply, utxoCount: result.unspents.length, nftCount };
}

async function blockbookAgg(categoryHex: string): Promise<BchnAgg> {
  const utxos = await bb.getUtxosByCategory(categoryHex);
  let supply = 0n;
  let nftCount = 0;
  for (const u of utxos) {
    const td = u.tokenData;
    if (!td) continue;
    if (td.amount) supply += BigInt(td.amount);
    if (td.nft) nftCount += 1;
  }
  return { supply, utxoCount: utxos.length, nftCount };
}

function formatDiff(bchnAgg: BchnAgg, bbAgg: BchnAgg): string | null {
  const parts: string[] = [];
  if (bchnAgg.supply !== bbAgg.supply) {
    parts.push(`supply ${bchnAgg.supply} (bchn) vs ${bbAgg.supply} (blockbook)`);
  }
  if (bchnAgg.utxoCount !== bbAgg.utxoCount) {
    parts.push(`utxos ${bchnAgg.utxoCount} vs ${bbAgg.utxoCount}`);
  }
  if (bchnAgg.nftCount !== bbAgg.nftCount) {
    parts.push(`nfts ${bchnAgg.nftCount} vs ${bbAgg.nftCount}`);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

async function main(): Promise<void> {
  const sample = await pickSample(SAMPLE_SIZE);
  if (sample.length === 0) {
    console.error("[verify] no categories with state to sample; nothing to do");
    await closePool();
    return;
  }

  console.error(`[verify] sampling ${sample.length} categories`);

  let agreements = 0;
  let disagreements = 0;

  for (const catHex of sample) {
    try {
      const [bchnScan, bbRes] = await Promise.all([
        bchn.scanTxOutSetByCategory(catHex),
        blockbookAgg(catHex),
      ]);
      const bchnAgg = bchnAggFromScan(bchnScan);
      const diff = formatDiff(bchnAgg, bbRes);
      if (diff) {
        disagreements += 1;
        console.error(`[verify] ⚠ ${catHex}: ${diff}`);
      } else {
        agreements += 1;
      }
    } catch (err) {
      console.error(`[verify] ${catHex}: error: ${(err as Error).message}`);
    }
  }

  console.error(
    `[verify] done. ${agreements}/${sample.length} agreed, ${disagreements} disagreed.`
  );

  await query(
    `UPDATE sync_state SET last_verify_run_at = now(), updated_at = now() WHERE id = 1`
  );
  await closePool();
}

main().catch(async (err) => {
  console.error("[verify] fatal:", err);
  await closePool().catch(() => {});
  process.exit(1);
});
