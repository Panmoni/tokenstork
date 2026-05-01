// Wallet-tied watchlist persistence. Server-only.
//
// Auth is the gate — every helper in here assumes the caller has already
// verified `event.locals.user`. The cashaddr argument is trusted (came
// from the verified session).

import { query, withTransaction } from './db';

/** Hard cap on watchlist size. Without it a single account can add
 *  every category in `tokens`, after which every layout-level loader
 *  hydrates a multi-MB payload on every page. 500 covers any
 *  realistic personal use; an operator can raise it via env if a
 *  legitimate power-user surfaces. */
export const WATCHLIST_MAX_ENTRIES = 500;

export class WatchlistCapError extends Error {
	constructor(cap: number) {
		super(`watchlist cap of ${cap} entries reached`);
		this.name = 'WatchlistCapError';
	}
}

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
 *  Hard cap: the INSERT is gated on the wallet's current entry count
 *  being below WATCHLIST_MAX_ENTRIES. When the cap is reached, the
 *  helper throws WatchlistCapError instead of silently producing an
 *  inconsistent state (DELETE succeeded, INSERT skipped → "I unwatched
 *  but the UI still shows it as added"). The DELETE branch (un-watch)
 *  is never gated.
 *
 *  Pre-fix this was two separate `query()` calls. With autocommit each
 *  statement is atomic on its own, but the pair wasn't — a concurrent
 *  toggle could observe the row mid-flight. Last-click-wins semantics
 *  still held, but a single round-trip is cleaner + cheaper. */
export async function toggleWatchlist(
	cashaddr: string,
	category: Buffer
): Promise<{ inWatchlist: boolean }> {
	return withTransaction(async (client) => {
		// Per-wallet serialization. Without this, all CTEs share a single
		// snapshot — two concurrent toggles for *different* categories
		// from the same wallet at count = MAX-1 both pass the
		// `wlcount.n < MAX` check, both INSERT, ending at MAX+1. An
		// xact-scoped advisory lock keyed on cashaddr forces concurrent
		// toggles per wallet to queue, so the COUNT is always read
		// against the post-prior-write state.
		await client.query(
			`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
			[cashaddr]
		);

		const res = await client.query<{
			in_watchlist: boolean;
			was_present: boolean;
			hit_cap: boolean;
		}>(
			`WITH existing AS (
			   SELECT 1 FROM user_watchlist
			    WHERE cashaddr = $1 AND category = $2
			 ), wlcount AS (
			   SELECT COUNT(*)::int AS n FROM user_watchlist WHERE cashaddr = $1
			 ), del AS (
			   DELETE FROM user_watchlist
			    WHERE cashaddr = $1 AND category = $2
			      AND EXISTS (SELECT 1 FROM existing)
			  RETURNING 1
			 ), ins AS (
			   INSERT INTO user_watchlist (cashaddr, category)
			   SELECT $1, $2
			    WHERE NOT EXISTS (SELECT 1 FROM existing)
			      AND (SELECT n FROM wlcount) < $3
			  ON CONFLICT (cashaddr, category) DO NOTHING
			  RETURNING 1
			 )
			 SELECT
			   EXISTS (SELECT 1 FROM ins)                                 AS in_watchlist,
			   EXISTS (SELECT 1 FROM existing)                            AS was_present,
			   (NOT EXISTS (SELECT 1 FROM existing))
			     AND ((SELECT n FROM wlcount) >= $3)                      AS hit_cap`,
			[cashaddr, category, WATCHLIST_MAX_ENTRIES]
		);
		const row = res.rows[0];
		if (row && row.hit_cap) {
			throw new WatchlistCapError(WATCHLIST_MAX_ENTRIES);
		}
		return { inWatchlist: row?.in_watchlist ?? false };
	});
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
