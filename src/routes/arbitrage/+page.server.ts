// /arbitrage — directory of cross-venue spreads for tokens listed on
// multiple venues. Three venues now: Cauldron AMM, Fex AMM, Tapswap P2P.
//
// All three use the same per-unit price unit (sats per smallest token
// unit) so cross-venue comparison is apples-to-apples without unit
// gymnastics:
//   - Cauldron / Fex: stored directly in `token_venue_listings.price_sats`.
//   - Tapswap: derived per row as `want_sats / has_amount` for FT-only
//     listings (has_commitment IS NULL); we MIN-aggregate across the
//     open offers per category to surface the lowest available ask.
//
// Day-1 scope is FT-only on the Tapswap side. NFT listings (where
// has_commitment IS NOT NULL) carry different price semantics — each NFT
// is unique by commitment, and "lowest ask" doesn't aggregate cleanly
// across them. Tracked as a follow-up.
//
// Per-row dynamic fee model — fees depend on which venues you'd actually
// be using:
//   Buy leg (taker fees from the perspective of arbing):
//     Cauldron 0.3% / Fex 0.6% / Tapswap 0% (the 3% Tapswap fee is paid
//     by the maker out of want_sats, not the taker).
//   Sell leg:
//     Cauldron 0.3% / Fex 0.6% / Tapswap 3% (creating a listing on
//     Tapswap pays the platform fee on takeoff).
// Net spread per row = raw spread − (buy_leg_fee + sell_leg_fee), where
// buy_leg = cheapest venue and sell_leg = most-expensive venue.
//
// Slippage NOT modelled. Mining fees ignored (sub-1% on any meaningful
// trade). The page copy says so.

import { query, hexFromBytes } from '$lib/server/db';
import { NOT_MODERATED_CLAUSE } from '$lib/moderation';
import type { PageServerLoad } from './$types';

interface DbRow {
	category: Buffer;
	name: string | null;
	symbol: string | null;
	decimals: number | null;
	icon_uri: string | null;
	cauldron_price_sats: number | null;
	cauldron_tvl_satoshis: string | null;
	fex_price_sats: number | null;
	fex_tvl_satoshis: string | null;
	tapswap_min_ask_sats: number | null;
	tapswap_ft_count: string | null;
}

export type VenueId = 'cauldron' | 'fex' | 'tapswap';

export interface ArbitrageRow {
	id: string;
	name: string | null;
	symbol: string | null;
	decimals: number;
	icon: string | null;

	// Per-venue USD prices. 0 means "not on this venue this run". Use
	// the *Present flags below to disambiguate "not listed" from
	// "listed at $0", though in practice $0 doesn't happen because
	// our worker rejects zero-price rows at ingest.
	cauldronPriceUSD: number;
	fexPriceUSD: number;
	tapswapPriceUSD: number;
	cauldronPresent: boolean;
	fexPresent: boolean;
	tapswapPresent: boolean;

	// Per-AMM TVL (USD, doubled-sides convention applied at this layer).
	// Tapswap doesn't have a TVL concept — instead we surface the count
	// of open FT listings as a "depth" proxy.
	cauldronTvlUSD: number;
	fexTvlUSD: number;
	tapswapFtListingCount: number;

	// Arb math.
	rawSpreadPct: number;       // (max - min) / min × 100, always positive
	netSpreadPct: number;       // raw - (buyFee + sellFee); can be negative
	totalFeePct: number;        // buyFee + sellFee for this row's specific venues
	cheapestVenue: VenueId;     // buy here
	mostExpensiveVenue: VenueId; // sell here
}

async function fetchBchPrice(fetch: typeof globalThis.fetch): Promise<number> {
	try {
		const res = await fetch('/api/bchPrice', { signal: AbortSignal.timeout(4000) });
		const data = await res.json();
		return typeof data?.USD === 'number' ? data.USD : 0;
	} catch {
		return 0;
	}
}

// Per-venue taker fees (% spread cost on a single leg). See header
// comment for rationale on the asymmetric Tapswap entries.
const BUY_FEE_PCT: Record<VenueId, number> = {
	cauldron: 0.3,
	fex: 0.6,
	tapswap: 0
};
const SELL_FEE_PCT: Record<VenueId, number> = {
	cauldron: 0.3,
	fex: 0.6,
	tapswap: 3
};

