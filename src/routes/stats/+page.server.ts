// /stats — ecosystem-level metrics for the BCH CashTokens directory.
// Every counter on this page reads from Postgres only — there are no
// external HTTP calls in this load function. Cauldron's global aggregates
// (TVL, 24h/7d/30d volume, pool counts, unique-addresses-by-month) are
// pulled by the `sync-cauldron-stats` worker every 30 min and persisted
// to `cauldron_global_stats`; we read the singleton row here.
//
// USD figures are derived at this layer from `bch_price × stored_sats`
// so the slower 30 min stats cadence isn't pinned to whatever USD/BCH
// happened to be at fetch time — refreshing /stats picks up the latest
// price even when the underlying sats haven't moved.
//
// TVL is reported single-side (BCH reserve only), matching the header
// in MetricsBar. Standard AMM convention doubles this (the token side
// has equal value at the pool's pricing invariant), but we deliberately
// publish the conservative number — only the BCH actually at risk —
// and say so in the card subtitle. Volumes are NOT doubled either way:
// swap volume is a single-asset flow, not a deposited pair.
//
// `newIn24h` is sourced from the parent layout load so /stats doesn't
// re-run the same 24h count twice in one pageview.

import { query } from '$lib/server/db';
import { NOT_MODERATED_CLAUSE } from '$lib/moderation';
import type { CauldronGlobalStats } from '$lib/server/external';
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

interface MoverRow {
	category_hex: string;
	symbol: string;
	name: string;
	price_old: number;
	price_new: number;
	tvl_old: string | null;
	tvl_new: string | null;
}

