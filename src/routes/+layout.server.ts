// Global server load: fetch a handful of high-level counters so MetricsBar
// renders a full picture on first paint (SSR), without any client round-trip.
//
// Values issued in parallel:
//   - tokensTracked    total rows in `tokens`
//   - tailLastBlock    highest block our tail worker has scanned
//   - newIn24h         categories first seen in the last 24h
//   - totalTvlSats     ecosystem-wide BCH-side reserve, summed across all
//                      pools on Cauldron + Fex. Cauldron portion is the
//                      cached canonical aggregate from `cauldron_global_stats`
//                      (matches /stats's Cauldron card; populated every 30
//                      min by sync-cauldron-stats). Fex portion is summed
//                      from token_venue_listings.pools_total_tvl_sats with
//                      a fallback to the canonical-pool tvl_satoshis for
//                      rows the worker hasn't refreshed yet.
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
	const [tokensTrackedRes, syncRes, newIn24hRes, cauldronTvlRes, fexTvlRes, listedRes] =
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
				// Cauldron portion of ecosystem TVL, sourced from the
				// `cauldron_global_stats` singleton populated every 30 min
				// by sync-cauldron-stats from indexer.cauldron.quest's
				// `/cauldron/valuelocked` (global, all-pools). This is the
				// same number the /stats page's "Cauldron AMM" card shows;
				// using it here means the headline pill matches /stats
				// exactly. Single-side by design (BCH reserve only, not
				// the doubled both-sides industry convention).
				`SELECT tvl_sats::text AS total FROM cauldron_global_stats WHERE id = 1`
			),
			query<{ total: string | null }>(
				// Fex portion of ecosystem TVL, summed from our own scanner.
				// Prefer `pools_total_tvl_sats` (sum across every Fex pool
				// the scantxoutset enumerated for this category); fall back
				// to `tvl_satoshis` (canonical-pool only) for rows the
				// worker hasn't refreshed since the per-pool columns were
				// added. The fallback is cosmetic — once sync-fex.timer
				// fires once after deploy every row carries the new column.
				//
				// Moderation filter applied via NOT_MODERATED_CLAUSE so a
				// hidden category's pool TVL doesn't leak into the
				// headline. Tapswap is excluded ecosystem-wide (P2P
				// intent, not pooled liquidity).
				`SELECT COALESCE(SUM(COALESCE(vl.pools_total_tvl_sats, vl.tvl_satoshis)), 0)::text AS total
				   FROM token_venue_listings vl
				   JOIN tokens t ON t.category = vl.category
				  WHERE vl.venue = 'fex'
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

	// Two TVL queries fan in here. Either failing soft-falls to 0 for
	// that side; both failing yields a 0 total which the UI already
	// handles by rendering "—" until the BCH price fetch lands.
	const cauldronTvlSats =
		cauldronTvlRes.status === 'fulfilled'
			? Number(cauldronTvlRes.value.rows[0]?.total ?? 0) || 0
			: 0;
	const fexTvlSats =
		fexTvlRes.status === 'fulfilled'
			? Number(fexTvlRes.value.rows[0]?.total ?? 0) || 0
			: 0;
	const totalTvlSats = cauldronTvlSats + fexTvlSats;

	const tailLastBlock =
		syncRes.status === 'fulfilled' ? (syncRes.value.rows[0]?.tail_last_block ?? null) : null;

	for (const r of [tokensTrackedRes, syncRes, newIn24hRes, cauldronTvlRes, fexTvlRes, listedRes]) {
		if (r.status === 'rejected') console.error('[+layout.server] metric query failed:', r.reason);
	}

	return { tokensTracked, tailLastBlock, newIn24h, totalTvlSats, listedCount };
};
