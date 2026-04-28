// Wallet-tied up/down votes on tokens. Server-only.
//
// Auth gate: every helper assumes `event.locals.user` was already verified
// upstream. The cashaddr argument is trusted (came from the verified
// session). One row per (cashaddr, category) — flipping direction
// overwrites; retracting deletes.

import { query, withTransaction, hexFromBytes } from './db';
import { NOT_MODERATED_CLAUSE } from '$lib/moderation';

export type Vote = 'up' | 'down';
export type VoteState = Vote | null;

export interface VoteResult {
	vote: VoteState;
	upCount: number;
	downCount: number;
}

/** Thrown by `setVote` when the target category is missing from `tokens`
 *  or is moderation-hidden. The API endpoint translates this to a 410
 *  Gone so the client can render a sensible message. Retracts (vote=null)
 *  do not raise this — a user can always remove their existing vote even
 *  if the token has since been hidden. */
export class VoteRejectedError extends Error {
	constructor(message = 'token not eligible for voting') {
		super(message);
		this.name = 'VoteRejectedError';
	}
}

/** Thrown by `setVote` when the caller has used up their daily quota.
 *  Translated to 429 by the API. The increment that triggered the
 *  rejection is rolled back with the rest of the transaction, so a
 *  rejected action does not consume budget. */
export class VoteQuotaError extends Error {
	constructor(message = 'daily vote limit reached (20 / UTC day)') {
		super(message);
		this.name = 'VoteQuotaError';
	}
}

/** Per-wallet daily vote-action limit (UTC). Counts every successful
 *  setVote call — cast, change, or retract — toward the same budget.
 *  Tunable here without a schema change. */
export const DAILY_VOTE_LIMIT = 20;

// =====================================================================
// Shared SQL fragments for the tenure-weighted hot-ranking score.
//
// Two consumers — getVoteLeaderboards (homepage leaderboards) and the
// directory's `?sort=upvoted/downvoted/controversial` lateral in
// src/routes/+page.server.ts — both compute the same per-vote
// contribution. Single source of truth here so the two can't drift:
// if the half-life or log-base is ever retuned, both sites update via
// a single edit.
//
// Caller conventions:
//   * Wrap `VOTE_TENURE_CTE_BODY` in `WITH tenure AS MATERIALIZED (...)`
//     at the top of the query. MATERIALIZED forces PG to compute the
//     full-table aggregate once per query rather than inline it into
//     each reference (which would defeat the hoist).
//   * Reference the CTE via alias `tn` (so `t` stays free for the
//     `tokens` table — keeps NOT_MODERATED_CLAUSE working unchanged).
//   * Reference `user_votes` rows via alias `uv`.
//
// The contribution expression assumes those aliases are in scope.
// =====================================================================

/** Body of the `tenure` CTE — distinct UTC days per voter. Wrap in
 *  `WITH tenure AS MATERIALIZED (…)` at the top of a query. */
export const VOTE_TENURE_CTE_BODY =
	`SELECT cashaddr, COUNT(*)::int AS tenure_days
	   FROM user_vote_actions
	  GROUP BY cashaddr`;

/** Per-vote contribution: `voter_weight × time_decay`, where
 *    voter_weight = LN(tenure_days + 2) / LN(2)    -- log₂(t+2)
 *    time_decay   = 0.5 ^ (age_days / 7)            -- 7-day half-life
 *  Caller binds aliases `uv` (user_votes) and `tn` (tenure CTE).
 *  See /faq#faq-vote-ranking for the user-facing explanation. */
export const VOTE_CONTRIBUTION_SQL =
	`(LN(COALESCE(tn.tenure_days, 0) + 2) / LN(2))
	 * POWER(0.5, EXTRACT(EPOCH FROM (now() - uv.voted_at)) / 86400.0 / 7.0)`;

