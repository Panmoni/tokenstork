// Per-token detail page. Joins tokens + metadata + state from Postgres,
// then fetches live Cauldron price + TVL and the top-10 holders in
// parallel. BCH price is fetched server-side so market-cap + TVL USD
// don't wait on a client-side /api/bchPrice round-trip.
//
// Streaming strategy (3-tier deferred):
//   Tier 0 — Synchronous (main SQL + sync processing only). Sent in the
//     initial HTML chunk: token identity (name, icon, description), type
//     badges, BCMR metadata. The user sees the real title/icon instantly.
//   Tier 1 — Fast parallel DB queries deferred into the stream. Fills the
//     hero buttons, stats grid, profile/trading, badges, holders table,
//     tapswap, and Fex price as soon as the batch resolves (~50-200ms).
//   Tier 2 — Slower CTE-based DB queries (price history, TVL/holders rank).
//     Fills the price chart and rank badges (~100-500ms).
//   Tier 3 — External API calls, split into two independent deferreds so a
//     slow one never blocks the other:
//       tier3          — Cauldron live price/TVL (price+valuelocked fetched
//         concurrently). Fills the hero price display and Cauldron venue card.
//       canPublishBcmr — BlockBook authchain walk for BCMR-publish eligibility
//         (~500ms–10s, signed-in only). Fills the publish CTA on its own.

import { error } from '@sveltejs/kit';
import { query, hexFromBytes, bytesFromHex } from '$lib/server/db';
import { firstNRankFor } from '$lib/server/firstN';
import { bcmrFromBody, fetchCauldron } from '$lib/server/external';
import { fetchCrc20Detail } from '$lib/server/crc20';
import { computeMcapTvlThresholdSats } from '$lib/server/mcapThreshold';
import { getVoteCounts, getLeaderboardStandings } from '$lib/server/votes';
import { getMovers24h } from '$lib/server/movers';
import { resolveIconStatus } from '$lib/icons';
import type { PageServerLoad } from './$types';
import type { TokenType } from '$lib/types';
import { fetchBchPrice } from '$lib/server/bchPrice';

const HEX_REGEX = /^[0-9a-fA-F]{64}$/;

