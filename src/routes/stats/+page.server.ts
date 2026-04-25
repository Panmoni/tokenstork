// /stats — ecosystem-level metrics for the BCH CashTokens directory.
// Most counters are derived from the tables the directory already
// renders from. The Cauldron AMM section is the one external block —
// it pulls live aggregates from indexer.cauldron.quest, gated behind
// allSettled so an upstream stall never blocks the page.
//
// `newIn24h` is sourced from the parent layout load so /stats doesn't
// re-run the same 24h count twice in one pageview.

import { query } from '$lib/server/db';
import { NOT_MODERATED_CLAUSE } from '$lib/moderation';
import { fetchCauldronGlobalStats, type CauldronGlobalStats } from '$lib/server/external';
import type { PageServerLoad } from './$types';

interface TypeCount {
	token_type: 'FT' | 'NFT' | 'FT+NFT';
	total: string;
}

interface WindowCount {
	total: string;
}

interface GenesisMonth {
	month: string; // ISO date string (first-of-month)
	count: string;
}

interface DecimalsBucket {
	decimals: number;
	count: string;
}

interface VenueOverlap {
	cauldron_only: string;
	tapswap_only: string;
	fex_only: string;
	cauldron_and_tapswap: string;
	cauldron_and_fex: string;
	tapswap_and_fex: string;
	all_three: string;
}

