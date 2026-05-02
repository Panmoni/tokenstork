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

import { hexFromBytes, query } from '$lib/server/db';
import { NOT_MODERATED_CLAUSE } from '$lib/moderation';
import type { CauldronGlobalStats } from '$lib/server/external';
import { getIconModerationStats } from '$lib/server/iconStats';
import { getMovers24h } from '$lib/server/movers';
import type { PageServerLoad } from './$types';

// Vote leaderboards live on the homepage now — see
// `getVoteLeaderboards` in `$lib/server/votes`.

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
	// Icon-pipeline stats live alongside the rest of the page metrics; fired
	// in parallel via the same allSettled batch so a failure of any one
	// query doesn't tank the page (each card has its own empty-state).
	const iconStatsP = getIconModerationStats();
	const moversP = getMovers24h();
	const [parentData, pageResults, bchPriceUSD, iconStats, movers] = await Promise.all([
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
			),
			// Directory-wide median Gini. Median (vs. mean) because the
			// distribution is right-skewed — a handful of single-holder
			// NFT-test categories pull the mean toward 1.0.
			query<{ median: number | null }>(
				`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s.gini_coefficient)
				          ::double precision AS median
				   FROM token_state s
				   JOIN tokens t ON t.category = s.category
				  WHERE s.gini_coefficient IS NOT NULL
				    AND ${NOT_MODERATED_CLAUSE}`
			),
			// Histogram of categories per Gini tier. The leading 0.0 sentinel
			// in the thresholds array shifts width_bucket's output up by one
			// so the JS map can use 1-based labels. Per the Postgres docs,
			// width_bucket returns 0 for values strictly below the first
			// threshold; with 0.0 as that first threshold, every Gini in
			// [0,1] falls into bucket 1..5:
			//   1 → [0.00, 0.40) Excellent
			//   2 → [0.40, 0.60) Good
			//   3 → [0.60, 0.75) Fair
			//   4 → [0.75, 0.90) Poor
			//   5 → [0.90, 1.00] Whale-controlled
			query<{ bucket: number; total: string }>(
				`SELECT width_bucket(s.gini_coefficient::double precision, ARRAY[0.0, 0.40, 0.60, 0.75, 0.90]) AS bucket,
				        COUNT(*)::bigint AS total
				   FROM token_state s
				   JOIN tokens t ON t.category = s.category
				  WHERE s.gini_coefficient IS NOT NULL
				    AND ${NOT_MODERATED_CLAUSE}
				  GROUP BY bucket
				  ORDER BY bucket`
			),
			// Top-10 categories by open Tapswap listing count. Captures
			// "where is the P2P liquidity concentrated?" — a different
			// question to the on-Tapswap counter (which is "is this
			// listed at all?"). Joins through tokens to pick up name +
			// symbol + icon for the leaderboard, and through icon
			// scans to honour the cleared-icon contract.
			query<{
				category: Buffer;
				name: string | null;
				symbol: string | null;
				icon_uri: string | null;
				icon_cleared_hash: string | null;
				offer_count: string;
			}>(
				`SELECT t.category,
				        m.name,
				        m.symbol,
				        m.icon_uri,
				        encode(imo.content_hash, 'hex') AS icon_cleared_hash,
				        COUNT(*)::bigint AS offer_count
				   FROM tapswap_offers o
				   JOIN tokens t ON t.category = o.has_category
				   LEFT JOIN token_metadata m ON m.category = t.category
				   LEFT JOIN icon_url_scan ius ON ius.icon_uri = m.icon_uri
				   LEFT JOIN icon_moderation imo
				          ON imo.content_hash = ius.content_hash
				         AND imo.state = 'cleared'
				  WHERE o.status = 'open'
				    AND o.has_category IS NOT NULL
				    AND ${NOT_MODERATED_CLAUSE}
				  GROUP BY t.category, m.name, m.symbol, m.icon_uri, imo.content_hash
				  ORDER BY offer_count DESC, t.category ASC
				  LIMIT 10`
			),
			// Unique ecosystem holders — distinct addresses holding at least
			// one non-moderated category. The "how many actual people are in
			// this" headline number. NB: caveat is the same as the per-token
			// Gini score: exchange covenants (Cauldron pool UTXOs, Tapswap
			// escrow, Fex covenant) all count as single addresses, so this
			// undercounts true unique users by however many AMM pools each
			// person interacts with simultaneously. We surface that caveat
			// in the card subtitle.
			query<{ n: string }>(
				`SELECT COUNT(DISTINCT th.address)::bigint AS n
				   FROM token_holders th
				   JOIN tokens t ON t.category = th.category
				  WHERE ${NOT_MODERATED_CLAUSE}`
			),
			// Top-10 collectors — addresses ranked by the number of distinct
			// non-moderated categories they hold. Cross-category balance is
			// not comparable across decimals + supply scales, so the
			// canonical "biggest holder" question collapses to the count of
			// categories, not a sum of dollar-equivalent balance. Same
			// covenant-as-single-address caveat applies.
			query<{ address: string; categories_held: string }>(
				`SELECT th.address,
				        COUNT(DISTINCT th.category)::bigint AS categories_held
				   FROM token_holders th
				   JOIN tokens t ON t.category = th.category
				  WHERE ${NOT_MODERATED_CLAUSE}
				  GROUP BY th.address
				  ORDER BY categories_held DESC, th.address ASC
				  LIMIT 10`
			),
			// Active-minting count — categories with at least one live
			// minting NFT, meaning the issuer can still mint more supply.
			// Critical supply-inflation indicator: a token whose total
			// supply can grow tomorrow has very different semantics from
			// a token whose supply is permanently fixed. Populated by
			// `sync-enrich` from `token_state.has_active_minting`.
			query<WindowCount>(
				`SELECT COUNT(*)::bigint AS total
				   FROM tokens t
				   JOIN token_state s ON s.category = t.category
				  WHERE s.has_active_minting = true
				    AND ${NOT_MODERATED_CLAUSE}`
			)
		]),
		bchPriceP,
		iconStatsP,
		moversP
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
		supplyBucketsRes,
		giniMedianRes,
		giniBucketsRes,
		tapswapTopRes,
		uniqueHoldersRes,
		topCollectorsRes,
		activeMintingRes
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
		PromiseSettledResult<{ rows: { bucket: string; sort_order: number; n: string }[] }>,
		PromiseSettledResult<{ rows: { median: number | null }[] }>,
		PromiseSettledResult<{ rows: { bucket: number; total: string }[] }>,
		PromiseSettledResult<{
			rows: Array<{
				category: Buffer;
				name: string | null;
				symbol: string | null;
				icon_uri: string | null;
				icon_cleared_hash: string | null;
				offer_count: string;
			}>;
		}>,
		PromiseSettledResult<{ rows: Array<{ n: string }> }>,
		PromiseSettledResult<{ rows: Array<{ address: string; categories_held: string }> }>,
		PromiseSettledResult<{ rows: WindowCount[] }>
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

	// `percentile_cont` returns `double precision`; node-postgres parses
	// float8 as a JS number by default. Coerce defensively in case the
	// project ever installs a `pg-types` parser override that turns
	// floats into strings — `.toFixed(2)` on a string would 500 the page.
	const giniMedianRaw =
		giniMedianRes.status === 'fulfilled' ? (giniMedianRes.value.rows[0]?.median ?? null) : null;
	const giniMedian: number | null = giniMedianRaw != null ? Number(giniMedianRaw) : null;

	// Map width_bucket output (1..5) to ordered tier rows the UI can
	// render directly. width_bucket returns 0 for values below the
	// first cutoff — that can't happen for [0,1] Gini scores against
	// thresholds [0.40, 0.60, 0.75, 0.90], but be defensive: rows we
	// don't recognise just stay at zero.
	const GINI_TIER_LABELS: Record<number, string> = {
		1: 'Excellent',
		2: 'Good',
		3: 'Fair',
		4: 'Poor',
		5: 'Whale-controlled'
	};
	const giniBuckets: Array<{ bucket: number; label: string; count: number }> = [1, 2, 3, 4, 5].map(
		(b) => ({ bucket: b, label: GINI_TIER_LABELS[b], count: 0 })
	);
	if (giniBucketsRes.status === 'fulfilled') {
		for (const r of giniBucketsRes.value.rows) {
			const target = giniBuckets.find((g) => g.bucket === r.bucket);
			if (target) target.count = Number(r.total);
		}
	}

	const tapswapTop =
		tapswapTopRes.status === 'fulfilled'
			? tapswapTopRes.value.rows.map((r) => ({
					id: hexFromBytes(r.category)!,
					name: r.name,
					symbol: r.symbol,
					icon: r.icon_uri,
					iconClearedHash: r.icon_cleared_hash,
					offerCount: Number(r.offer_count)
				}))
			: [];

	const uniqueHolders =
		uniqueHoldersRes.status === 'fulfilled'
			? Number(uniqueHoldersRes.value.rows[0]?.n ?? 0)
			: null;
	const topCollectors: Array<{ address: string; categoriesHeld: number }> =
		topCollectorsRes.status === 'fulfilled'
			? topCollectorsRes.value.rows.map((r) => ({
					address: r.address,
					categoriesHeld: Number(r.categories_held)
				}))
			: [];

	const activeMinting = pickNumber(activeMintingRes);

	return {
		byType,
		newIn24h: parentData.newIn24h,
		newIn7d: pickNumber(d7Res),
		newIn30d: pickNumber(d30Res),
		burned: enrichmentReady ? pickNumber(burnedRes) : null,
		activeMinting,
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
		movers,
		supplyBuckets,
		iconStats,
		giniMedian,
		giniBuckets,
		tapswapTop,
		uniqueHolders,
		topCollectors
	};
};