interface TokenRow {
	category: Buffer;
	token_type: TokenType;
	genesis_block: number;
	genesis_time: Date;
	first_seen_at: Date;
	genesis_txid: Buffer;
	authchain_head_txid: Buffer | null;
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
	bcmr_publication_uri: string | null;
	bcmr_source: string | null;
	bcmr_body: unknown;
	bcmr_fetched_at: Date | null;
	current_supply: string | null;
	live_utxo_count: number | null;
	live_nft_count: number | null;
	holder_count: number | null;
	has_active_minting: boolean | null;
	is_fully_burned: boolean | null;
	gini_coefficient: number | null;
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

/**
 * Check whether the authenticated wallet can publish a BCMR for this
 * category. Soft-fail: returns false on any error (BlockBook unreachable,
 * authchain walk timeout, etc.) — the "Publish BCMR" CTA just doesn't
 * appear.
 *
 * Extracted from the main load function so it can be fired as a Promise
 * inside the main batch rather than serialising after 17+ DB queries.
 * The check makes 1–N BlockBook RPCs (one for the cached head, plus a
 * cold authchain walk if the cache is stale). BlockBook `tx?spending=true`
 * calls can take 500ms–10s depending on tx size and RocksDB load, so
 * running this concurrently with the DB batch saves ~1–2s of serial
 * latency on the critical path.
 */
async function checkBcmrPublishEligibility(
	row: { authchain_head_txid: Buffer | null; genesis_txid: Buffer },
	cashaddr: string
): Promise<boolean> {
	try {
		const { isOwnerOfHeadVout0, findAuthchainHead } = await import(
			'$lib/server/authchain'
		);
		let headTxidHex: string | null = row.authchain_head_txid
			? hexFromBytes(row.authchain_head_txid)
			: null;
		let owns: boolean | null = null;
		if (headTxidHex) {
			owns = await isOwnerOfHeadVout0(headTxidHex, cashaddr);
		}
		if (owns === null) {
			// Cached head is stale OR no cache at all — fall back to a
			// cold walk. This is the common case for freshly-minted
			// categories the BCMR walker hasn't visited yet.
			const cold = await findAuthchainHead(hexFromBytes(row.genesis_txid)!);
			owns = cold.headVout0Addresses.includes(cashaddr);
		}
		return !!owns;
	} catch (err) {
		console.warn(
			'[token detail] BCMR-publish eligibility check failed:',
			(err as Error).message
		);
		return false;
	}
}

export const load: PageServerLoad = async ({ params, fetch, url, locals }) => {
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

	// ─── TIER 0: Fire main SQL + BCH price + CRC-20 in parallel ───────────
	// These are independent: the main query reads Postgres, BCH price hits
	// our own /api/bchPrice (~50ms), CRC-20 is a simple DB lookup. All
	// three fire concurrently.
	const [tokenRes, bchPriceUSD, crc20Detail] = await Promise.all([
		// One query instead of two: LEFT JOIN token_moderation and return an
		// `is_moderated` boolean alongside the row. Saves a round-trip on
		// every detail-page render. 404 for missing category, 410 for hidden.
		query<TokenRow>(
			`SELECT
				t.category,
				t.token_type,
				t.genesis_block,
				t.genesis_time,
				t.first_seen_at,
				t.genesis_txid,
				t.authchain_head_txid,
				m.name,
				m.symbol,
				m.decimals,
				m.description,
				m.icon_uri,
				m.bcmr_publication_uri,
				m.bcmr_source,
				m.bcmr_body,
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
				s.gini_coefficient,
				s.verified_at,
				(mod.category IS NOT NULL) AS is_moderated
			   FROM tokens t
			   LEFT JOIN token_metadata  m   ON m.category  = t.category
			   LEFT JOIN token_state     s   ON s.category  = t.category
			   LEFT JOIN token_moderation mod ON mod.category = t.category
			   LEFT JOIN icon_url_scan ius ON ius.icon_uri = m.icon_uri
			   LEFT JOIN icon_moderation imo_clear
			     ON imo_clear.content_hash = ius.content_hash AND imo_clear.state = 'cleared'
			   LEFT JOIN icon_moderation imo_any
			     ON imo_any.content_hash = ius.content_hash
			  WHERE t.category = $1`,
			[categoryBytes]
		),
		fetchBchPrice(fetch),
		fetchCrc20Detail(categoryBytes).catch((err) => {
			console.error('[token detail] CRC-20 detail query failed:', err);
			return null;
		})
	]);

	if (tokenRes.rows.length === 0) {
		error(404, 'token not found');
	}
	if (tokenRes.rows[0].is_moderated) {
		error(410, 'This token has been hidden from the tokenstork directory.');
	}

	const row = tokenRes.rows[0];

	// BCMR rich-card data — read from the cached `bcmr_body` column.
	// Synchronous + zero I/O.
	const bcmr = bcmrFromBody(row.bcmr_body, category);

	// Resolve decimals (metadata → BCMR → 0) before the main batch so
	// fetchCauldron (which needs decimals) can fire concurrently.
	const decimals = row.decimals ?? bcmr?.decimals ?? 0;

	// Icon status — resolved synchronously from the row + icon moderation.
	const iconStatus = resolveIconStatus({
		iconUri: row.icon_uri,
		clearedHash: row.icon_cleared_hash,
		moderationState: row.icon_state,
		blockReason: row.icon_block_reason,
		fetchError: row.icon_fetch_error,
		hasScanRow: row.icon_scan_present,
		hasBcmrMetadata:
			row.name != null ||
			row.symbol != null ||
			row.description != null ||
			row.icon_uri != null ||
			bcmr != null
	});

	// ─── TIER 0 SYNC DATA: everything available without further I/O ───────
	const token = {
		id: hexFromBytes(row.category)!,
		tokenType: row.token_type,
		genesisBlock: row.genesis_block,
		genesisTime: Math.floor(row.genesis_time.getTime() / 1000),
		firstSeenAt: Math.floor(row.first_seen_at.getTime() / 1000),
		firstNRank: null as number | null, // filled by tier1
		// Name / symbol / decimals fall back through BCMR and finally to
		// CRC-20 covenant reveal — chain carries authoritative bytes.
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
		bcmrPublicationUri: row.bcmr_publication_uri,
		bcmrSource: row.bcmr_source,
		currentSupply: row.current_supply,
		liveUtxoCount: row.live_utxo_count,
		liveNftCount: row.live_nft_count,
		holderCount: row.holder_count,
		hasActiveMinting: row.has_active_minting ?? false,
		isFullyBurned: row.is_fully_burned ?? false,
		isVerifiedOnchain: row.verified_at !== null,
		topHolderSharePct: null as number | null, // filled by tier1
		top10HolderSharePct: null as number | null, // filled by tier1
		giniCoefficient: row.gini_coefficient,
		herfindahlIndex: null as number | null // filled by tier1
	};

	const bcmrData = bcmr
		? {
				status: bcmr.status,
				splitId: bcmr.splitId,
				uris: bcmr.uris,
				tags: bcmr.tags,
				extensions: bcmr.extensions,
				nftTypes: bcmr.nftTypes,
				nftsDescription: bcmr.nftsDescription
			}
		: null;

	// ─── FIRE ALL REMAINING QUERIES IN PARALLEL ─────────────────────────
	// Every promise below starts in the same microtask. The deferred tiers
	// group them logically so the client receives results as soon as the
	// fastest batch finishes — no waterfall.

	// --- TIER 1 QUERIES (fast DB queries, <100ms each) ---
	const holdersRes = query<HolderRow>(
		`SELECT address, balance::text AS balance, nft_count
		   FROM token_holders
		  WHERE category = $1
		  ORDER BY token_holders.balance DESC, address ASC
		  LIMIT 10`,
		[categoryBytes]
	);

	const tapswapRes = query<TapswapOfferRow>(
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
	);

	const fexRes = query<FexRow>(
		`SELECT price_sats, tvl_satoshis::text AS tvl_satoshis
		   FROM token_venue_listings
		  WHERE category = $1 AND venue = 'fex'
		  LIMIT 1`,
		[categoryBytes]
	);

	const mcapTvlThresholdSats = computeMcapTvlThresholdSats();

	const voteCounts = getVoteCounts(categoryBytes);

	const watchlistCountRes = query<{ n: string }>(
		`SELECT COUNT(*)::bigint AS n FROM user_watchlist WHERE category = $1`,
		[categoryBytes]
	);

	const movers = getMovers24h();

	const venueAggregateRes = query<{
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
	);

	const priceExtremesRes = query<{
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
	);

	const recentTradesRes = query<{ trade_buckets: string; volume_sats: string | null }>(
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
	);

	const reportCountRes = query<{ n: string }>(
		`SELECT COUNT(*)::bigint AS n FROM token_reports
		  WHERE category = $1 AND status IN ('new','reviewed')`,
		[categoryBytes]
	);

	const leaderboardStandingsRes = getLeaderboardStandings(categoryBytes);

	const cauldronGlobalRes = query<{ tvl_sats: string }>(
		`SELECT tvl_sats::text AS tvl_sats FROM cauldron_global_stats WHERE id = 1`
	);

	const herfindahlRes = query<{ hhi: string | null }>(
		`WITH t AS (
		   SELECT SUM(balance::numeric) AS total, COUNT(*) AS n
		     FROM token_holders WHERE category = $1
		 )
		 SELECT CASE
		          WHEN t.n < 10 THEN NULL
		          WHEN t.total IS NULL OR t.total = 0 THEN NULL
		          ELSE (
		            SELECT (SUM((th.balance::numeric / t.total) ^ 2))::text
		              FROM token_holders th
		             WHERE th.category = $1
		          )
		        END AS hhi
		   FROM t`,
		[categoryBytes]
	).catch((err) => {
		console.error('[token detail] Herfindahl query failed:', err);
		return { rows: [] as Array<{ hhi: string | null }> };
	});

	const firstNRankResult = firstNRankFor(category);

	// --- TIER 2 QUERIES (slower CTE-based queries) ---
	const priceHistoryRes = query<PriceBucketRow>(
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
	).catch((err) => {
		// Soft-fail: this LAG-window CTE is the slowest tier-2 query, so
		// under DB load it's the most likely to time out. Without this
		// catch a rejection propagates through tier2Promise's Promise.all
		// and rejects the whole streamed chunk — and the template's
		// {#await data.tier2} has no {:catch}, so the chart section would
		// silently vanish. Degrade to empty buckets instead: the chart
		// then renders its honest "not enough history" empty-state.
		console.error('[token detail] price-history query failed:', err);
		return { rows: [] as PriceBucketRow[] };
	});

	const tvlRankRes = query<{ rank: string }>(
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
	});