/** Set / change / retract a user's vote on a token in a single transaction.
 *
 *  Semantics:
 *    setVote(_, _, 'up' | 'down')  — INSERT … ON CONFLICT DO UPDATE,
 *                                    gated on the token existing and not
 *                                    being moderated. Throws
 *                                    VoteRejectedError on either failure.
 *    setVote(_, _, null)           — DELETE the user's row if any. Always
 *                                    permitted (retracts are allowed
 *                                    even after a token is moderated).
 *
 *  Atomicity: the write + the post-write count read run inside one
 *  transaction on a single connection. Under PG's default READ COMMITTED
 *  the second SELECT sees the first statement's effect, and concurrent
 *  toggles for the same (cashaddr, category) row serialize on the
 *  row-level lock acquired by INSERT … ON CONFLICT DO UPDATE. The
 *  returned counts therefore reflect the post-write state of user_votes
 *  including this caller's own change. */
export async function setVote(
	cashaddr: string,
	category: Buffer,
	vote: VoteState
): Promise<VoteResult> {
	return withTransaction(async (client) => {
		// Daily-quota gate. Increment first; if the post-increment count
		// exceeds the limit, throw — the transaction rollback then undoes
		// this increment along with anything else, so a rejected action
		// does not consume budget. Doubles as the source of truth for
		// voter tenure (COUNT(*) of distinct day_utc rows per cashaddr)
		// — see `voter_weight` in getVoteLeaderboards / +page.server.ts.
		const quota = await client.query<{ count: number }>(
			`INSERT INTO user_vote_actions (cashaddr, day_utc, count)
			 VALUES ($1, (now() AT TIME ZONE 'UTC')::date, 1)
			 ON CONFLICT (cashaddr, day_utc) DO UPDATE
			   SET count = user_vote_actions.count + 1
			 RETURNING count`,
			[cashaddr]
		);
		if ((quota.rows[0]?.count ?? 0) > DAILY_VOTE_LIMIT) {
			throw new VoteQuotaError();
		}

		if (vote === null) {
			await client.query(
				`DELETE FROM user_votes WHERE cashaddr = $1 AND category = $2`,
				[cashaddr, category]
			);
		} else {
			// Conditional INSERT — touches zero rows when the token is
			// missing or moderation-hidden. ON CONFLICT only fires when
			// the SELECT produced a row, so changing an existing vote
			// is also gated on the token being un-moderated. rowCount
			// === 0 is the signal to the API layer to return 410.
			const ins = await client.query(
				`INSERT INTO user_votes (cashaddr, category, vote)
				 SELECT $1, $2, $3
				   FROM tokens t
				  WHERE t.category = $2
				    AND ${NOT_MODERATED_CLAUSE}
				 ON CONFLICT (cashaddr, category) DO UPDATE
				   SET vote = EXCLUDED.vote, voted_at = now()`,
				[cashaddr, category, vote]
			);
			if (ins.rowCount === 0) {
				throw new VoteRejectedError();
			}
		}

		const res = await client.query<{ up: string; down: string }>(
			`SELECT
			   COUNT(*) FILTER (WHERE vote = 'up')::bigint   AS up,
			   COUNT(*) FILTER (WHERE vote = 'down')::bigint AS down
			   FROM user_votes
			  WHERE category = $1`,
			[category]
		);

		return {
			vote,
			upCount: Number(res.rows[0]?.up ?? 0),
			downCount: Number(res.rows[0]?.down ?? 0)
		};
	});
}

/** Read every (categoryHex → vote) pair for a user. Used by the layout
 *  server load so VoteButton can render the right state on every grid
 *  row without N+1 lookups.
 *
 *  Filters out moderation-hidden categories so the user's payload doesn't
 *  leak the existence of a hidden category. Cascading delete keeps the
 *  vote rows in sync if a token is fully removed; moderation only hides
 *  (the join + NOT_MODERATED_CLAUSE handles that case). */
