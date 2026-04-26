// Wallet-tied watchlist persistence. Server-only.
//
// Auth is the gate — every helper in here assumes the caller has already
// verified `event.locals.user`. The cashaddr argument is trusted (came
// from the verified session).

import { query } from './db';

/** Add a category to the user's watchlist. ON CONFLICT DO NOTHING — the
 *  PK is (cashaddr, category) so re-adding is a no-op. */
export async function addToWatchlist(
	cashaddr: string,
	category: Buffer
): Promise<void> {
	await query(
		`INSERT INTO user_watchlist (cashaddr, category)
		 VALUES ($1, $2)
		 ON CONFLICT (cashaddr, category) DO NOTHING`,
		[cashaddr, category]
	);
}

/** Remove a category from the user's watchlist. Idempotent. */
export async function removeFromWatchlist(
	cashaddr: string,
	category: Buffer
): Promise<void> {
	await query(
		`DELETE FROM user_watchlist WHERE cashaddr = $1 AND category = $2`,
		[cashaddr, category]
	);
}

/** Toggle: returns the post-toggle state (true = now watching, false =
 *  now not watching). Implemented as a single CTE so the DELETE +
 *  conditional INSERT happen in one statement (atomic with respect to
 *  any concurrent toggle for the same (cashaddr, category) pair).
 *
 *  Pre-fix this was two separate `query()` calls. With autocommit each
 *  statement is atomic on its own, but the pair wasn't — a concurrent
 *  toggle could observe the row mid-flight. Last-click-wins semantics
 *  still held, but a single round-trip is cleaner + cheaper. */
export async function toggleWatchlist(
	cashaddr: string,
	category: Buffer
): Promise<{ inWatchlist: boolean }> {
	const res = await query<{ in_watchlist: boolean }>(
		`WITH del AS (
		   DELETE FROM user_watchlist
		    WHERE cashaddr = $1 AND category = $2
		  RETURNING 1
		), ins AS (
		   INSERT INTO user_watchlist (cashaddr, category)
		   SELECT $1, $2
		    WHERE NOT EXISTS (SELECT 1 FROM del)
		  ON CONFLICT (cashaddr, category) DO NOTHING
		  RETURNING 1
		 )
		 SELECT EXISTS (SELECT 1 FROM ins) AS in_watchlist`,
		[cashaddr, category]
	);
	return { inWatchlist: res.rows[0]?.in_watchlist ?? false };
}

/** Read the full set of categories the user is watching, in
 *  most-recently-added-first order. Returns Buffer[] for the BYTEA
 *  column; caller renders to hex. */
export async function listWatchlistCategories(cashaddr: string): Promise<Buffer[]> {
	const res = await query<{ category: Buffer }>(
		`SELECT category FROM user_watchlist
		  WHERE cashaddr = $1
		  ORDER BY added_at DESC`,
		[cashaddr]
	);
	return res.rows.map((r) => r.category);
}

/** Just the count — used by the header pill so we don't fetch full rows
 *  on every page load. */
export async function countWatchlist(cashaddr: string): Promise<number> {
	const res = await query<{ n: string }>(
		`SELECT COUNT(*)::bigint AS n FROM user_watchlist WHERE cashaddr = $1`,
		[cashaddr]
	);
	return Number(res.rows[0]?.n ?? 0);
}
