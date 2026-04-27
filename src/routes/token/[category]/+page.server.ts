// Per-token detail page. Joins tokens + metadata + state from Postgres,
// then fetches live Cauldron price + TVL and the top-10 holders in
// parallel. BCH price is fetched server-side so market-cap + TVL USD
// don't wait on a client-side /api/bchPrice round-trip.

import { error } from '@sveltejs/kit';
import { query, hexFromBytes, bytesFromHex } from '$lib/server/db';
import { fetchBcmr, fetchCauldron } from '$lib/server/external';
import { computeMcapTvlThresholdSats } from '$lib/server/mcapThreshold';
import type { PageServerLoad } from './$types';
import type { TokenType } from '$lib/types';

const HEX_REGEX = /^[0-9a-fA-F]{64}$/;

interface TokenRow {
	category: Buffer;
	token_type: TokenType;
	genesis_block: number;
	first_seen_at: Date;
	name: string | null;
	symbol: string | null;
	decimals: number | null;
	description: string | null;
	icon_uri: string | null;
	icon_cleared_hash: string | null;
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
			t.first_seen_at,
			m.name,
			m.symbol,
			m.decimals,
			m.description,
			m.icon_uri,
			encode(imo.content_hash, 'hex') AS icon_cleared_hash,
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
		   LEFT JOIN icon_moderation imo
		     ON imo.content_hash = ius.content_hash AND imo.state = 'cleared'
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
		priceHistoryRes
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
		)
	]);

	const decimals = row.decimals ?? bcmr?.decimals ?? 0;
	const cauldron = await fetchCauldron(category, decimals, bchPriceUSD);

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

	return {
		token: {
			id: hexFromBytes(row.category)!,
			tokenType: row.token_type,
			genesisBlock: row.genesis_block,
			firstSeenAt: Math.floor(row.first_seen_at.getTime() / 1000),
			name: row.name ?? bcmr?.name ?? null,
			symbol: row.symbol ?? bcmr?.symbol ?? null,
			decimals,
			description: row.description ?? bcmr?.description ?? null,
			icon: row.icon_uri ?? bcmr?.iconUri ?? null,
			iconClearedHash: row.icon_cleared_hash ?? null,
			currentSupply: row.current_supply,
			liveUtxoCount: row.live_utxo_count,
			liveNftCount: row.live_nft_count,
			holderCount: row.holder_count,
			hasActiveMinting: row.has_active_minting ?? false,
			isFullyBurned: row.is_fully_burned ?? false,
			isVerifiedOnchain: row.verified_at !== null
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
		}
	};
};
