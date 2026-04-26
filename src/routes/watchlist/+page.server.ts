// /watchlist — purpose-built bookmarks page for the wallet-tied watchlist.
//
// Distinct UX from the directory: this is a curated set the user picked
// themselves, not a filtered slice of the universe. Smaller surface
// (just the columns that matter for "tokens I'm watching"), no pagination
// at this scale (typical watchlist <100 entries), order by added-at desc.
//
// Auth-gated at the data level: unauthenticated visitors get an empty
// rows array + an `unauthenticated: true` flag the UI uses to render the
// sign-in prompt. We don't redirect because /watchlist is a meaningful
// destination URL that should explain itself.

import { query, hexFromBytes } from '$lib/server/db';
import { NOT_MODERATED_CLAUSE } from '$lib/moderation';
import type { PageServerLoad } from './$types';

interface DbRow {
	category: Buffer;
	added_at: Date;
	name: string | null;
	symbol: string | null;
	decimals: number | null;
	icon_uri: string | null;
	token_type: 'FT' | 'NFT' | 'FT+NFT';
	cauldron_price_sats: number | null;
	cauldron_tvl_satoshis: string | null;
	tapswap_listing_count: string | null;
	fex_price_sats: number | null;
	fex_tvl_satoshis: string | null;
}

export interface WatchlistRow {
	id: string;
	addedAt: number; // unix seconds
	name: string | null;
	symbol: string | null;
	decimals: number;
	icon: string | null;
	tokenType: 'FT' | 'NFT' | 'FT+NFT';
	cauldronPriceSats: number | null;
	cauldronTvlSatoshis: number | null;
	tapswapListingCount: number;
	fexPriceSats: number | null;
	fexTvlSatoshis: number | null;
}

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		return { rows: [], unauthenticated: true };
	}

	// Pull the user's watchlist + each row's directory-relevant data in
	// one query. Same join structure as the directory but narrowed —
	// no price-change windows, no sparkline, no holder counts. The
	// detail page is one click away for richer info.
	//
	// `NOT_MODERATED_CLAUSE` filters out hidden categories so a
	// moderation-driven hide doesn't leak through someone else's
	// watchlist. (Cascading delete on `tokens` would clear the row, but
	// moderation is "hide, not delete" — defense in depth.)
	const dataRes = await query<DbRow>(
		`SELECT
			t.category,
			w.added_at,
			m.name,
			m.symbol,
			m.decimals,
			m.icon_uri,
			t.token_type,
			vc.price_sats          AS cauldron_price_sats,
			vc.tvl_satoshis::text  AS cauldron_tvl_satoshis,
			(SELECT COUNT(*)::text FROM tapswap_offers o
			   WHERE o.has_category = t.category AND o.status = 'open')
			                       AS tapswap_listing_count,
			vf.price_sats          AS fex_price_sats,
			vf.tvl_satoshis::text  AS fex_tvl_satoshis
		   FROM user_watchlist w
		   JOIN tokens t            ON t.category = w.category
		   LEFT JOIN token_metadata m ON m.category = t.category
		   LEFT JOIN token_venue_listings vc
		     ON vc.category = t.category AND vc.venue = 'cauldron'
		   LEFT JOIN token_venue_listings vf
		     ON vf.category = t.category AND vf.venue = 'fex'
		  WHERE w.cashaddr = $1
		    AND ${NOT_MODERATED_CLAUSE}
		  ORDER BY w.added_at DESC`,
		[locals.user.cashaddr]
	);

	const rows: WatchlistRow[] = dataRes.rows.map((r) => ({
		id: hexFromBytes(r.category)!,
		addedAt: Math.floor(r.added_at.getTime() / 1000),
		name: r.name,
		symbol: r.symbol,
		decimals: r.decimals ?? 0,
		icon: r.icon_uri,
		tokenType: r.token_type,
		cauldronPriceSats: r.cauldron_price_sats,
		cauldronTvlSatoshis: r.cauldron_tvl_satoshis ? Number(r.cauldron_tvl_satoshis) : null,
		tapswapListingCount: r.tapswap_listing_count ? Number(r.tapswap_listing_count) : 0,
		fexPriceSats: r.fex_price_sats,
		fexTvlSatoshis: r.fex_tvl_satoshis ? Number(r.fex_tvl_satoshis) : null
	}));

	return { rows, unauthenticated: false };
};