interface MetadataCompleteness {
	has_name: string;
	has_symbol: string;
	has_icon: string;
	has_description: string;
	total: string;
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

const EMPTY_CAULDRON_STATS: CauldronGlobalStats = {
	tvlSats: 0,
	tvlUSD: 0,
	volume24hSats: 0,
	volume24hUSD: 0,
	volume7dSats: 0,
	volume7dUSD: 0,
	volume30dSats: 0,
	volume30dUSD: 0,
	pools: { active: 0, ended: 0, interactions: 0 },
	uniqueAddressesByMonth: []
};

export const load: PageServerLoad = async ({ parent, fetch }) => {
	const bchPriceP = fetchBchPrice(fetch);
	const cauldronStatsP = bchPriceP.then((p) => fetchCauldronGlobalStats(p));
	const [parentData, pageResults, cauldronStatsResult] = await Promise.all([
		parent(),
		Promise.allSettled([
			query<TypeCount>(
				`SELECT t.token_type, COUNT(*)::bigint AS total
				   FROM tokens t
				  WHERE ${NOT_MODERATED_CLAUSE}
				  GROUP BY t.token_type`
			),
			query<WindowCount>(
				`SELECT COUNT(*)::bigint AS total
				   FROM tokens t
				  WHERE t.genesis_time > now() - INTERVAL '7 days'
				    AND ${NOT_MODERATED_CLAUSE}`
			),
			query<WindowCount>(
				`SELECT COUNT(*)::bigint AS total
				   FROM tokens t
				  WHERE t.genesis_time > now() - INTERVAL '30 days'
				    AND ${NOT_MODERATED_CLAUSE}`
			),
			query<WindowCount>(
				`SELECT COUNT(*)::bigint AS total
				   FROM tokens t
				   JOIN token_state s ON s.category = t.category
				  WHERE s.is_fully_burned = true
				    AND ${NOT_MODERATED_CLAUSE}`
			),
			query<WindowCount>(
				`SELECT COUNT(DISTINCT o.has_category)::bigint AS total
				   FROM tapswap_offers o
				   JOIN tokens t ON t.category = o.has_category
				  WHERE o.status = 'open'
				    AND o.has_category IS NOT NULL
				    AND ${NOT_MODERATED_CLAUSE}`
			),
			query<WindowCount>(
				`SELECT COUNT(*)::bigint AS total
				   FROM token_venue_listings vl
				   JOIN tokens t ON t.category = vl.category
				  WHERE vl.venue = 'cauldron'
				    AND vl.price_sats IS NOT NULL
				    AND ${NOT_MODERATED_CLAUSE}`
			),
			// Fex-listed categories — counts active Fex AMM pools populated
			// by `sync-fex`. Small today (~10) but part of the tradeable
			// triplet alongside Cauldron + Tapswap.
			query<WindowCount>(
				`SELECT COUNT(*)::bigint AS total
				   FROM token_venue_listings vl
				   JOIN tokens t ON t.category = vl.category
				  WHERE vl.venue = 'fex'
				    AND vl.price_sats IS NOT NULL
				    AND ${NOT_MODERATED_CLAUSE}`
			),

			// Genesis-by-month — monthly token-mint count since activation.
			// Bucketed by the on-chain block timestamp so a backfill doesn't
			// lump everything into "today." Returns one row per month with
			// at least one token. genesis_time is TIMESTAMPTZ (schema line
			// `genesis_time TIMESTAMPTZ NOT NULL`), so feed it directly
			// into date_trunc — NOT via to_timestamp, which expects a Unix
			// double and errors on a TIMESTAMPTZ arg.
			query<GenesisMonth>(
				`SELECT date_trunc('month', t.genesis_time)::date::text AS month,
				        COUNT(*)::bigint AS count
				   FROM tokens t
				  WHERE ${NOT_MODERATED_CLAUSE}
				  GROUP BY 1
				  ORDER BY 1 ASC`
			),

			// Decimals distribution across FT-holding categories. NFT-only
			// categories have no decimals concept so they're excluded; the
			// FT+NFT hybrids count.
			query<DecimalsBucket>(
				`SELECT COALESCE(m.decimals, 0) AS decimals,
				        COUNT(*)::bigint AS count
				   FROM tokens t
				   LEFT JOIN token_metadata m ON m.category = t.category
				  WHERE t.token_type IN ('FT', 'FT+NFT')
				    AND ${NOT_MODERATED_CLAUSE}
				  GROUP BY 1
				  ORDER BY 1 ASC`
			),

			// Venue overlap — three-venue Venn diagram. Counts how many
			// tokens are on each venue exclusively, on each pair only, or
			// on all three. The pair / triple intersections are the
			// natural universe for cross-venue arbitrage (priority #15 in
			// the plan).
			//
			// Implementation: build presence flags per category in a
			// single CTE, then bucket. EXCEPT/INTERSECT chains would be
			// uglier and harder to extend if we add a fourth venue.
			query<VenueOverlap>(
				`WITH presence AS (
				  SELECT t.category,
				         EXISTS (
				           SELECT 1 FROM token_venue_listings vl
				            WHERE vl.category = t.category
				              AND vl.venue = 'cauldron'
				              AND vl.price_sats IS NOT NULL
				         ) AS on_cauldron,
				         EXISTS (
				           SELECT 1 FROM token_venue_listings vl
				            WHERE vl.category = t.category
				              AND vl.venue = 'fex'
				              AND vl.price_sats IS NOT NULL
				         ) AS on_fex,
				         EXISTS (
				           SELECT 1 FROM tapswap_offers o
				            WHERE o.has_category = t.category
				              AND o.status = 'open'
				         ) AS on_tapswap
				    FROM tokens t
				   WHERE ${NOT_MODERATED_CLAUSE}
				)
				SELECT
				  COUNT(*) FILTER (WHERE  on_cauldron AND NOT on_tapswap AND NOT on_fex)::bigint::text AS cauldron_only,
				  COUNT(*) FILTER (WHERE  on_tapswap  AND NOT on_cauldron AND NOT on_fex)::bigint::text AS tapswap_only,
				  COUNT(*) FILTER (WHERE  on_fex      AND NOT on_cauldron AND NOT on_tapswap)::bigint::text AS fex_only,
				  COUNT(*) FILTER (WHERE  on_cauldron AND on_tapswap  AND NOT on_fex)::bigint::text     AS cauldron_and_tapswap,
				  COUNT(*) FILTER (WHERE  on_cauldron AND on_fex      AND NOT on_tapswap)::bigint::text AS cauldron_and_fex,
				  COUNT(*) FILTER (WHERE  on_tapswap  AND on_fex      AND NOT on_cauldron)::bigint::text AS tapswap_and_fex,
				  COUNT(*) FILTER (WHERE  on_cauldron AND on_tapswap  AND on_fex)::bigint::text         AS all_three
				  FROM presence`
			),

			// BCMR metadata completeness — what fraction of tokens have
			// each of name / symbol / icon / description populated.
			// Treats empty-string fields as missing so the numbers reflect
			// what's actually visible in the directory.
			query<MetadataCompleteness>(
				`SELECT
				  COUNT(*) FILTER (WHERE m.name        IS NOT NULL AND BTRIM(m.name)        <> '')::bigint::text AS has_name,
				  COUNT(*) FILTER (WHERE m.symbol      IS NOT NULL AND BTRIM(m.symbol)      <> '')::bigint::text AS has_symbol,
				  COUNT(*) FILTER (WHERE m.icon_uri    IS NOT NULL AND BTRIM(m.icon_uri)    <> '')::bigint::text AS has_icon,
				  COUNT(*) FILTER (WHERE m.description IS NOT NULL AND BTRIM(m.description) <> '')::bigint::text AS has_description,
				  COUNT(*)::bigint::text AS total
				  FROM tokens t
				  LEFT JOIN token_metadata m ON m.category = t.category
				 WHERE ${NOT_MODERATED_CLAUSE}`
			),

			// Moderated count — the only counter on this page that does NOT
			// apply NOT_MODERATED_CLAUSE; the whole point is to surface how
			// many categories we filter. Linked from the Moderation card to
			// /moderated for the per-token breakdown.
			query<WindowCount>(
				`SELECT COUNT(*)::bigint AS total FROM token_moderation`
			)
		]),
		cauldronStatsP.catch((err) => {
			console.error('[stats] cauldron global stats failed:', err);
			return EMPTY_CAULDRON_STATS;
		})
	]);

	const cauldronStats = cauldronStatsResult;

	const [
		typesRes,
		d7Res,
		d30Res,
		burnedRes,
		tapswapCatsRes,
		cauldronCatsRes,
		fexCatsRes,
		genesisMonthsRes,
		decimalsRes,
		venueOverlapRes,
		metadataRes,
		moderatedRes
	] = pageResults;

	const pickNumber = (r: PromiseSettledResult<{ rows: WindowCount[] }>): number =>
		r.status === 'fulfilled' ? Number(r.value.rows[0]?.total ?? 0) : 0;

	const byType: Record<'FT' | 'NFT' | 'FT+NFT', number> = { FT: 0, NFT: 0, 'FT+NFT': 0 };
	if (typesRes.status === 'fulfilled') {
		for (const row of typesRes.value.rows) byType[row.token_type] = Number(row.total);
	}

	const enrichmentReady = burnedRes.status === 'fulfilled';

	const genesisByMonth =
		genesisMonthsRes.status === 'fulfilled'
			? genesisMonthsRes.value.rows.map((r) => ({
					month: r.month,
					count: Number(r.count)
				}))
			: [];

	// Clamp decimals into a small set of buckets (0, 2, 4, 6, 8, other).
	// Cash tokens in the wild are almost always one of these; rolling
	// 1 / 3 / 5 / 7 into "other" keeps the histogram tidy without losing
	// signal.
	const rawDecimals =
		decimalsRes.status === 'fulfilled'
			? decimalsRes.value.rows.map((r) => ({ d: Number(r.decimals), c: Number(r.count) }))
			: [];
	const decimalsBuckets: Array<{ label: string; count: number }> = [
		{ label: '0', count: 0 },
		{ label: '2', count: 0 },
		{ label: '4', count: 0 },
		{ label: '6', count: 0 },
		{ label: '8', count: 0 },
		{ label: 'other', count: 0 }
	];
	for (const r of rawDecimals) {
		const label = [0, 2, 4, 6, 8].includes(r.d) ? String(r.d) : 'other';
		const bucket = decimalsBuckets.find((b) => b.label === label);
		if (bucket) bucket.count += r.c;
	}

	const venueOverlap =
		venueOverlapRes.status === 'fulfilled' && venueOverlapRes.value.rows[0]
			? {
					cauldronOnly: Number(venueOverlapRes.value.rows[0].cauldron_only),
					tapswapOnly: Number(venueOverlapRes.value.rows[0].tapswap_only),
					fexOnly: Number(venueOverlapRes.value.rows[0].fex_only),
					cauldronAndTapswap: Number(venueOverlapRes.value.rows[0].cauldron_and_tapswap),
					cauldronAndFex: Number(venueOverlapRes.value.rows[0].cauldron_and_fex),
					tapswapAndFex: Number(venueOverlapRes.value.rows[0].tapswap_and_fex),
					allThree: Number(venueOverlapRes.value.rows[0].all_three)
				}
			: {
					cauldronOnly: 0,
					tapswapOnly: 0,
					fexOnly: 0,
					cauldronAndTapswap: 0,
					cauldronAndFex: 0,
					tapswapAndFex: 0,
					allThree: 0
				};

	const metadata =
		metadataRes.status === 'fulfilled' && metadataRes.value.rows[0]
			? {
					hasName: Number(metadataRes.value.rows[0].has_name),
					hasSymbol: Number(metadataRes.value.rows[0].has_symbol),
					hasIcon: Number(metadataRes.value.rows[0].has_icon),
					hasDescription: Number(metadataRes.value.rows[0].has_description),
					total: Number(metadataRes.value.rows[0].total)
				}
			: { hasName: 0, hasSymbol: 0, hasIcon: 0, hasDescription: 0, total: 0 };

	for (const r of pageResults) {
		if (r.status === 'rejected') console.error('[stats] metric query failed:', r.reason);
	}

	return {
		byType,
		newIn24h: parentData.newIn24h,
		newIn7d: pickNumber(d7Res),
		newIn30d: pickNumber(d30Res),
		burned: enrichmentReady ? pickNumber(burnedRes) : null,
		tapswapListedCategories: pickNumber(tapswapCatsRes),
		cauldronListedCategories: pickNumber(cauldronCatsRes),
		fexListedCategories: pickNumber(fexCatsRes),
		genesisByMonth,
		decimalsBuckets,
		venueOverlap,
		metadata,
		moderated: pickNumber(moderatedRes),
		cauldronStats
	};
};
