// 24h movers — top gainers, top losers, biggest TVL movers — derived
// from `token_price_history`. Cauldron only (Fex has too few categories
// for a useful ranking; Tapswap doesn't store TVL via price_history).
//
// Shared between /stats and the homepage so both pages render identical
// numbers from a single SQL query + identical sort/slice/sign-filter
// logic. Keep the rule changes here, in one place.

import { query } from './db';
import { NOT_MODERATED_CLAUSE } from '../moderation';

export interface MoverDisplay {
	categoryHex: string;
	symbol: string;
	name: string;
	priceOld: number;
	priceNew: number;
	pricePct: number;
	tvlOld: number | null;
	tvlNew: number | null;
	tvlPct: number | null;
}

export interface MoversResult {
	topGainers24h: MoverDisplay[];
	topLosers24h: MoverDisplay[];
	/// Filtered to entries that actually have a tvlPct value, then sorted by
	/// abs(tvlPct) DESC so the biggest swing — up or down — leads.
	topTvlMovers24h: Array<MoverDisplay & { tvlPct: number }>;
	/// True iff at least one Cauldron-listed category has BOTH a price
	/// point ≥23h ago and a fresh point within the last 23h. Used by the
	/// UI to distinguish "no points yet" (sync gap, fresh deploy) from
	/// "no movement in this direction" (the sign filter produced an empty
	/// list because every move was the other way).
	has24hHistory: boolean;
}

interface DbRow {
	category_hex: string;
	symbol: string;
	name: string;
	price_old: number;
	price_new: number;
	tvl_old: string | null;
	tvl_new: string | null;
}

const EMPTY: MoversResult = {
	topGainers24h: [],
	topLosers24h: [],
	topTvlMovers24h: [],
	has24hHistory: false
};

export async function getMovers24h(): Promise<MoversResult> {
	try {
		// 24h movers — for every Cauldron-listed category that has BOTH a
		// price point ≥ 23h ago AND a price point within the last 23h, emit
		// the oldest-eligible-old + newest pair so we can compute % deltas.
		// The 23h floor is a small safety margin around the 4h sync cadence
		// so we don't lose tokens whose latest pre-24h sample landed at,
		// e.g., 23h 58m ago. The 7d ceiling on the "old" side caps how far
		// back we'd reach if a category went silent for a stretch — we
		// won't compare a 5-day-old price to today's and call it a "24h
		// move."
		const res = await query<DbRow>(
			`WITH oldest AS (
                SELECT DISTINCT ON (h.category)
                       h.category,
                       h.price_sats AS price_old,
                       h.tvl_satoshis AS tvl_old
                  FROM token_price_history h
                 WHERE h.venue = 'cauldron'
                   AND h.ts <= now() - INTERVAL '23 hours'
                   AND h.ts >= now() - INTERVAL '7 days'
                 ORDER BY h.category, h.ts DESC
            ),
            newest AS (
                SELECT DISTINCT ON (h.category)
                       h.category,
                       h.price_sats AS price_new,
                       h.tvl_satoshis AS tvl_new
                  FROM token_price_history h
                 WHERE h.venue = 'cauldron'
                   AND h.ts >= now() - INTERVAL '23 hours'
                 ORDER BY h.category, h.ts DESC
            )
            SELECT encode(t.category, 'hex') AS category_hex,
                   COALESCE(NULLIF(BTRIM(m.symbol), ''), '') AS symbol,
                   COALESCE(NULLIF(BTRIM(m.name),   ''), '') AS name,
                   o.price_old,
                   n.price_new,
                   o.tvl_old::text AS tvl_old,
                   n.tvl_new::text AS tvl_new
              FROM tokens t
              JOIN oldest o ON o.category = t.category
              JOIN newest n ON n.category = t.category
              LEFT JOIN token_metadata m ON m.category = t.category
             WHERE ${NOT_MODERATED_CLAUSE}
               AND o.price_old > 0
               AND n.price_new > 0`
		);

		const computed: MoverDisplay[] = res.rows.map((r) => {
			const priceOld = Number(r.price_old);
			const priceNew = Number(r.price_new);
			const tvlOld = r.tvl_old ? Number(r.tvl_old) : null;
			const tvlNew = r.tvl_new ? Number(r.tvl_new) : null;
			const tvlPct =
				tvlOld !== null && tvlOld > 0 && tvlNew !== null
					? ((tvlNew - tvlOld) / tvlOld) * 100
					: null;
			return {
				categoryHex: r.category_hex,
				symbol: r.symbol,
				name: r.name,
				priceOld,
				priceNew,
				pricePct: ((priceNew - priceOld) / priceOld) * 100,
				tvlOld,
				tvlNew,
				tvlPct
			};
		});

		// Sign filter on gainers / losers is load-bearing: without it, an
		// all-down day puts negative-pct rows in the "Top gainers" emerald
		// card (and an all-up day mirrors), and on small datasets gainers
		// and losers fully overlap. Filter before slice so each card is
		// faithful to its label.
		const topGainers24h = computed
			.filter((m) => m.pricePct > 0)
			.sort((a, b) => b.pricePct - a.pricePct)
			.slice(0, 5);
		const topLosers24h = computed
			.filter((m) => m.pricePct < 0)
			.sort((a, b) => a.pricePct - b.pricePct)
			.slice(0, 5);
		const topTvlMovers24h = computed
			.filter((m): m is typeof m & { tvlPct: number } => m.tvlPct !== null)
			.sort((a, b) => Math.abs(b.tvlPct) - Math.abs(a.tvlPct))
			.slice(0, 5);

		return {
			topGainers24h,
			topLosers24h,
			topTvlMovers24h,
			has24hHistory: computed.length > 0
		};
	} catch (err) {
		console.error('[movers] load failed:', err);
		return EMPTY;
	}
}
