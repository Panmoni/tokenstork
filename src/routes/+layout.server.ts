// Global server load: fetch a handful of high-level counters so MetricsBar
// renders a full picture on first paint (SSR), without any client round-trip.
//
// Values issued in parallel:
//   - tokensTracked    total rows in `tokens`
//   - tailLastBlock    highest block our tail worker has scanned
//   - newIn24h         categories first seen in the last 24h
//   - totalTvlSats     sum of Cauldron TVL across all listed categories
//   - listedCount      distinct categories with any venue presence
//
// If any single query fails we log + fall back to a sensible default so the
// layout never 500s over a stats hiccup.

import { query } from '$lib/server/db';
import { NOT_MODERATED_CLAUSE } from '$lib/moderation';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => {
	// Every tokens-reading query excludes moderation-hidden categories via
	// NOT_MODERATED_CLAUSE ($lib/moderation) — single source of truth so
	// schema evolution is one-line governance. The `sync_state` query is
	// untouched (no tokens join).
	const [tokensTrackedRes, syncRes, newIn24hRes, totalTvlRes, listedRes] =
		await Promise.allSettled([
			query<{ total: string }>(
				`SELECT COUNT(*)::bigint AS total
				   FROM tokens t
				  WHERE ${NOT_MODERATED_CLAUSE}`
			),
			query<{ tail_last_block: number | null }>(
				`SELECT tail_last_block FROM sync_state WHERE id = 1`
			),
			query<{ total: string }>(
				// genesis_time is the chain block's timestamp — "when the token was
				// minted." first_seen_at is the row's write time in *our* DB, which
				// for a fresh backfill lumps everything into the last N hours and
				// produces the wrong answer.
				`SELECT COUNT(*)::bigint AS total
				   FROM tokens t
				  WHERE t.genesis_time > now() - INTERVAL '24 hours'
				    AND ${NOT_MODERATED_CLAUSE}`
			),
			query<{ total: string | null }>(
				// Sum of Cauldron TVL across all listed + non-moderated
				// categories. `SUM(bigint)` in Postgres is already NUMERIC
				// (not bigint) — no silent wrap on overflow. Text-cast at
				// the boundary so node-pg doesn't coerce to Number before
				// we parse it on the client side.
				`SELECT COALESCE(SUM(vl.tvl_satoshis), 0)::text AS total
				   FROM token_venue_listings vl
				   JOIN tokens t ON t.category = vl.category
				  WHERE vl.venue = 'cauldron'
				    AND vl.tvl_satoshis IS NOT NULL
				    AND ${NOT_MODERATED_CLAUSE}`
			),
			query<{ total: string }>(
				// Distinct categories with any venue presence — Cauldron OR Fex
				// (AMM) OR an open Tapswap offer (P2P). UNION dedupes.
				// Must stay in lockstep with the directory's `?listed=1`
				// filter in src/routes/+page.server.ts: the MetricsBar pill's
				// number is read against the same universe the filter
				// reveals when the user clicks through.
				`SELECT COUNT(*)::bigint AS total FROM (
				    SELECT t.category
				      FROM tokens t
				      JOIN token_venue_listings vl
				        ON vl.category = t.category AND vl.venue = 'cauldron'
				     WHERE vl.price_sats IS NOT NULL
				       AND ${NOT_MODERATED_CLAUSE}
				    UNION
				    SELECT t.category
				      FROM tokens t
				      JOIN token_venue_listings vl
				        ON vl.category = t.category AND vl.venue = 'fex'
				     WHERE vl.price_sats IS NOT NULL
				       AND ${NOT_MODERATED_CLAUSE}
				    UNION
				    SELECT t.category
				      FROM tokens t
				      JOIN tapswap_offers o
				        ON o.has_category = t.category
				     WHERE o.status = 'open'
				       AND ${NOT_MODERATED_CLAUSE}
				 ) x`
			)
		]);

	const pickCount = (r: PromiseSettledResult<{ rows: { total: string }[] }>): number =>
		r.status === 'fulfilled' ? Number(r.value.rows[0]?.total ?? 0) : 0;

	const tokensTracked = pickCount(tokensTrackedRes);
	const newIn24h = pickCount(newIn24hRes);
	const listedCount = pickCount(listedRes);
	const totalTvlSats =
		totalTvlRes.status === 'fulfilled'
			? Number(totalTvlRes.value.rows[0]?.total ?? 0) || 0
			: 0;
	const tailLastBlock =
		syncRes.status === 'fulfilled' ? (syncRes.value.rows[0]?.tail_last_block ?? null) : null;

	for (const r of [tokensTrackedRes, syncRes, newIn24hRes, totalTvlRes, listedRes]) {
		if (r.status === 'rejected') console.error('[+layout.server] metric query failed:', r.reason);
	}

	return { tokensTracked, tailLastBlock, newIn24h, totalTvlSats, listedCount };
};
