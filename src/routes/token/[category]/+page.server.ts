// Per-token detail page. Joins tokens + metadata + state from Postgres,
// then fetches live Cauldron price + TVL and the top-10 holders in
// parallel. BCH price is fetched server-side so market-cap + TVL USD
// don't wait on a client-side /api/bchPrice round-trip.

import { error } from '@sveltejs/kit';
import { query, hexFromBytes, bytesFromHex } from '$lib/server/db';
import { fetchBcmr, fetchCauldron } from '$lib/server/external';
import { fetchCrc20Detail } from '$lib/server/crc20';
import { computeMcapTvlThresholdSats } from '$lib/server/mcapThreshold';
import { getVoteCounts, getLeaderboardStandings } from '$lib/server/votes';
import { getMovers24h } from '$lib/server/movers';
import { resolveIconStatus } from '$lib/icons';
import type { PageServerLoad } from './$types';
import type { TokenType } from '$lib/types';

const HEX_REGEX = /^[0-9a-fA-F]{64}$/;

interface TokenRow {
	category: Buffer;
	token_type: TokenType;
	genesis_block: number;
	genesis_time: Date;
	first_seen_at: Date;
	name: string | null;
	symbol: string | null;
	decimals: number | null;
	description: string | null;
	icon_uri: string | null;
	icon_cleared_hash: string | null;
	icon_state: string | null;
	icon_block_reason: string | null;
	icon_fetch_error: string | null;
	icon_scan_present: boolean;
	bcmr_fetched_at: Date | null;
	current_supply: string | null;
	live_utxo_count: number | null;
	live_nft_count: number | null;
	holder_count: number | null;
	has_active_minting: boolean | null;
	is_fully_burned: boolean | null;
	verified_at: Date | null;
	is_moderated: boolean;
}

interface HolderRow {
	address: string;
	balance: string;
	nft_count: number;
}

interface FexRow {
	price_sats: number | null;
	tvl_satoshis: string | null;
}

interface TapswapOfferRow {
	id: Buffer;
	has_amount: string | null;
	has_commitment: Buffer | null;
	has_capability: 'none' | 'mutable' | 'minting' | null;
	has_sats: string;
	want_sats: string;
	want_category: Buffer | null;
	want_amount: string | null;
	want_commitment: Buffer | null;
	want_capability: 'none' | 'mutable' | 'minting' | null;
	maker_pkh: Buffer;
	listed_block: number;
	listed_at: Date;
}

async function fetchBchPrice(fetch: typeof globalThis.fetch): Promise<number> {
	try {
		const res = await fetch('/api/bchPrice', {
			signal: AbortSignal.timeout(4000)
		});
		const data = await res.json();
		return typeof data?.USD === 'number' ? data.USD : 0;
	} catch {
		return 0;
	}
}

// Range-to-bucket mapping for the price chart. Each window picks a bucket
// width that yields ~24-100 points — dense enough to show shape, sparse
// enough that the SVG isn't a wall of bars. Keyed by the URL `?range=`.
//
// Tuple shape: [PG date_trunc field OR derived bucket, interval, label].
// The CTE uses a CASE-by-range structure server-side so we don't have to
// concatenate SQL fragments client-trusted.
//
// `ts AT TIME ZONE 'UTC'` is load-bearing: without it, both `date_trunc`
// and `EXTRACT(hour …)` honor the session's `timezone` setting (default
// is system timezone — UTC on most server PG installs, but not
// guaranteed). Pinning to UTC means bucket boundaries stay aligned
// across deploys and don't silently shift if a future docker rebuild
// picks up a different timezone default.
const PRICE_RANGES = {
	'24h': {
		interval: '24 hours',
		bucket: "date_trunc('hour', ts AT TIME ZONE 'UTC')",
		label: '24h'
	},
	'7d': {
		interval: '7 days',
		bucket:
			"date_trunc('hour', ts AT TIME ZONE 'UTC')" +
			" - (EXTRACT(hour FROM ts AT TIME ZONE 'UTC')::int % 6) * INTERVAL '1 hour'",
		label: '7d'
	},
	'30d': {
		interval: '30 days',
		bucket: "date_trunc('day', ts AT TIME ZONE 'UTC')",
		label: '30d'
	},
	'90d': {
		interval: '90 days',
		bucket: "date_trunc('day', ts AT TIME ZONE 'UTC')",
		label: '90d'
	},
	'1y': {
		interval: '365 days',
		bucket: "date_trunc('week', ts AT TIME ZONE 'UTC')",
		label: '1y'
	},
	all: {
		interval: null,
		bucket: "date_trunc('week', ts AT TIME ZONE 'UTC')",
		label: 'all'
	}
} as const;

