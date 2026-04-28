// Wallet-tied up/down votes on tokens. Server-only.
//
// Auth gate: every helper assumes `event.locals.user` was already verified
// upstream. The cashaddr argument is trusted (came from the verified
// session). One row per (cashaddr, category) — flipping direction
// overwrites; retracting deletes.

import { query, withTransaction } from './db';
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
