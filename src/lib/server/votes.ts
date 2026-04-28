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

/** Top-N leaderboards over `user_votes`. Three buckets — most upvoted
 *  (net score), most downvoted (-net), most controversial (Reddit-style
 *  product LEAST(up,down) × (up+down) — favours volume + balanced split,
 *  so a 50-up/0-down token is correctly NOT controversial).
 *
 *  Single round-trip with bounded payload: the agg CTE runs once;
 *  per-bucket `ORDER BY … LIMIT 10` CTEs cap the wire payload at 30
 *  rows regardless of `user_votes` size; metadata + icon-safety joins
 *  hit the already-narrowed set, not every voted-on category.
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
		`WITH agg AS (
		   SELECT uv.category,
		          SUM((uv.vote = 'up')::int)::int   AS up,
		          SUM((uv.vote = 'down')::int)::int AS down
		     FROM user_votes uv
		     JOIN tokens t ON t.category = uv.category
		    WHERE NOT EXISTS (SELECT 1 FROM token_moderation mod WHERE mod.category = t.category)
		    GROUP BY uv.category
		 ),
		 top_upvoted AS (
		   SELECT category, up, down, 'upvoted'::text AS bucket
		     FROM agg
		    ORDER BY (up - down) DESC, up DESC
		    LIMIT 10
		 ),
		 top_downvoted AS (
		   SELECT category, up, down, 'downvoted'::text AS bucket
		     FROM agg
		    ORDER BY (down - up) DESC, down DESC
		    LIMIT 10
		 ),
		 top_controversial AS (
		   SELECT category, up, down, 'controversial'::text AS bucket
		     FROM agg
		    ORDER BY LEAST(up, down) * (up + down) DESC, (up + down) DESC
		    LIMIT 10
		 ),
		 combined AS (
		   SELECT *, ROW_NUMBER() OVER (PARTITION BY bucket
		                                ORDER BY
		                                  CASE bucket
		                                    WHEN 'upvoted'       THEN (up - down)
		                                    WHEN 'downvoted'     THEN (down - up)
		                                    ELSE LEAST(up, down) * (up + down)
		                                  END DESC,
		                                  CASE bucket
		                                    WHEN 'upvoted'       THEN up
		                                    WHEN 'downvoted'     THEN down
		                                    ELSE (up + down)
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