	const holdersRankRes = query<{ rank: string }>(
		`WITH self AS (
		   SELECT s.holder_count
		     FROM token_state s
		    WHERE s.category = $1
		      AND s.holder_count IS NOT NULL
		      AND s.holder_count > 0
		 )
		 SELECT (1 + (
		   SELECT COUNT(*)::bigint
		     FROM token_state s
		     JOIN tokens t ON t.category = s.category
		    WHERE s.holder_count IS NOT NULL
		      AND s.holder_count > self.holder_count
		      AND NOT EXISTS (
		        SELECT 1 FROM token_moderation mod WHERE mod.category = s.category
		      )
		 ))::text AS rank
		 FROM self`,
		[categoryBytes]
	).catch((err) => {
		console.error('[token detail] holders rank query failed:', err);
		return { rows: [] as Array<{ rank: string }> };
	});

	// --- TIER 3 QUERIES (external API calls, slow) ---
	const cauldronPromise = fetchCauldron(category, decimals, bchPriceUSD);

	const bcmrEligibilityPromise = locals.user
		? checkBcmrPublishEligibility(row, locals.user.cashaddr)
		: Promise.resolve(false);

	// ─── TIER 1 DEFERRED: fast DB results → hero buttons, stats, tables ──
	const tier1Promise = Promise.all([
		holdersRes,
		tapswapRes,
		fexRes,
		mcapTvlThresholdSats,
		voteCounts,
		watchlistCountRes,
		movers,
		venueAggregateRes,
		priceExtremesRes,
		recentTradesRes,
		reportCountRes,
		leaderboardStandingsRes,
		firstNRankResult,
		herfindahlRes,
		cauldronGlobalRes
	]).then(
		([
			holdersRes,
			tapswapRes,
			fexRes,
			mcapTvlThresholdSats,
			voteCounts,
			watchlistCountRes,
			movers,
			venueAggregateRes,
			priceExtremesRes,
			recentTradesRes,
			reportCountRes,
			leaderboardStandingsRes,
			firstNRankResult,
			herfindahlRes,
			cauldronGlobalRes
		]) => {
			// Per-venue first_listed_at lookup.
			const venueByName: Record<
				'cauldron' | 'fex',
				{ tvlSats: string | null; firstListedAt: number | null }
			> = {
				cauldron: { tvlSats: null, firstListedAt: null },
				fex: { tvlSats: null, firstListedAt: null }
			};
			for (const r of venueAggregateRes.rows) {
				venueByName[r.venue] = {
					tvlSats: r.tvl_satoshis,
					firstListedAt: Math.floor(r.first_listed_at.getTime() / 1000)
				};
			}

			// Cauldron exchange-wide TVL share.
			let cauldronTvlSharePct: number | null = null;
			const globalTvlSats = cauldronGlobalRes.rows[0]?.tvl_sats
				? Number(cauldronGlobalRes.rows[0].tvl_sats)
				: 0;
			const tokenCauldronTvlSats = venueByName.cauldron.tvlSats
				? Number(venueByName.cauldron.tvlSats)
				: 0;
			if (globalTvlSats > 0 && tokenCauldronTvlSats > 0) {
				cauldronTvlSharePct = (tokenCauldronTvlSats / globalTvlSats) * 100;
			}

			// Membership in 24h mover leaderboards.
			const findMover = (
				list: Array<{ categoryHex: string }>,
				cat: string
			): number => list.findIndex((m) => m.categoryHex === cat) + 1;
			const moverRanks = {
				gainerRank: findMover(movers.topGainers24h, category),
				loserRank: findMover(movers.topLosers24h, category),
				tvlMoverRank: findMover(movers.topTvlMovers24h, category)
			};
			const moverEntry =
				movers.topGainers24h.find((m) => m.categoryHex === category) ??
				movers.topLosers24h.find((m) => m.categoryHex === category) ??
				null;
			const moverTvlEntry =
				movers.topTvlMovers24h.find((m) => m.categoryHex === category) ?? null;

			// Fex price/TVL — same formula as fetchCauldron.
			let fexPriceUSD = 0;
			let fexTvlUSD = 0;
			const fexRaw = fexRes.rows[0];
			if (fexRaw?.price_sats && fexRaw.price_sats > 0) {
				fexPriceUSD =
					((fexRaw.price_sats * Math.pow(10, decimals)) / 1e8) * bchPriceUSD;
			}
			if (fexRaw?.tvl_satoshis) {
				const tvlSats = Number(fexRaw.tvl_satoshis);
				if (Number.isFinite(tvlSats)) {
					fexTvlUSD = ((tvlSats / 1e8) * bchPriceUSD) * 2;
				}
			}

			// Top-1 and top-10 holder shares.
			const topHolderShare = (() => {
				const top = holdersRes.rows[0];
				if (!top || !row.current_supply) return null;
				try {
					const supply = BigInt(row.current_supply);
					if (supply === 0n) return null;
					const bal = BigInt(top.balance);
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

			// 24h volume estimate.
			const recentRow = recentTradesRes.rows[0];
			const recentVolumeSats = recentRow?.volume_sats
				? Number(recentRow.volume_sats)
				: 0;
			const recentVolumeUSD =
				bchPriceUSD > 0 && recentVolumeSats > 0
					? ((recentVolumeSats / 1e8) * bchPriceUSD)
					: 0;
			const recentTradeBuckets = recentRow?.trade_buckets
				? Number(recentRow.trade_buckets)
				: 0;

			// Price extremes.
			const priceExtremes: Record<
				'24h' | '7d' | '30d',
				{ min: number | null; max: number | null }
			> = {
				'24h': { min: null, max: null },
				'7d': { min: null, max: null },
				'30d': { min: null, max: null }
			};
			for (const r of priceExtremesRes.rows) {
				const toUsd = (px: number | null): number | null => {
					if (px == null || px <= 0 || bchPriceUSD <= 0) return null;
					return ((px * Math.pow(10, decimals)) / 1e8) * bchPriceUSD;
				};
				priceExtremes[r.window] = {
					min: toUsd(r.price_min),
					max: toUsd(r.price_max)
				};
			}

			const watchlistCount = Number(watchlistCountRes.rows[0]?.n ?? 0);
			const reportCount = Number(reportCountRes.rows[0]?.n ?? 0);

			return {
				holders: holdersRes.rows.map((h) => ({
					address: h.address,
					balance: h.balance,
					nftCount: h.nft_count
				})),
				tapswapOffers: tapswapRes.rows.map((o) => ({
					id: hexFromBytes(o.id)!,
					hasAmount: o.has_amount,
					hasCommitment: o.has_commitment
						? hexFromBytes(o.has_commitment)
						: null,
					hasCapability: o.has_capability,
					hasSats: o.has_sats,
					wantSats: o.want_sats,
					wantCategory: o.want_category
						? hexFromBytes(o.want_category)
						: null,
					wantAmount: o.want_amount,
					wantCommitment: o.want_commitment
						? hexFromBytes(o.want_commitment)
						: null,
					wantCapability: o.want_capability,
					makerPkhHex: hexFromBytes(o.maker_pkh)!,
					listedBlock: o.listed_block,
					listedAt: Math.floor(o.listed_at.getTime() / 1000)
				})),
				votes: {
					upCount: voteCounts.upCount,
					downCount: voteCounts.downCount
				},
				watchlistCount,
				moverBadges: {
					gainerRank: moverRanks.gainerRank,
					loserRank: moverRanks.loserRank,
					tvlMoverRank: moverRanks.tvlMoverRank,
					pricePct: moverEntry?.pricePct ?? null,
					tvlPct: moverTvlEntry?.tvlPct ?? null
				},
				crc20: crc20Detail,
				leaderboardStandings: leaderboardStandingsRes,
				firstNRank: firstNRankResult,
				reportCount,
				topHolderSharePct: topHolderShare,
				top10HolderSharePct: top10HolderShare,
				herfindahlIndex: (() => {
					const raw = herfindahlRes.rows[0]?.hhi;
					if (raw == null) return null;
					const n = Number(raw);
					return Number.isFinite(n) ? n : null;
				})(),
				venueListings: {
					cauldronFirstListedAt: venueByName.cauldron.firstListedAt,
					fexFirstListedAt: venueByName.fex.firstListedAt
				},
				cauldronTvlSharePct,
				recentActivity: { recentTradeBuckets, recentVolumeUSD },
				priceExtremes,
				mcapTvlThresholdUSD:
					((mcapTvlThresholdSats / 1e8) * bchPriceUSD) * 2,
				fexPriceUSD,
				fexTvlUSD,
				// Arbitrage eligibility based on DB venue presence (tier1).
				// The spread % requires live Cauldron price (tier3).
				arbitrage: (() => {
					const cauldronListed = venueByName.cauldron.tvlSats != null;
					const fexListed = venueByName.fex.tvlSats != null;
					const tapswapFtOffer = tapswapRes.rows.find(
						(o) => o.has_commitment == null && o.has_amount && o.want_amount == null && Number(o.want_sats) > 0
					);
					const tapswapHasPrice = !!tapswapFtOffer;
					const venuesPresent = (cauldronListed ? 1 : 0) + (fexListed ? 1 : 0) + (tapswapHasPrice ? 1 : 0);
					// Spread % computed later when tier3 resolves with live Cauldron price
					return {
						eligible: venuesPresent >= 2,
						venuesPresent,
						rawSpreadPct: null as number | null
					};
				})()
			};
		}
	);

	// ─── TIER 2 DEFERRED: price chart + TVL/holders rank ──────────────────
	// tvlRank/holdersRank are also exposed as separate top-level deferred
	// values so the template can {$await} them independently in the badges
	// section without resolving the full tier2 (price chart data).
	const tvlRankPromise = tvlRankRes.then((res) => {
		const raw = res.rows[0]?.rank ? Number(res.rows[0].rank) : null;
		return raw != null && raw >= 1 && raw <= 10 ? raw : null;
	});
	const holdersRankPromise = holdersRankRes.then((res) => {
		const raw = res.rows[0]?.rank ? Number(res.rows[0].rank) : null;
		return raw != null && raw >= 1 && raw <= 10 ? raw : null;
	});
	const tier2Promise = Promise.all([
		priceHistoryRes,
		tvlRankRes,
		holdersRankRes
	]).then(([priceHistoryRes]) => {
		const priceBuckets = priceHistoryRes.rows.map((r) => ({
			ts: Math.floor(r.bucket.getTime() / 1000),
			priceSats: r.avg_price_sats,
			volumeSats: r.volume_sats ? Number(r.volume_sats) : null
		}));
		return {
			priceChart: {
				range,
				rangeLabel: rangeSpec.label,
				buckets: priceBuckets
			}
		};
	});

	// ─── TIER 3 DEFERRED: external API results ───────────────────────────
	// Split into two independent deferreds so the price hero (Cauldron) does
	// NOT wait on the BCMR eligibility check. The eligibility check runs a
	// cold BlockBook authchain walk (500ms–10s); previously it was bundled
	// with Cauldron in one Promise.all, which gated the price display behind
	// that walk for signed-in users. Now Cauldron resolves the hero the moment
	// it returns, and the publish CTA streams in separately when the walk ends.
	const tier3Promise = cauldronPromise.then((cauldron) => ({
		priceUSD: cauldron.priceUSD,
		tvlUSD: cauldron.tvlUSD
	}));

	const canPublishBcmrPromise = bcmrEligibilityPromise;

	// ─── RETURN ──────────────────────────────────────────────────────────
	// Token + BCMR are synchronous (initial HTML stream). Tier1/2/3 are
	// raw Promises — SvelteKit's data_serializer.js detects thenables
	// automatically and serializes them as deferred IDs, streaming their
	// resolved values as chunks to the client.
	return {
		token,
		bcmr: bcmrData,
		bchPriceUSD,
		tier1: tier1Promise,
		tier2: tier2Promise,
		tier3: tier3Promise,
		canPublishBcmr: canPublishBcmrPromise,
		tvlRank: tvlRankPromise,
		holdersRank: holdersRankPromise
	};
};
