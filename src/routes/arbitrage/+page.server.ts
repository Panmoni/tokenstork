// /arbitrage — directory of cross-venue spreads for tokens listed on
// multiple AMMs. Day-one scope: Cauldron × Fex. Both venues store
// `price_sats` in `token_venue_listings` with the same convention
// (sats per smallest token unit), so the per-unit comparison is
// apples-to-apples without any unit gymnastics.
//
// Tapswap is deliberately excluded from v1: its per-unit ask price is
// derived (`want_sats / has_amount` for FT listings; NFT listings need
// commitment-aware logic), and we'd need a MIN aggregation across open
// offers. Worth a follow-up — flagged in the page copy.
//
// Fees baked into the "net after fees" column:
// - Cauldron: 0.3% pool spread (their published rate).
// - Fex: 0.6% per swap (0.2% LP / 0.2% project / 0.2% protocol per the
//   whitepaper).
// - Mining-fee buffer: ignored — sub-1% on any trade size that justifies
//   moving funds across venues.
// - Slippage: NOT modelled. The headline spread is an upper bound; large
//   trades against thin pools eat into it. The page copy says so.

import { query, hexFromBytes } from '$lib/server/db';
import { NOT_MODERATED_CLAUSE } from '$lib/moderation';
import type { PageServerLoad } from './$types';

interface DbRow {
	category: Buffer;
	name: string | null;
	symbol: string | null;
	decimals: number | null;
	icon_uri: string | null;
	cauldron_price_sats: number;
	cauldron_tvl_satoshis: string | null;
	fex_price_sats: number;
	fex_tvl_satoshis: string | null;
}

export interface ArbitrageRow {
	id: string;
	name: string | null;
	symbol: string | null;
	decimals: number;
	icon: string | null;
	cauldronPriceUSD: number;
	cauldronTvlUSD: number;
	fexPriceUSD: number;
	fexTvlUSD: number;
	rawSpreadPct: number; // (max - min) / min × 100, always positive
	netSpreadPct: number; // rawSpreadPct - cauldronFee - fexFee, can be negative
	cheaperVenue: 'cauldron' | 'fex';
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

// Total round-trip taker fees: Cauldron 0.3% + Fex 0.6% = 0.9%. A spread
// below this floor isn't profitable even ignoring slippage and tx-mining
// cost. Used for the netSpreadPct column AND the default `min=` filter.
const ROUND_TRIP_FEE_PCT = 0.9;

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

	const dataRes = await query<DbRow>(
		`SELECT t.category,
		        m.name,
		        m.symbol,
		        m.decimals,
		        m.icon_uri,
		        vc.price_sats           AS cauldron_price_sats,
		        vc.tvl_satoshis::text   AS cauldron_tvl_satoshis,
		        vf.price_sats           AS fex_price_sats,
		        vf.tvl_satoshis::text   AS fex_tvl_satoshis
		   FROM tokens t
		   JOIN token_venue_listings vc
		     ON vc.category = t.category AND vc.venue = 'cauldron' AND vc.price_sats IS NOT NULL
		   JOIN token_venue_listings vf
		     ON vf.category = t.category AND vf.venue = 'fex' AND vf.price_sats IS NOT NULL
		   LEFT JOIN token_metadata m ON m.category = t.category
		  WHERE ${NOT_MODERATED_CLAUSE}`
	);

	const allRows: ArbitrageRow[] = dataRes.rows.map((row) => {
		const decimals = row.decimals ?? 0;
		const cauldronPriceUSD = bchPriceUSD > 0
			? (row.cauldron_price_sats * Math.pow(10, decimals) / 1e8) * bchPriceUSD
			: 0;
		const fexPriceUSD = bchPriceUSD > 0
			? (row.fex_price_sats * Math.pow(10, decimals) / 1e8) * bchPriceUSD
			: 0;

		const cauldronTvlUSD = row.cauldron_tvl_satoshis && bchPriceUSD > 0
			? (Number(row.cauldron_tvl_satoshis) / 1e8) * bchPriceUSD * 2
			: 0;
		const fexTvlUSD = row.fex_tvl_satoshis && bchPriceUSD > 0
			? (Number(row.fex_tvl_satoshis) / 1e8) * bchPriceUSD * 2
			: 0;

		// Spread on raw sats — independent of bchPriceUSD, so a 0 BCH
		// price (API outage) doesn't blank out the table. The USD
		// columns will still show 0 in that case but the spread % stays
		// honest.
		const cs = row.cauldron_price_sats;
		const fs = row.fex_price_sats;
		const minPx = Math.min(cs, fs);
		const rawSpreadPct = minPx > 0 ? ((Math.max(cs, fs) - minPx) / minPx) * 100 : 0;
		const netSpreadPct = rawSpreadPct - ROUND_TRIP_FEE_PCT;
		const cheaperVenue: 'cauldron' | 'fex' = cs <= fs ? 'cauldron' : 'fex';

		return {
			id: hexFromBytes(row.category)!,
			name: row.name,
			symbol: row.symbol,
			decimals,
			icon: row.icon_uri,
			cauldronPriceUSD,
			cauldronTvlUSD,
			fexPriceUSD,
			fexTvlUSD,
			rawSpreadPct,
			netSpreadPct,
			cheaperVenue
		};
	});

	const filtered = allRows
		.filter((r) => r.rawSpreadPct >= minSpreadPct)
		.sort((a, b) => b.rawSpreadPct - a.rawSpreadPct);

	return {
		rows: filtered,
		totalRows: allRows.length,
		minSpreadPct,
		showAll,
		feeFloorPct: ROUND_TRIP_FEE_PCT,
		bchPriceUSD
	};
};
