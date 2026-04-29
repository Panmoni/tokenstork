// scripts/snapshot-leaderboards.ts
// Daily snapshot of the three vote leaderboards into
// `vote_leaderboard_history`. Run once per UTC day via systemd timer
// (or external cron). Idempotent on a given day_utc — re-running upserts
// the same set of (day, bucket, category) rows.
//
// Top-N captured: TOP_N (default 10) per bucket. The detail page renders
// "top 5" badges; the extra rows (6-10) are kept so the badge tier can be
// widened later without re-running the snapshot for past days.
//
// Mirrors the per-vote contribution math from
// `src/lib/server/votes.ts` (VOTE_TENURE_CTE_BODY +
// VOTE_CONTRIBUTION_SQL). Kept inline because this script lives outside
// the SvelteKit module graph and can't import `$env/dynamic/private`.
//
// Usage:
//   npm run sync:leaderboards
// or directly:
//   tsx scripts/snapshot-leaderboards.ts

import { closePool, withTransaction } from "../lib/pg";

const TOP_N = Number(process.env.LEADERBOARD_TOP_N ?? "10");

// Same fragments as src/lib/server/votes.ts. If this script and the live
// page ever drift, the fix is to re-source both from one place — but the
// SvelteKit module boundary makes that costly enough that copying with a
// pointer comment is the better default today.
const VOTE_TENURE_CTE_BODY =
  `SELECT cashaddr, COUNT(*)::int AS tenure_days
     FROM user_vote_actions
    GROUP BY cashaddr`;

const VOTE_CONTRIBUTION_SQL =
  `(LN(COALESCE(tn.tenure_days, 0) + 2) / LN(2))
   * POWER(0.5, EXTRACT(EPOCH FROM (now() - uv.voted_at)) / 86400.0 / 7.0)`;

// Same fragment as src/lib/moderation.ts.
const NOT_MODERATED_CLAUSE = `NOT EXISTS (
  SELECT 1 FROM token_moderation mod WHERE mod.category = t.category
)`;

interface BucketSpec {
  name: "upvoted" | "downvoted" | "controversial";
  orderExpr: string;
  // Secondary tie-breaker. MUST match the per-bucket secondary key in
  // src/lib/server/votes.ts:getVoteLeaderboards, otherwise two tokens
  // tied on the primary score would rank one way on the live homepage
  // card and the other way in this snapshot — making the badges +
  // medal counts diverge from what visitors saw "as of yesterday."
  tieBreakExpr: string;
  // Per-bucket eligibility WHERE clause. Mirrors the per-bucket filters
  // in src/lib/server/votes.ts:getVoteLeaderboards — keeps degenerate
  // rows (0-up tokens in "most upvoted", 0-down tokens in "most
  // downvoted", single-direction entries in "controversial") out of
  // both the live homepage list and the daily snapshot history.
  whereExpr: string;
}

const BUCKETS: BucketSpec[] = [
  { name: "upvoted",       orderExpr: "(hot_up - hot_down)",                            tieBreakExpr: "hot_up",              whereExpr: "up_count > 0" },
  { name: "downvoted",     orderExpr: "(hot_down - hot_up)",                            tieBreakExpr: "hot_down",            whereExpr: "down_count > 0" },
  { name: "controversial", orderExpr: "LEAST(hot_up, hot_down) * (hot_up + hot_down)",  tieBreakExpr: "(hot_up + hot_down)", whereExpr: "up_count > 0 AND down_count > 0" },
];

async function main() {
  const t0 = Date.now();
  const result = await withTransaction(async (client) => {
    const dayRes = await client.query<{ day: string }>(
      `SELECT (now() AT TIME ZONE 'UTC')::date::text AS day`
    );
    const day = dayRes.rows[0].day;

    // One pass to compute aggregate (up, down, hot_up, hot_down) per
    // category. Subsequent per-bucket statements rank from this temp.
    await client.query(
      `CREATE TEMP TABLE _snap_agg ON COMMIT DROP AS
       WITH tenure AS MATERIALIZED (${VOTE_TENURE_CTE_BODY}),
       weighted AS (
         SELECT uv.category,
                uv.vote,
                (${VOTE_CONTRIBUTION_SQL}) AS contribution
           FROM user_votes uv
           LEFT JOIN tenure tn ON tn.cashaddr = uv.cashaddr
           JOIN tokens t ON t.category = uv.category
          WHERE ${NOT_MODERATED_CLAUSE}
       )
       SELECT category,
              SUM((vote = 'up')::int)::int   AS up_count,
              SUM((vote = 'down')::int)::int AS down_count,
              COALESCE(SUM(contribution) FILTER (WHERE vote = 'up'),   0)::float8 AS hot_up,
              COALESCE(SUM(contribution) FILTER (WHERE vote = 'down'), 0)::float8 AS hot_down
         FROM weighted
         GROUP BY category`
    );

    // DELETE-then-INSERT per (day_utc, bucket) is intentional. A naive
    // INSERT … ON CONFLICT DO UPDATE leaves orphaned rows behind when a
    // re-run on the same day produces a different membership set:
    // run 1 with TOP_N=10 inserts ranks 1-10; run 2 with TOP_N=5 only
    // touches ranks 1-5; rows 6-10 from run 1 remain at their old ranks
    // forever, contaminating the streak walk and medal tallies (a
    // briefly-top-10 token would still show up as a top-10 day in
    // history even after dropping out). Wiping the day's rows for the
    // bucket and re-inserting from the fresh ranking is the only way to
    // make the snapshot table reflect "ranking as of this run" rather
    // than the union of all runs.
    const counts: Record<string, number> = {};
    for (const { name, orderExpr, tieBreakExpr, whereExpr } of BUCKETS) {
      await client.query(
        `DELETE FROM vote_leaderboard_history
          WHERE day_utc = $1::date AND bucket = $2`,
        [day, name]
      );
      const ins = await client.query(
        `WITH eligible AS (
           SELECT category, up_count, down_count, hot_up, hot_down
             FROM _snap_agg
            WHERE ${whereExpr}
         ),
         ranked AS (
           SELECT category,
                  up_count,
                  down_count,
                  ${orderExpr}::float8 AS score,
                  ROW_NUMBER() OVER (ORDER BY ${orderExpr} DESC, ${tieBreakExpr} DESC) AS rn
             FROM eligible
         )
         INSERT INTO vote_leaderboard_history
           (day_utc, bucket, category, rank, score, up_count, down_count)
         SELECT $1::date, $2, category, rn::int, score, up_count, down_count
           FROM ranked
          WHERE rn <= $3`,
        [day, name, TOP_N]
      );
      counts[name] = ins.rowCount ?? 0;
    }

    await client.query(
      `UPDATE sync_state
          SET last_leaderboard_snapshot_at = now(),
              last_leaderboard_snapshot_day = $1::date,
              updated_at = now()
        WHERE id = 1`,
      [day]
    );

    return { day, counts };
  });

  const ms = Date.now() - t0;
  console.log(
    `[snapshot-leaderboards] day=${result.day} top_n=${TOP_N} ` +
      `upvoted=${result.counts.upvoted} downvoted=${result.counts.downvoted} ` +
      `controversial=${result.counts.controversial} elapsed_ms=${ms}`
  );
}

main()
  .catch((err) => {
    console.error("[snapshot-leaderboards] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    closePool();
  });