export async function listUserVotes(
	cashaddr: string
): Promise<Record<string, Vote>> {
	const res = await query<{ category: Buffer; vote: Vote }>(
		`SELECT uv.category, uv.vote
		   FROM user_votes uv
		   JOIN tokens t ON t.category = uv.category
		  WHERE uv.cashaddr = $1
		    AND ${NOT_MODERATED_CLAUSE}`,
		[cashaddr]
	);
	const out: Record<string, Vote> = {};
	for (const r of res.rows) {
		out[r.category.toString('hex')] = r.vote;
	}
	return out;
}

/** Hot-ranked top-N leaderboards over `user_votes`. Three buckets —
 *  most upvoted (highest weighted net score), most downvoted (lowest
 *  weighted net score), most controversial (LEAST(weighted_up,
 *  weighted_down) × (weighted_up + weighted_down)).
 *
 *  Each vote contributes `±1 × voter_weight × time_decay`:
 *    voter_weight = LN(tenure_days + 2) / LN(2)         — log₂(t+2)
 *    time_decay   = 0.5 ^ (age_days / 7)                 — 7d half-life
 *  See `/faq#faq-vote-ranking` for the user-facing explanation.
 *
 *  The leaderboard *displays* raw integer up/down counts (intuitive for
 *  visitors) but *ranks* by the weighted hot score. Both are returned
 *  in the same row.
 *
 *  Single round-trip with bounded payload: tenure runs once per voter;
 *  weighted contributions aggregate by category; per-bucket
 *  `ORDER BY … LIMIT 10` CTEs cap the wire payload at 30 rows.
 *  Metadata + icon-safety joins hit the narrowed set only.
 *
 *  Moderation: `NOT_MODERATED_CLAUSE` keeps a moderated token from
 *  appearing on any leaderboard, in lockstep with every other public
 *  read path. */