interface CauldronStatsRow {
	tvl_sats: string;
	volume_24h_sats: string;
	volume_7d_sats: string;
	volume_30d_sats: string;
	pools_active: number;
	pools_ended: number;
	pools_interactions: string;
	// node-pg deserializes JSONB into the JS shape directly. Empty default
	// in the schema is `[]`, so this is always an array even on a fresh
	// install before sync-cauldron-stats has run once.
	unique_addresses_by_month: Array<{ month: string; count: number }>;
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
	const [parentData, pageResults, bchPriceUSD] = await Promise.all([
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
			),
			// Cached Cauldron global aggregates. Singleton row, populated
			// every 30 min by sync-cauldron-stats. ::text on the BIGINT
			// columns to preserve precision; node-pg returns BIGINT as a
			// string anyway but the cast makes the contract explicit.
			query<CauldronStatsRow>(
				`SELECT tvl_sats::text,
				        volume_24h_sats::text,
				        volume_7d_sats::text,
				        volume_30d_sats::text,
				        pools_active,
				        pools_ended,
				        pools_interactions::text,
				        unique_addresses_by_month
				   FROM cauldron_global_stats
				  WHERE id = 1`
			),

			// 30-day ecosystem TVL sparkline. We bucket per day and sum the
			// TVL across every (category, venue) snapshot recorded that day,
			// THEN average the snapshots within a day so a 4h-cadence
			// venue's 6 snapshots don't 6x-weight that day. Last-snapshot-
			// per-(category,venue,day) would be more honest but expensive;
			// the daily mean is a reasonable proxy at 30-day granularity.
			//
			// `cauldron` and `fex` only — Tapswap doesn't store TVL via
			// price_history (it's P2P).
			query<{ day: Date; tvl_sats: string }>(
				`WITH daily_per_venue AS (
				  SELECT date_trunc('day', ts) AS day,
				         category,
				         venue,
				         AVG(tvl_satoshis) AS tvl
				    FROM token_price_history
				   WHERE ts > now() - INTERVAL '30 days'
				     AND venue IN ('cauldron', 'fex')
				     AND tvl_satoshis IS NOT NULL
				   GROUP BY day, category, venue
				)
				SELECT day, COALESCE(SUM(tvl), 0)::text AS tvl_sats
				  FROM daily_per_venue
				 GROUP BY day
				 ORDER BY day ASC`
			),

			// Supply-bracket distribution for FTs (and FT+NFT hybrids).
			// Buckets by displayable supply = current_supply / 10^decimals.
			// Pure NFTs are excluded — their "supply" is just the NFT count
			// and lives elsewhere in this dashboard. Each bucket gets a
			// human-readable label so the UI doesn't have to format edges.
			// 24h movers — for every Cauldron-listed category that has BOTH a
			// price point ≥ 23h ago AND a price point within the last 23h,
			// emit the oldest-eligible-old + newest pair so the consumer can
			// compute % deltas. The 23h floor is a small safety margin around
			// the 4h sync cadence so we don't lose tokens whose latest pre-
			// 24h sample landed at, e.g., 23h 58m ago. The 7d ceiling on the
			// "old" side caps how far back we'd reach if a category went
			// silent for a stretch — we won't compare a 5-day-old price to
			// today's and call it a "24h move." Cauldron only — Fex has too
			// few categories (~10) for a useful ranking, and Tapswap's
			// price_history isn't TVL-bearing.
			query<MoverRow>(
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
			),

			query<{ bucket: string; sort_order: number; n: string }>(
				`WITH disp AS (
				  SELECT t.category,
				         CASE
				           WHEN s.current_supply IS NULL OR s.current_supply = 0 THEN -1::numeric
				           ELSE s.current_supply
				                / NULLIF(POWER(10, COALESCE(m.decimals, 0))::numeric, 0)
				         END AS supply
				    FROM tokens t
				    JOIN token_state s    ON s.category = t.category
				    LEFT JOIN token_metadata m ON m.category = t.category
				   WHERE t.token_type IN ('FT', 'FT+NFT')
				     AND ${NOT_MODERATED_CLAUSE}
				)
				SELECT bucket,
				       sort_order,
				       COUNT(*)::text AS n
				  FROM (
				    SELECT
				      CASE
				        WHEN supply < 0    THEN 'zero / unknown'
				        WHEN supply < 1    THEN 'sub-1'
				        WHEN supply < 100        THEN '1 to 99'
				        WHEN supply < 10000      THEN '100 to 9.9k'
				        WHEN supply < 1000000    THEN '10k to 999k'
				        WHEN supply < 1000000000 THEN '1M to 999M'
				        WHEN supply < 1000000000000    THEN '1B to 999B'
				        WHEN supply < 1000000000000000 THEN '1T to 999T'
				        ELSE                                '1Q+'
				      END AS bucket,
				      CASE
				        WHEN supply < 0    THEN 0
				        WHEN supply < 1    THEN 1
				        WHEN supply < 100        THEN 2
				        WHEN supply < 10000      THEN 3
				        WHEN supply < 1000000    THEN 4
				        WHEN supply < 1000000000 THEN 5
				        WHEN supply < 1000000000000    THEN 6
				        WHEN supply < 1000000000000000 THEN 7
				        ELSE                                8
				      END AS sort_order
				    FROM disp
				  ) bucketed
				 GROUP BY bucket, sort_order
				 ORDER BY sort_order`
			)
		]),
		bchPriceP
	]);

	// Destructure all 16 allSettled results by name. Magic-number indexing
	// silently breaks if anyone reorders the Promise array literal above;
	// named destructuring keeps the binding tied to the source query
	// order at the source.
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
		moderatedRes,
		cauldronStatsRes,
		ecosystemTvl30dRes,
		movers24hRes,
		supplyBucketsRes
	] = pageResults as [
		PromiseSettledResult<{ rows: TypeCount[] }>,
		PromiseSettledResult<{ rows: WindowCount[] }>,
		PromiseSettledResult<{ rows: WindowCount[] }>,
		PromiseSettledResult<{ rows: WindowCount[] }>,
		PromiseSettledResult<{ rows: WindowCount[] }>,
		PromiseSettledResult<{ rows: WindowCount[] }>,
		PromiseSettledResult<{ rows: WindowCount[] }>,
		PromiseSettledResult<{ rows: GenesisMonth[] }>,
		PromiseSettledResult<{ rows: DecimalsBucket[] }>,
		PromiseSettledResult<{ rows: VenueOverlap[] }>,
		PromiseSettledResult<{ rows: MetadataCompleteness[] }>,
		PromiseSettledResult<{ rows: WindowCount[] }>,
		PromiseSettledResult<{ rows: CauldronStatsRow[] }>,
		PromiseSettledResult<{ rows: { day: Date; tvl_sats: string }[] }>,
		PromiseSettledResult<{ rows: MoverRow[] }>,
		PromiseSettledResult<{ rows: { bucket: string; sort_order: number; n: string }[] }>
	];

	// Cauldron stats — read the cached row, compute USD at render time
	// from the live BCH price. If the row hasn't been populated yet (fresh
	// deploy, sync-cauldron-stats hasn't fired), fall through to the empty
	// shape so the page still renders zeros instead of throwing.
	const usd = (sats: number): number =>
		bchPriceUSD > 0 ? (sats / 1e8) * bchPriceUSD : 0;
	const cauldronStats: CauldronGlobalStats =
		cauldronStatsRes.status === 'fulfilled' && cauldronStatsRes.value.rows[0]
			? (() => {
					const r = cauldronStatsRes.value.rows[0];
					const tvlSats = Number(r.tvl_sats) || 0;
					const v24 = Number(r.volume_24h_sats) || 0;
					const v7 = Number(r.volume_7d_sats) || 0;
					const v30 = Number(r.volume_30d_sats) || 0;
					return {
						tvlSats,
						tvlUSD: usd(tvlSats),
						volume24hSats: v24,
						volume24hUSD: usd(v24),
						volume7dSats: v7,
						volume7dUSD: usd(v7),
						volume30dSats: v30,
						volume30dUSD: usd(v30),
						pools: {
							active: r.pools_active ?? 0,
							ended: r.pools_ended ?? 0,
							interactions: Number(r.pools_interactions) || 0
						},
						uniqueAddressesByMonth: Array.isArray(r.unique_addresses_by_month)
							? r.unique_addresses_by_month
							: []
					};
				})()
			: EMPTY_CAULDRON_STATS;

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

	// Daily ecosystem TVL points, oldest-first to match Sparkline.svelte.
	const ecosystemTvl30d =
		ecosystemTvl30dRes.status === 'fulfilled'
			? ecosystemTvl30dRes.value.rows.map((r) => ({
					day: r.day.toISOString().slice(0, 10),
					tvlSats: Number(r.tvl_sats)
				}))
			: [];

	const supplyBuckets =
		supplyBucketsRes.status === 'fulfilled'
			? supplyBucketsRes.value.rows.map((r) => ({
					label: r.bucket,
					sortOrder: r.sort_order,
					count: Number(r.n)
				}))
			: [];

	// 24h movers — compute price + TVL % deltas client-side to avoid the
	// NUMERIC(30,0) → JSON precision dance for every row. Each mover only
	// needs ~6 numbers; the JS Number() cast on tvl_satoshis loses
	// precision past 2^53 sats (~92,000 BCH), well outside any pool's
	// realistic single-side reserve. Keep tvl_old / tvl_new as strings on
	// the wire and only Number-coerce here.
	const moversComputed = (
		movers24hRes.status === 'fulfilled' ? movers24hRes.value.rows : []
	).map((r) => {
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
	const topGainers24h = moversComputed
		.filter((m) => m.pricePct > 0)
		.sort((a, b) => b.pricePct - a.pricePct)
		.slice(0, 5);
	const topLosers24h = moversComputed
		.filter((m) => m.pricePct < 0)
		.sort((a, b) => a.pricePct - b.pricePct)
		.slice(0, 5);
	const topTvlMovers24h = moversComputed
		.filter((m): m is typeof m & { tvlPct: number } => m.tvlPct !== null)
		.sort((a, b) => Math.abs(b.tvlPct) - Math.abs(a.tvlPct))
		.slice(0, 5);
	// `has24hHistory` lets the UI distinguish "no points yet" (sync
	// gap, fresh deploy) from "no movement in this direction" (the
	// sign filter above produced an empty list because every move was
	// the other way). Same drought, two different empty-state copies.
	const has24hHistory = moversComputed.length > 0;

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
		cauldronStats,
		ecosystemTvl30d,
		topGainers24h,
		topLosers24h,
		topTvlMovers24h,
		has24hHistory,
		supplyBuckets
	};
};