type PriceRange = keyof typeof PRICE_RANGES;
const DEFAULT_RANGE: PriceRange = '7d';

interface PriceBucketRow {
	bucket: Date;
	avg_price_sats: number | null;
	volume_sats: string | null;
}

export interface PriceBucket {
	ts: number;
	priceSats: number | null;
	volumeSats: number | null;
}

export const load: PageServerLoad = async ({ params, fetch, url }) => {
	const category = params.category.toLowerCase();
	if (!HEX_REGEX.test(category)) {
		error(400, 'invalid category (expected 64 hex chars)');
	}

	const categoryBytes = bytesFromHex(category);

	// Parse the active price-chart range. Strict allowlist to keep
	// unsanitized input out of the SQL fragment. Default to 7d which is
	// a reasonable detail-page-default (most-trafficked pages opening to
	// a known-populated window).
	const rangeParam = url.searchParams.get('range') as PriceRange | null;
	const range: PriceRange =
		rangeParam && rangeParam in PRICE_RANGES ? rangeParam : DEFAULT_RANGE;
	const rangeSpec = PRICE_RANGES[range];

	// One query instead of two: LEFT JOIN token_moderation and return an
	// `is_moderated` boolean alongside the row. Saves a round-trip on
	// every detail-page render. 404 for missing category, 410 for hidden.
	const tokenRes = await query<TokenRow>(
		`SELECT
			t.category,
			t.token_type,
			t.genesis_block,
			t.genesis_time,
			t.first_seen_at,
			m.name,
			m.symbol,
			m.decimals,
			m.description,
			m.icon_uri,
			m.fetched_at AS bcmr_fetched_at,
			encode(imo_clear.content_hash, 'hex') AS icon_cleared_hash,
			imo_any.state          AS icon_state,
			imo_any.block_reason   AS icon_block_reason,
			ius.fetch_error        AS icon_fetch_error,
			(ius.icon_uri IS NOT NULL) AS icon_scan_present,
			s.current_supply::text AS current_supply,
			s.live_utxo_count,
			s.live_nft_count,
			s.holder_count,
			s.has_active_minting,
			s.is_fully_burned,
			s.verified_at,
			(mod.category IS NOT NULL) AS is_moderated
		   FROM tokens t
		   LEFT JOIN token_metadata  m   ON m.category  = t.category
		   LEFT JOIN token_state     s   ON s.category  = t.category
		   LEFT JOIN token_moderation mod ON mod.category = t.category
		   LEFT JOIN icon_url_scan ius ON ius.icon_uri = m.icon_uri
		   -- Cleared-only join keeps the existing iconHrefFor() contract:
		   -- icon_cleared_hash is non-null iff this URI's bytes have been
		   -- explicitly cleared. The second join (imo_any) returns whatever
		   -- moderation row exists regardless of state, powering the
		   -- "why is this icon hidden?" reason banner.
		   LEFT JOIN icon_moderation imo_clear
		     ON imo_clear.content_hash = ius.content_hash AND imo_clear.state = 'cleared'
		   LEFT JOIN icon_moderation imo_any
		     ON imo_any.content_hash = ius.content_hash
		  WHERE t.category = $1`,
		[categoryBytes]
	);

	if (tokenRes.rows.length === 0) {
		error(404, 'token not found');
	}
	if (tokenRes.rows[0].is_moderated) {
		// 410 Gone so search engines drop the URL (versus 404 "never
		// existed"). Reason / note are operator-private — user-visible
		// message is intentionally terse.
		error(410, 'This token has been hidden from the tokenstork directory.');
	}

	const row = tokenRes.rows[0];

	const [
		holdersRes,
		bchPriceUSD,
		bcmr,
		tapswapRes,
		fexRes,
		mcapTvlThresholdSats,
		priceHistoryRes,
		voteCounts,
		watchlistCountRes,
		movers,
		venueAggregateRes,
		priceExtremesRes,
		recentTradesRes,
		reportCountRes,
		leaderboardStandingsRes,
		tvlRankRes,
		crc20Detail
	] = await Promise.all([
		query<HolderRow>(
			`SELECT address, balance::text AS balance, nft_count
			   FROM token_holders
			  WHERE category = $1
			  ORDER BY balance DESC, address ASC
			  LIMIT 10`,
			[categoryBytes]
		),
		fetchBchPrice(fetch),
		fetchBcmr(category),
		// Open Tapswap offers with this category on the "has" side
		// (someone selling this token). Sorted by want_sats ASC so the
		// cheapest asks render first. Limit 20 — detail page doesn't need
		// a full paginated listing browser; Tapswap's own UI does that.
		//
		// Moderation: the tokenRes query above already throws 410 before
		// this fires for hidden categories, so the NOT EXISTS clause is
		// belt-and-braces. Keeping the guard inside the SQL means a future
		// refactor that parallelises the moderation probe with this fetch
		// won't leak.
		query<TapswapOfferRow>(
			`SELECT id,
			        has_amount::text    AS has_amount,
			        has_commitment,
			        has_capability,
			        has_sats::text      AS has_sats,
			        want_sats::text     AS want_sats,
			        want_category,
			        want_amount::text   AS want_amount,
			        want_commitment,
			        want_capability,
			        maker_pkh,
			        listed_block,
			        listed_at
			   FROM tapswap_offers
			  WHERE has_category = $1
			    AND status = 'open'
			    AND NOT EXISTS (
			      SELECT 1 FROM token_moderation mod WHERE mod.category = $1
			    )
			  ORDER BY want_sats ASC
			  LIMIT 20`,
			[categoryBytes]
		),
		// Fex pool state — read from the snapshot populated by the
		// `sync-fex` worker (4h cadence), not a live BCHN scan. An SSR
		// path hitting scantxoutset would be slow + contend with the
		// worker; the snapshot is the right freshness tier for a directory.
		// Row absent = token isn't listed on Fex. The 410 guard above
		// already ensures moderated categories don't reach here; no extra
		// moderation clause needed.
		query<FexRow>(
			`SELECT price_sats, tvl_satoshis::text AS tvl_satoshis
			   FROM token_venue_listings
			  WHERE category = $1 AND venue = 'fex'
			  LIMIT 1`,
			[categoryBytes]
		),
		computeMcapTvlThresholdSats(),
		// Bucketed price + volume series for the chart. Volume is derived
		// from |TVL deltas| between consecutive snapshots — a lower bound
		// on actual swap volume since within-bucket oscillation is
		// invisible at our 4h sync cadence (10min fast-pass for already-
		// listed tokens narrows that gap).
		//
		// One CTE: order rows by ts, compute LAG(tvl) for the per-row
		// delta, then aggregate per bucket. AVG(price_sats) gives a
		// per-bucket mean which is honest at this granularity.
		//
		// `?range=all` skips the WHERE-by-interval clause; otherwise we
		// constrain to `now() - INTERVAL <window>` so PG can use the
		// (category, venue, ts DESC) index efficiently.
		query<PriceBucketRow>(
			`WITH ordered AS (
			   SELECT ts,
			          price_sats,
			          tvl_satoshis,
			          tvl_satoshis - LAG(tvl_satoshis) OVER (ORDER BY ts) AS tvl_delta
			     FROM token_price_history
			    WHERE category = $1
			      AND venue = 'cauldron'
			      ${rangeSpec.interval ? `AND ts > now() - INTERVAL '${rangeSpec.interval}'` : ''}
			 )
			 SELECT ${rangeSpec.bucket}              AS bucket,
			        AVG(price_sats)::double precision AS avg_price_sats,
			        SUM(ABS(tvl_delta)) FILTER (WHERE tvl_delta IS NOT NULL)::text AS volume_sats
			   FROM ordered
			  GROUP BY bucket
			  ORDER BY bucket ASC`,
			[categoryBytes]
		),
		// Aggregate up/down counts for this category. One COUNT(*) FILTER
		// against user_votes_category_vote_idx — index-only scan, no heap
		// fetches. Returns { upCount: 0, downCount: 0 } for tokens with no
		// votes yet (the SELECT returns one row even with zero matches).
		getVoteCounts(categoryBytes),
		// Number of distinct wallets watching this token. Cheap COUNT(*)
		// over the (cashaddr, category) PK; renders an "On N watchlists"
		// pill when > 0.
		query<{ n: string }>(
			`SELECT COUNT(*)::bigint AS n FROM user_watchlist WHERE category = $1`,
			[categoryBytes]
		),
		// 24h gainers / losers / TVL movers — same shared module the
		// homepage + /stats use. We fan out per-token by checking
		// membership in the returned arrays; no per-token round-trip.
		getMovers24h(),
		// Per-venue (cauldron, fex) snapshot for first_listed_at +
		// pool aggregates. Used for "Listed on Cauldron since YYYY-MM-DD"
		// + the >10% TVL share badge. Two-row return at most.
		query<{
			venue: 'cauldron' | 'fex';
			tvl_satoshis: string | null;
			pools_count: number | null;
			pools_total_tvl_sats: string | null;
			first_listed_at: Date;
		}>(
			`SELECT venue,
			        tvl_satoshis::text AS tvl_satoshis,
			        pools_count,
			        pools_total_tvl_sats::text AS pools_total_tvl_sats,
			        first_listed_at
			   FROM token_venue_listings
			  WHERE category = $1`,
			[categoryBytes]
		),
		// 24h / 7d / 30d high-low extremes. One MIN/MAX pass per window
		// from the (category, venue, ts DESC) index. Skip 'all' and '1y'
		// — at large windows the absolute high/low rarely tells the user
		// anything actionable about the current price action.
		query<{
			window: '24h' | '7d' | '30d';
			price_min: number | null;
			price_max: number | null;
		}>(
			`WITH windows AS (
			   SELECT '24h'::text AS window, INTERVAL '24 hours' AS interval
			   UNION ALL SELECT '7d',  INTERVAL '7 days'
			   UNION ALL SELECT '30d', INTERVAL '30 days'
			 )
			 SELECT w.window,
			        MIN(h.price_sats)::double precision AS price_min,
			        MAX(h.price_sats)::double precision AS price_max
			   FROM windows w
			   LEFT JOIN token_price_history h
			     ON h.category = $1
			    AND h.venue = 'cauldron'
			    AND h.ts > now() - w.interval
			    AND h.price_sats > 0
			  GROUP BY w.window`,
			[categoryBytes]
		),
		// Count of price-history buckets in the last 24h with non-zero
		// |TVL delta| — a proxy for trade activity since we don't have
		// per-trade rows. Same |delta| logic the chart uses for volume.
		query<{ trade_buckets: string; volume_sats: string | null }>(
			`WITH ordered AS (
			   SELECT ts,
			          tvl_satoshis,
			          tvl_satoshis - LAG(tvl_satoshis) OVER (ORDER BY ts) AS tvl_delta
			     FROM token_price_history
			    WHERE category = $1
			      AND venue = 'cauldron'
			      AND ts > now() - INTERVAL '24 hours'
			 )
			 SELECT
			   COUNT(*) FILTER (WHERE tvl_delta IS NOT NULL AND tvl_delta != 0)::bigint AS trade_buckets,
			   SUM(ABS(tvl_delta)) FILTER (WHERE tvl_delta IS NOT NULL)::text AS volume_sats
			   FROM ordered`,
			[categoryBytes]
		),
		// Public report count — number of as-yet-unactioned user reports
		// for this category. Only 'new' status is shown publicly so a
		// dismissed-then-actioned chain doesn't double-count.
		query<{ n: string }>(
			`SELECT COUNT(*)::bigint AS n FROM token_reports
			  WHERE category = $1 AND status IN ('new','reviewed')`,
			[categoryBytes]
		),
		// Per-token leaderboard standings — current rank in each of the
		// three buckets, plus streak + medal counts pulled from
		// vote_leaderboard_history. Empty arrays if the snapshot worker
		// has never run; the UI hides the section in that case.
		getLeaderboardStandings(categoryBytes),
		// Rank of this token by Cauldron pool TVL across all listed,
		// non-moderated tokens. The CTE pins the self-row's TVL once,
		// then counts how many other listings outrank it; the +1 makes
		// it 1-based. Returns no rows when the token isn't on Cauldron at
		// all — the UI gates the badge on that.
		//
		// Wrapped in `.catch` mirroring the resilience pattern in
		// `getMovers24h` / `getLeaderboardStandings`: a transient DB
		// hiccup on this single aggregate shouldn't 500 the whole detail
		// page. Empty rows → tvlRank stays null → badge hides.
		query<{ rank: string }>(
			`WITH self AS (
			   SELECT tvl_satoshis
			     FROM token_venue_listings
			    WHERE category = $1
			      AND venue = 'cauldron'
			      AND tvl_satoshis IS NOT NULL
			 )
			 SELECT (1 + (
			   SELECT COUNT(*)::bigint
			     FROM token_venue_listings tvl
			     JOIN tokens t ON t.category = tvl.category
			    WHERE tvl.venue = 'cauldron'
			      AND tvl.tvl_satoshis IS NOT NULL
			      AND tvl.tvl_satoshis > self.tvl_satoshis
			      AND NOT EXISTS (
			        SELECT 1 FROM token_moderation mod WHERE mod.category = tvl.category
			      )
			 ))::text AS rank
			 FROM self`,
			[categoryBytes]
		).catch((err) => {
			console.error('[token detail] TVL rank query failed:', err);
			return { rows: [] as Array<{ rank: string }> };
		}),
		// CRC-20 detection lookup. Returns null for non-CRC-20 categories;
		// the detail card on the page only renders when this is non-null.
		fetchCrc20Detail(categoryBytes).catch((err) => {
			console.error('[token detail] CRC-20 detail query failed:', err);
			return null;
		})
	]);

	const decimals = row.decimals ?? bcmr?.decimals ?? 0;
	const [cauldron, cauldronGlobalRes] = await Promise.all([
		fetchCauldron(category, decimals, bchPriceUSD),
		// Exchange-wide Cauldron TVL — singleton row populated by the
		// `sync-cauldron-stats` worker. We don't fail the page if it's
		// unreachable; the >10% share badge simply doesn't render.
		query<{ tvl_sats: string }>(
			`SELECT tvl_sats::text AS tvl_sats FROM cauldron_global_stats WHERE id = 1`
		)
	]);

	// Per-venue first_listed_at lookup. Cauldron-side entry is what the
	// "Listed on Cauldron since" line uses; Fex mirrors it for symmetry.
	const venueByName: Record<'cauldron' | 'fex', { tvlSats: string | null; firstListedAt: number | null }> = {
		cauldron: { tvlSats: null, firstListedAt: null },
		fex: { tvlSats: null, firstListedAt: null }
	};
	for (const r of venueAggregateRes.rows) {
		venueByName[r.venue] = {
			tvlSats: r.tvl_satoshis,
			firstListedAt: Math.floor(r.first_listed_at.getTime() / 1000)
		};
	}

	// Cauldron exchange-wide TVL share. Only meaningful when the global
	// stats row + the per-token row both have data. The badge fires when
	// this token is ≥ 10% of total TVL.
	let cauldronTvlSharePct: number | null = null;
	const globalTvlSats = cauldronGlobalRes.rows[0]?.tvl_sats
		? Number(cauldronGlobalRes.rows[0].tvl_sats)
		: 0;
	const tokenCauldronTvlSats = venueByName.cauldron.tvlSats
		? Number(venueByName.cauldron.tvlSats)
		: 0;
	if (globalTvlSats > 0 && tokenCauldronTvlSats > 0) {
		// Single-side reserve / single-side global = same units.
		cauldronTvlSharePct = (tokenCauldronTvlSats / globalTvlSats) * 100;
	}

	// Membership in the 24h-mover leaderboards. Find by category hex —
	// `getMovers24h` already returns capped top-5 arrays.
	const findMover = (
		list: Array<{ categoryHex: string }>,
		cat: string
	): number => list.findIndex((m) => m.categoryHex === cat) + 1; // 1-based, 0 = absent
	const moverRanks = {
		gainerRank: findMover(movers.topGainers24h, category),
		loserRank: findMover(movers.topLosers24h, category),
		tvlMoverRank: findMover(movers.topTvlMovers24h, category)
	};
	// Pull the matching row's pricePct so the UI can show the magnitude.
	const moverEntry =
		movers.topGainers24h.find((m) => m.categoryHex === category) ??
		movers.topLosers24h.find((m) => m.categoryHex === category) ??
		null;
	const moverTvlEntry = movers.topTvlMovers24h.find((m) => m.categoryHex === category) ?? null;

	// Fex price/TVL — same conventions Cauldron uses, kept in lockstep so
	// `token_venue_listings.tvl_satoshis` has one unambiguous unit (single-
	// side BCH reserve) regardless of venue.
	//
	// priceUSD: raw price (sats per smallest token unit) × 10^decimals → sats
	// per whole token, then sats→BCH→USD. Same formula as
	// fetchCauldron in $lib/server/external.ts.
	//
	// tvlUSD: stored value is single-side sats; double at the render layer
	// to reflect the full pool value (both halves of a constant-product AMM
	// are equal by invariant). Mirrors fetchCauldron.tvlUSD's `* 2`.
	let fexPriceUSD = 0;
	let fexTvlUSD = 0;
	const fexRaw = fexRes.rows[0];
	if (fexRaw?.price_sats && fexRaw.price_sats > 0) {
		fexPriceUSD = (fexRaw.price_sats * Math.pow(10, decimals) / 1e8) * bchPriceUSD;
	}
	if (fexRaw?.tvl_satoshis) {
		const tvlSats = Number(fexRaw.tvl_satoshis);
		if (Number.isFinite(tvlSats)) {
			fexTvlUSD = (tvlSats / 1e8) * bchPriceUSD * 2;
		}
	}

	// Map price-history rows into chart-friendly buckets.
	const priceBuckets: PriceBucket[] = priceHistoryRes.rows.map((r) => ({
		ts: Math.floor(r.bucket.getTime() / 1000),
		priceSats: r.avg_price_sats,
		volumeSats: r.volume_sats ? Number(r.volume_sats) : null
	}));

	// Top-1 holder share — quick concentration signal. Uses the top holder's
	// balance vs current_supply if both available. Same idea for the top-10
	// concentration. Both are bounded ratios so we keep them as %.
	//
	// Clamp at 100%: snapshots can briefly observe a holder balance > the
	// current_supply column (the sum is rebuilt by a separate enrichment
	// pass; mid-pass reads can see the new balances against the old supply
	// total or vice versa). Showing "Top holder controls 132%" is more
	// alarming than informative — clamp so the user sees "100%" instead.
	const topHolderShare = (() => {
		const top = holdersRes.rows[0];
		if (!top || !row.current_supply) return null;
		try {
			const supply = BigInt(row.current_supply);
			if (supply === 0n) return null;
			const bal = BigInt(top.balance);
			// 4 decimal places: (bal * 1_000_000) / supply, then /10000.0
			return Math.min(100, Number((bal * 1_000_000n) / supply) / 10_000);
		} catch {
			return null;
		}
	})();
	const top10HolderShare = (() => {
		if (!row.current_supply || holdersRes.rows.length === 0) return null;
		try {
			const supply = BigInt(row.current_supply);
			if (supply === 0n) return null;
			let sum = 0n;
			for (const h of holdersRes.rows) sum += BigInt(h.balance);
			return Math.min(100, Number((sum * 1_000_000n) / supply) / 10_000);
		} catch {
			return null;
		}
	})();

	// "Does any BCMR metadata exist for this category?" — true if at least
	// one BCMR-derived column is populated. token_metadata rows with
	// bcmr_source = 'paytaca-missing' are inserted as 404 sentinels (all
	// fields null) and shouldn't count.
	const hasBcmrMetadata =
		row.name != null ||
		row.symbol != null ||
		row.description != null ||
		row.icon_uri != null ||
		bcmr != null;

	const iconStatus = resolveIconStatus({
		iconUri: row.icon_uri,
		clearedHash: row.icon_cleared_hash,
		moderationState: row.icon_state,
		blockReason: row.icon_block_reason,
		fetchError: row.icon_fetch_error,
		hasScanRow: row.icon_scan_present,
		hasBcmrMetadata
	});

	// 24h Cauldron volume estimate — already aggregated by the recent-trades
	// query above. Convert to USD with the live BCH price (mirrors the chart
	// caption's lower-bound disclaimer).
	const recentRow = recentTradesRes.rows[0];
	const recentVolumeSats = recentRow?.volume_sats ? Number(recentRow.volume_sats) : 0;
	const recentVolumeUSD =
		bchPriceUSD > 0 && recentVolumeSats > 0
			? (recentVolumeSats / 1e8) * bchPriceUSD
			: 0;
	const recentTradeBuckets = recentRow?.trade_buckets ? Number(recentRow.trade_buckets) : 0;

	// Flatten 24h/7d/30d high-low into a record for the UI.
	const priceExtremes: Record<'24h' | '7d' | '30d', { min: number | null; max: number | null }> = {
		'24h': { min: null, max: null },
		'7d': { min: null, max: null },
		'30d': { min: null, max: null }
	};
	for (const r of priceExtremesRes.rows) {
		// USD conversion: same formula fetchCauldron uses.
		const toUsd = (px: number | null): number | null => {
			if (px == null || px <= 0 || bchPriceUSD <= 0) return null;
			return (px * Math.pow(10, decimals) / 1e8) * bchPriceUSD;
		};
		priceExtremes[r.window] = { min: toUsd(r.price_min), max: toUsd(r.price_max) };
	}

	// Arbitrage eligibility — same ≥ 2-venue rule as /arbitrage, and same
	// SOURCE OF TRUTH as /arbitrage: the DB-side `token_venue_listings`
	// presence (canonical pool's BCH reserve in sats) for the AMM venues
	// + Tapswap open FT-only offers for the P2P venue.
	//
	// Important: do NOT key off the live `cauldron.priceUSD` — that field
	// reflects whatever the live indexer.cauldron.quest API returned this
	// request, and a transient API hiccup would flip arbitrage eligibility
	// on/off here while leaving /arbitrage's DB-driven view unchanged.
	// The detail page's badge has to agree with the listing on /arbitrage,
	// so both sites read from the same DB-side source.
	const cauldronListed = venueByName.cauldron.tvlSats != null;
	const fexListed = venueByName.fex.tvlSats != null;
	const tapswapFtOffer = tapswapRes.rows.find(
		(o) => o.has_commitment == null && o.has_amount && o.want_amount == null && Number(o.want_sats) > 0
	);
	const tapswapHasPrice = !!tapswapFtOffer;
	const arbitrageVenuesPresent =
		(cauldronListed ? 1 : 0) + (fexListed ? 1 : 0) + (tapswapHasPrice ? 1 : 0);
	// Spread % is informational only (the arbitrage badge fires on
	// listing presence regardless). We use the live USD prices here for
	// the spread magnitude because that's what a visitor would see if
	// they crossed venues right now; if a venue's live price is missing
	// we just exclude it from the spread calc rather than dropping the
	// badge entirely.
	let arbitrageRawSpreadPct: number | null = null;
	if (arbitrageVenuesPresent >= 2) {
		const usdPrices: number[] = [];
		if (cauldron.priceUSD > 0) usdPrices.push(cauldron.priceUSD);
		if (fexPriceUSD > 0) usdPrices.push(fexPriceUSD);
		if (tapswapHasPrice && tapswapFtOffer && tapswapFtOffer.has_amount) {
			// (want_sats / has_amount) is sats per smallest unit; convert
			// to USD per whole token using the same shape as fetchCauldron.
			const askSats = Number(tapswapFtOffer.want_sats) / Number(tapswapFtOffer.has_amount);
			if (Number.isFinite(askSats) && askSats > 0 && bchPriceUSD > 0) {
				usdPrices.push((askSats * Math.pow(10, decimals) / 1e8) * bchPriceUSD);
			}
		}
		if (usdPrices.length >= 2) {
			const min = Math.min(...usdPrices);
			const max = Math.max(...usdPrices);
			arbitrageRawSpreadPct = min > 0 ? ((max - min) / min) * 100 : null;
		}
	}

	const reportCount = Number(reportCountRes.rows[0]?.n ?? 0);
	const watchlistCount = Number(watchlistCountRes.rows[0]?.n ?? 0);

	// Top-N-by-Cauldron-TVL badge. The query returns no rows for tokens
	// not listed on Cauldron; otherwise rank is 1-based against every
	// non-moderated Cauldron-listed token. We surface the badge only
	// for ranks 1-10 — anything below that is informational noise.
	const tvlRankRaw = tvlRankRes.rows[0]?.rank ? Number(tvlRankRes.rows[0].rank) : null;
	const tvlRank = tvlRankRaw != null && tvlRankRaw >= 1 && tvlRankRaw <= 10 ? tvlRankRaw : null;

	return {
		token: {
			id: hexFromBytes(row.category)!,
			tokenType: row.token_type,
			genesisBlock: row.genesis_block,
			genesisTime: Math.floor(row.genesis_time.getTime() / 1000),
			firstSeenAt: Math.floor(row.first_seen_at.getTime() / 1000),
			// Name / symbol / decimals fall back through BCMR (already
			// applied above) and finally to the on-chain CRC-20 covenant
			// reveal — the chain carries authoritative bytes even when no
			// BCMR is published for the category.
			name: row.name ?? bcmr?.name ?? crc20Detail?.name ?? null,
			symbol: row.symbol ?? bcmr?.symbol ?? crc20Detail?.symbol ?? null,
			decimals,
			description: row.description ?? bcmr?.description ?? null,
			icon: row.icon_uri ?? bcmr?.iconUri ?? null,
			iconClearedHash: row.icon_cleared_hash ?? null,
			iconStatus,
			bcmrFetchedAt: row.bcmr_fetched_at
				? Math.floor(row.bcmr_fetched_at.getTime() / 1000)
				: null,
			currentSupply: row.current_supply,
			liveUtxoCount: row.live_utxo_count,
			liveNftCount: row.live_nft_count,
			holderCount: row.holder_count,
			hasActiveMinting: row.has_active_minting ?? false,
			isFullyBurned: row.is_fully_burned ?? false,
			isVerifiedOnchain: row.verified_at !== null,
			topHolderSharePct: topHolderShare,
			top10HolderSharePct: top10HolderShare
		},
		// Full BCMR dump — surfaced in a dedicated card on the detail page
		// so users can see every metadata field the registry publishes
		// (links, NFT types, extensions, tags, status, splitId). Null
		// when Paytaca has nothing for this category, which means no
		// BCMR card renders on the page.
		bcmr: bcmr
			? {
				status: bcmr.status,
				splitId: bcmr.splitId,
				uris: bcmr.uris,
				tags: bcmr.tags,
				extensions: bcmr.extensions,
				nftTypes: bcmr.nftTypes,
				nftsDescription: bcmr.nftsDescription
			}
			: null,
		holders: holdersRes.rows.map((h) => ({
			address: h.address,
			balance: h.balance,
			nftCount: h.nft_count
		})),
		tapswapOffers: tapswapRes.rows.map((o) => ({
			id: hexFromBytes(o.id)!,
			hasAmount: o.has_amount,
			hasCommitment: o.has_commitment ? hexFromBytes(o.has_commitment) : null,
			hasCapability: o.has_capability,
			hasSats: o.has_sats,
			wantSats: o.want_sats,
			wantCategory: o.want_category ? hexFromBytes(o.want_category) : null,
			wantAmount: o.want_amount,
			wantCommitment: o.want_commitment ? hexFromBytes(o.want_commitment) : null,
			wantCapability: o.want_capability,
			makerPkhHex: hexFromBytes(o.maker_pkh)!,
			listedBlock: o.listed_block,
			listedAt: Math.floor(o.listed_at.getTime() / 1000)
		})),
		priceUSD: cauldron.priceUSD,
		tvlUSD: cauldron.tvlUSD,
		fexPriceUSD,
		fexTvlUSD,
		bchPriceUSD,
		// Low-liquidity gate for the Market cap card (issue #8). Convert the
		// satoshi threshold into USD with the same 2x factor fetchCauldron
		// uses for tvlUSD (Cauldron is a double-sided AMM) so the comparison
		// against `tvlUSD` is apples-to-apples.
		mcapTvlThresholdUSD: (mcapTvlThresholdSats / 1e8) * bchPriceUSD * 2,
		// Price-chart series + active range. The page renders the chart
		// from these; range-toggle links update `?range=` in the URL,
		// causing the loader to re-fetch with a different bucket size.
		priceChart: {
			range,
			rangeLabel: rangeSpec.label,
			buckets: priceBuckets
		},
		// Live vote aggregates. The user's own vote (if any) is read by the
		// VoteButton from page.data.userVoteByCategory in the layout load.
		votes: {
			upCount: voteCounts.upCount,
			downCount: voteCounts.downCount
		},
		// Number of distinct wallets watching this token. Header pill
		// renders only when > 0.
		watchlistCount,
		// 24h-mover memberships. Each rank is 1-based; 0 means "not on the
		// list". `pricePct` magnitude lets the UI show "+12.4%" alongside
		// the rank pill. tvlPct similarly for the TVL-mover surface.
		moverBadges: {
			gainerRank: moverRanks.gainerRank,
			loserRank: moverRanks.loserRank,
			tvlMoverRank: moverRanks.tvlMoverRank,
			pricePct: moverEntry?.pricePct ?? null,
			tvlPct: moverTvlEntry?.tvlPct ?? null
		},
		// /arbitrage eligibility — when this token would render on the
		// page. The UI surfaces this as a "Listed for arbitrage" pill that
		// links to /arbitrage with the row highlighted.
		arbitrage: {
			eligible: arbitrageVenuesPresent >= 2,
			venuesPresent: arbitrageVenuesPresent,
			rawSpreadPct: arbitrageRawSpreadPct
		},
		// Cauldron exchange-wide TVL share. The >10% badge fires above
		// that threshold; the percentage is shown either way when present.
		cauldronTvlSharePct,
		// Rank by Cauldron TVL across all listed, non-moderated tokens.
		// Only set when this token is in the top 10; null otherwise. The
		// detail page renders a "🏆 #N TVL" badge when present.
		tvlRank,
		// Per-venue first_listed_at (UNIX seconds). UI: "Listed on
		// Cauldron since 2025-08-12" line under the AMM venues section.
		venueListings: {
			cauldronFirstListedAt: venueByName.cauldron.firstListedAt,
			fexFirstListedAt: venueByName.fex.firstListedAt
		},
		// CRC-20 covenant detection. Null for non-CRC-20 tokens (no card
		// renders). Otherwise the detail card surfaces the on-chain symbol /
		// decimals / name bytes, the canonical-winner status, the genesis
		// provenance (commit + reveal blocks, fair_genesis_height), and the
		// list of contenders sharing this symbol bucket.
		crc20: crc20Detail,
		// 24h trading proxies. recentTradeBuckets is the count of price-
		// history buckets with non-zero TVL delta over the last 24h;
		// recentVolumeUSD is the lower-bound volume estimate (same |delta|
		// math the chart uses).
		recentActivity: {
			recentTradeBuckets,
			recentVolumeUSD
		},
		// 24h / 7d / 30d high-low extremes (USD). Each entry may have
		// null min/max if no Cauldron history landed in that window.
		priceExtremes,
		// Public report count for moderation transparency. Only 'new' +
		// 'reviewed' (unactioned) reports count.
		reportCount,
		// Per-bucket leaderboard standings. `latestDay` is the most
		// recent snapshot day across all buckets; if null, the snapshot
		// worker has never run and the UI hides the section entirely.
		leaderboardStandings: leaderboardStandingsRes
	};
};