// Minimum possible round-trip fee floor — best-case scenario where
// you're buying on Tapswap (0%) and selling on Cauldron (0.3%). Used as
// a default filter floor below; only spreads above this can ever clear
// fees on at least one venue pair.
const MIN_FEE_FLOOR_PCT =
	Math.min(BUY_FEE_PCT.cauldron, BUY_FEE_PCT.fex, BUY_FEE_PCT.tapswap) +
	Math.min(SELL_FEE_PCT.cauldron, SELL_FEE_PCT.fex, SELL_FEE_PCT.tapswap);

export const load: PageServerLoad = async ({ url, fetch }) => {
	// `?min=N` filters to spreads ≥ N% raw. Default 1% — below that is
	// rounding noise on cheap pools. `?showAll=1` is shorthand for
	// `?min=0`. Explicit `?min=` always wins over `showAll`; we then
	// derive a single canonical `showAll` from the resulting floor so
	// the UI's view-toggle pill highlights one button at a time even
	// when both URL params are present.
	const showAllParam = url.searchParams.get('showAll') === '1';
	const minParam = Number(url.searchParams.get('min'));
	const minSpreadPct = Number.isFinite(minParam) && minParam >= 0
		? minParam
		: showAllParam
			? 0
			: 1;
	const showAll = minSpreadPct === 0;

	const bchPriceUSD = await fetchBchPrice(fetch);

	// Single SQL with a CTE for Tapswap's per-category lowest-ask. Inner
	// LEFT JOINs on the AMM venues + the Tapswap aggregate; HAVING
	// equivalent at the WHERE level requires ≥ 2 of the 3 venues to
	// have data, otherwise there's no spread to compute.
	//
	// Tapswap min-ask is computed as MIN(want_sats / has_amount) across
	// open FT-only listings (has_commitment IS NULL filters out NFTs,
	// whose price semantics differ). NUMERIC division preserves
	// precision; ::double precision cast at the column boundary gives us
	// a JS-friendly number on the wire.
	//
	// want_category IS NULL is load-bearing here: the protocol allows
	// token-for-token listings, where want_sats is whatever extra BCH the
	// maker tacked on (often 0 or dust) and the *real* price is denominated
	// in want_amount of want_category. Including those rows would let one
	// zero-want_sats listing dominate the MIN() and produce a fake near-zero
	// ask, ranking the row at the top of the arbitrage table for the wrong
	// reason. Restricting to wanting-only-BCH-with-a-positive-amount keeps
	// the aggregate honest. has_amount > 0 already implies NOT NULL.
	const dataRes = await query<DbRow>(
		`WITH tapswap_min AS (
		  SELECT o.has_category AS category,
		         MIN(o.want_sats::numeric / o.has_amount)::double precision AS min_ask_sats,
		         COUNT(*) AS ft_listing_count
		    FROM tapswap_offers o
		   WHERE o.status = 'open'
		     AND o.has_category IS NOT NULL
		     AND o.has_amount > 0
		     AND o.has_commitment IS NULL
		     AND o.want_category IS NULL
		     AND o.want_sats > 0
		   GROUP BY o.has_category
		)
		SELECT t.category,
		       m.name,
		       m.symbol,
		       m.decimals,
		       m.icon_uri,
		       vc.price_sats           AS cauldron_price_sats,
		       vc.tvl_satoshis::text   AS cauldron_tvl_satoshis,
		       vf.price_sats           AS fex_price_sats,
		       vf.tvl_satoshis::text   AS fex_tvl_satoshis,
		       tm.min_ask_sats         AS tapswap_min_ask_sats,
		       tm.ft_listing_count::text AS tapswap_ft_count
		  FROM tokens t
		  LEFT JOIN token_venue_listings vc
		    ON vc.category = t.category AND vc.venue = 'cauldron' AND vc.price_sats IS NOT NULL
		  LEFT JOIN token_venue_listings vf
		    ON vf.category = t.category AND vf.venue = 'fex' AND vf.price_sats IS NOT NULL
		  LEFT JOIN tapswap_min tm ON tm.category = t.category
		  LEFT JOIN token_metadata m ON m.category = t.category
		 WHERE ${NOT_MODERATED_CLAUSE}
		   AND (
		     (vc.price_sats IS NOT NULL)::int
		     + (vf.price_sats IS NOT NULL)::int
		     + (tm.min_ask_sats IS NOT NULL)::int
		   ) >= 2`
	);

	const allRows: ArbitrageRow[] = dataRes.rows
		.map((row): ArbitrageRow | null => {
			const decimals = row.decimals ?? 0;
			const cs = row.cauldron_price_sats;
			const fs = row.fex_price_sats;
			const ts = row.tapswap_min_ask_sats;

			// Build the present-venues set for spread math. We're computing
			// spread on raw sats (BCH-price-independent) so a 0 BCH price
			// outage doesn't blank out the table.
			const venues: Array<{ venue: VenueId; priceSats: number }> = [];
			if (cs != null && cs > 0) venues.push({ venue: 'cauldron', priceSats: cs });
			if (fs != null && fs > 0) venues.push({ venue: 'fex', priceSats: fs });
			if (ts != null && ts > 0) venues.push({ venue: 'tapswap', priceSats: ts });

			// SQL guarantees ≥ 2 venues, but defensively re-check.
			if (venues.length < 2) return null;

			venues.sort((a, b) => a.priceSats - b.priceSats);
			const cheapest = venues[0];
			const mostExpensive = venues[venues.length - 1];

			const rawSpreadPct =
				cheapest.priceSats > 0
					? ((mostExpensive.priceSats - cheapest.priceSats) / cheapest.priceSats) * 100
					: 0;
			const totalFeePct =
				BUY_FEE_PCT[cheapest.venue] + SELL_FEE_PCT[mostExpensive.venue];
			const netSpreadPct = rawSpreadPct - totalFeePct;

			// USD math. AMM TVL is doubled at the render layer per the
			// project's single-side-stored / doubled-on-display convention.
			const usdFromPriceSats = (px: number | null): number =>
				px != null && px > 0 && bchPriceUSD > 0
					? (px * Math.pow(10, decimals) / 1e8) * bchPriceUSD
					: 0;
			const usdFromTvlSats = (tvl: string | null): number =>
				tvl && bchPriceUSD > 0 ? (Number(tvl) / 1e8) * bchPriceUSD * 2 : 0;

			return {
				id: hexFromBytes(row.category)!,
				name: row.name,
				symbol: row.symbol,
				decimals,
				icon: row.icon_uri,
				cauldronPriceUSD: usdFromPriceSats(cs),
				fexPriceUSD: usdFromPriceSats(fs),
				tapswapPriceUSD: usdFromPriceSats(ts),
				cauldronPresent: cs != null && cs > 0,
				fexPresent: fs != null && fs > 0,
				tapswapPresent: ts != null && ts > 0,
				cauldronTvlUSD: usdFromTvlSats(row.cauldron_tvl_satoshis),
				fexTvlUSD: usdFromTvlSats(row.fex_tvl_satoshis),
				tapswapFtListingCount: row.tapswap_ft_count ? Number(row.tapswap_ft_count) : 0,
				rawSpreadPct,
				netSpreadPct,
				totalFeePct,
				cheapestVenue: cheapest.venue,
				mostExpensiveVenue: mostExpensive.venue
			};
		})
		.filter((r): r is ArbitrageRow => r !== null);

	const filtered = allRows
		.filter((r) => r.rawSpreadPct >= minSpreadPct)
		.sort((a, b) => b.rawSpreadPct - a.rawSpreadPct);

	return {
		rows: filtered,
		totalRows: allRows.length,
		minSpreadPct,
		showAll,
		minFeeFloorPct: MIN_FEE_FLOOR_PCT,
		bchPriceUSD,
		// Surface fee constants so the UI can render a per-venue legend
		// without duplicating numbers across files.
		buyFeePct: BUY_FEE_PCT,
		sellFeePct: SELL_FEE_PCT
	};
};