export async function getVoteLeaderboards(): Promise<{
	mostUpvoted: VoteLeader[];
	mostDownvoted: VoteLeader[];
	mostControversial: VoteLeader[];
	totalVotes: number;
}> {
	const sumQ = query<{ total: string }>(
		`SELECT COUNT(*)::bigint AS total FROM user_votes`
	);
	const baseQ = query<VoteLeaderRow>(
		`WITH tenure AS MATERIALIZED (${VOTE_TENURE_CTE_BODY}),
		 weighted AS (
		   SELECT uv.category,
		          uv.vote,
		          (${VOTE_CONTRIBUTION_SQL}) AS contribution
		     FROM user_votes uv
		     LEFT JOIN tenure tn ON tn.cashaddr = uv.cashaddr
		     JOIN tokens t ON t.category = uv.category
		    WHERE ${NOT_MODERATED_CLAUSE}
		 ),
		 agg AS (
		   SELECT category,
		          SUM((vote = 'up')::int)::int   AS up,
		          SUM((vote = 'down')::int)::int AS down,
		          COALESCE(SUM(contribution) FILTER (WHERE vote = 'up'),   0)::float8 AS hot_up,
		          COALESCE(SUM(contribution) FILTER (WHERE vote = 'down'), 0)::float8 AS hot_down
		     FROM weighted
		     GROUP BY category
		 ),
		 top_upvoted AS (
		   SELECT category, up, down, hot_up, hot_down, 'upvoted'::text AS bucket
		     FROM agg
		    ORDER BY (hot_up - hot_down) DESC, hot_up DESC
		    LIMIT 10
		 ),
		 top_downvoted AS (
		   SELECT category, up, down, hot_up, hot_down, 'downvoted'::text AS bucket
		     FROM agg
		    ORDER BY (hot_down - hot_up) DESC, hot_down DESC
		    LIMIT 10
		 ),
		 top_controversial AS (
		   SELECT category, up, down, hot_up, hot_down, 'controversial'::text AS bucket
		     FROM agg
		    ORDER BY LEAST(hot_up, hot_down) * (hot_up + hot_down) DESC, (hot_up + hot_down) DESC
		    LIMIT 10
		 ),
		 combined AS (
		   SELECT *, ROW_NUMBER() OVER (PARTITION BY bucket
		                                ORDER BY
		                                  CASE bucket
		                                    WHEN 'upvoted'       THEN (hot_up - hot_down)
		                                    WHEN 'downvoted'     THEN (hot_down - hot_up)
		                                    ELSE LEAST(hot_up, hot_down) * (hot_up + hot_down)
		                                  END DESC,
		                                  CASE bucket
		                                    WHEN 'upvoted'       THEN hot_up
		                                    WHEN 'downvoted'     THEN hot_down
		                                    ELSE (hot_up + hot_down)
		                                  END DESC) AS rn
		     FROM (SELECT * FROM top_upvoted
		            UNION ALL SELECT * FROM top_downvoted
		            UNION ALL SELECT * FROM top_controversial) x
		 )
		 SELECT c.category,
		        m.name,
		        m.symbol,
		        encode(imo.content_hash, 'hex') AS icon_cleared_hash,
		        m.icon_uri,
		        c.up,
		        c.down,
		        c.bucket
		   FROM combined c
		   LEFT JOIN token_metadata m ON m.category = c.category
		   LEFT JOIN icon_url_scan ius ON ius.icon_uri = m.icon_uri
		   LEFT JOIN icon_moderation imo
		     ON imo.content_hash = ius.content_hash AND imo.state = 'cleared'
		  ORDER BY c.bucket, c.rn`
	);

	const [sumRes, baseRes] = await Promise.allSettled([sumQ, baseQ]);

	const totalVotes =
		sumRes.status === 'fulfilled' ? Number(sumRes.value.rows[0]?.total ?? 0) : 0;

	const mostUpvoted: VoteLeader[] = [];
	const mostDownvoted: VoteLeader[] = [];
	const mostControversial: VoteLeader[] = [];

	if (baseRes.status === 'fulfilled') {
		// Rows arrive ordered by (bucket, rn) so push order matches display
		// order. SQL already capped each bucket at 10 via per-CTE LIMIT —
		// no in-JS cutoff needed.
		for (const r of baseRes.value.rows) {
			const item: VoteLeader = {
				id: hexFromBytes(r.category)!,
				name: r.name,
				symbol: r.symbol,
				iconClearedHash: r.icon_cleared_hash ?? null,
				icon: r.icon_uri,
				upCount: r.up,
				downCount: r.down
			};
			if (r.bucket === 'upvoted') mostUpvoted.push(item);
			else if (r.bucket === 'downvoted') mostDownvoted.push(item);
			else if (r.bucket === 'controversial') mostControversial.push(item);
		}
	} else {
		console.error('[votes] leaderboards failed:', baseRes.reason);
	}

	return { mostUpvoted, mostDownvoted, mostControversial, totalVotes };
}

interface VoteLeaderRow {
	category: Buffer;
	name: string | null;
	symbol: string | null;
	icon_cleared_hash: string | null;
	icon_uri: string | null;
	up: number;
	down: number;
	bucket: 'upvoted' | 'downvoted' | 'controversial';
}

export interface VoteLeader {
	id: string;
	name: string | null;
	symbol: string | null;
	iconClearedHash: string | null;
	icon: string | null;
	upCount: number;
	downCount: number;
}

/** Aggregate (up, down) counts for one category. Used by the per-token
 *  detail page where we don't have the directory's bulk LEFT JOIN. The
 *  detail page already 410s for moderated tokens before this is called,
 *  so no extra moderation filter is needed here. */
export async function getVoteCounts(
	category: Buffer
): Promise<{ upCount: number; downCount: number }> {
	const res = await query<{ up: string; down: string }>(
		`SELECT
		   COUNT(*) FILTER (WHERE vote = 'up')::bigint   AS up,
		   COUNT(*) FILTER (WHERE vote = 'down')::bigint AS down
		   FROM user_votes
		  WHERE category = $1`,
		[category]
	);
	return {
		upCount: Number(res.rows[0]?.up ?? 0),
		downCount: Number(res.rows[0]?.down ?? 0)
	};
}
