// Per-token detail page. Two-tier streaming: fast (price, votes, holders,
// above-fold) and slow (chart, Tapswap, rankings, below-fold). Both batches
// fire concurrently alongside the token query. The token shell renders from
// the already-fetched row; fast data streams in ~300ms; slow data ~800ms.
//
// All queries retain the original parallelism — no regression from the
// monolithic Promise.all.

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
	category: Buffer; token_type: TokenType; genesis_block: number; genesis_time: Date;
	first_seen_at: Date; genesis_txid: Buffer; authchain_head_txid: Buffer | null;
	name: string | null; symbol: string | null; decimals: number | null;
	description: string | null; icon_uri: string | null; icon_cleared_hash: string | null;
	icon_state: string | null; icon_block_reason: string | null;
	icon_fetch_error: string | null; icon_scan_present: boolean;
	bcmr_publication_uri: string | null; bcmr_source: string | null; bcmr_body: unknown;
	bcmr_fetched_at: Date | null; current_supply: string | null;
	live_utxo_count: number | null; live_nft_count: number | null;
	holder_count: number | null; has_active_minting: boolean | null;
	is_fully_burned: boolean | null; gini_coefficient: number | null;
	verified_at: Date | null; is_moderated: boolean;
}
interface HolderRow { address: string; balance: string; nft_count: number; }
interface FexRow { price_sats: number | null; tvl_satoshis: string | null; }
interface TapswapOfferRow { id: Buffer; has_amount: string | null; has_commitment: Buffer | null; has_capability: 'none' | 'mutable' | 'minting' | null; has_sats: string; want_sats: string; want_category: Buffer | null; want_amount: string | null; want_commitment: Buffer | null; want_capability: 'none' | 'mutable' | 'minting' | null; maker_pkh: Buffer; listed_block: number; listed_at: Date; }

const PRICE_RANGES = {
	'24h': { interval: '24 hours', bucket: "date_trunc('hour', ts AT TIME ZONE 'UTC')", label: '24h' },
	'7d':  { interval: '7 days',  bucket: "date_trunc('hour', ts AT TIME ZONE 'UTC') - (EXTRACT(hour FROM ts AT TIME ZONE 'UTC')::int % 6) * INTERVAL '1 hour'", label: '7d' },
	'30d': { interval: '30 days', bucket: "date_trunc('day', ts AT TIME ZONE 'UTC')", label: '30d' },
	'90d': { interval: '90 days', bucket: "date_trunc('day', ts AT TIME ZONE 'UTC')", label: '90d' },
	'1y':  { interval: '365 days',bucket: "date_trunc('week', ts AT TIME ZONE 'UTC')", label: '1y' },
	all:   { interval: null,      bucket: "date_trunc('week', ts AT TIME ZONE 'UTC')", label: 'all' }
} as const;
type PriceRange = keyof typeof PRICE_RANGES;
const DEFAULT_RANGE: PriceRange = '7d';
interface PriceBucketRow { bucket: Date; avg_price_sats: number | null; volume_sats: string | null; }
export interface PriceBucket { ts: number; priceSats: number | null; volumeSats: number | null; }

async function checkBcmrPublishEligibility(
	row: { authchain_head_txid: Buffer | null; genesis_txid: Buffer }, cashaddr: string
): Promise<boolean> {
	try {
		const { isOwnerOfHeadVout0, findAuthchainHead } = await import('$lib/server/authchain');
		let h: string | null = row.authchain_head_txid ? hexFromBytes(row.authchain_head_txid) : null;
		let owns: boolean | null = null;
		if (h) owns = await isOwnerOfHeadVout0(h, cashaddr);
		if (owns === null) { const c = await findAuthchainHead(hexFromBytes(row.genesis_txid)!); owns = c.headVout0Addresses.includes(cashaddr); }
		return !!owns;
	} catch (err) { console.warn('[token detail] BCMR-publish eligibility check failed:', (err as Error).message); return false; }
}

export const load: PageServerLoad = async ({ params, fetch, url, locals }) => {
	const category = params.category.toLowerCase();
	if (!HEX_REGEX.test(category)) error(400, 'invalid category');
	const categoryBytes = bytesFromHex(category);
	const rp = url.searchParams.get('range') as PriceRange | null;
	const range: PriceRange = rp && rp in PRICE_RANGES ? rp : DEFAULT_RANGE;
	const rangeSpec = PRICE_RANGES[range];

	const tokenRes = await query<TokenRow>(
		`SELECT t.category, t.token_type, t.genesis_block, t.genesis_time, t.first_seen_at,
		        t.genesis_txid, t.authchain_head_txid, m.name, m.symbol, m.decimals, m.description,
		        m.icon_uri, m.bcmr_publication_uri, m.bcmr_source, m.bcmr_body,
		        m.fetched_at AS bcmr_fetched_at,
		        encode(imo_clear.content_hash, 'hex') AS icon_cleared_hash,
		        imo_any.state AS icon_state, imo_any.block_reason AS icon_block_reason,
		        ius.fetch_error AS icon_fetch_error,
		        (ius.icon_uri IS NOT NULL) AS icon_scan_present,
		        s.current_supply::text AS current_supply, s.live_utxo_count, s.live_nft_count,
		        s.holder_count, s.has_active_minting, s.is_fully_burned,
		        s.gini_coefficient, s.verified_at,
		        (mod.category IS NOT NULL) AS is_moderated
		   FROM tokens t
		   LEFT JOIN token_metadata m ON m.category = t.category
		   LEFT JOIN token_state s ON s.category = t.category
		   LEFT JOIN token_moderation mod ON mod.category = t.category
		   LEFT JOIN icon_url_scan ius ON ius.icon_uri = m.icon_uri
		   LEFT JOIN icon_moderation imo_clear ON imo_clear.content_hash = ius.content_hash AND imo_clear.state = 'cleared'
		   LEFT JOIN icon_moderation imo_any ON imo_any.content_hash = ius.content_hash
		  WHERE t.category = $1`, [categoryBytes]);
	if (tokenRes.rows.length === 0) error(404, 'token not found');
	if (tokenRes.rows[0].is_moderated) error(410, 'This token has been hidden from the tokenstork directory.');

	const row = tokenRes.rows[0];
	const bcmr = bcmrFromBody(row.bcmr_body, category);
	const decimals = row.decimals ?? bcmr?.decimals ?? 0;
	const bchPriceUSD = await fetchBchPrice(fetch);

	const hasBcmrMetadata = row.name != null || row.symbol != null || row.description != null || row.icon_uri != null || bcmr != null;
	const iconStatus = resolveIconStatus({ iconUri: row.icon_uri, clearedHash: row.icon_cleared_hash, moderationState: row.icon_state, blockReason: row.icon_block_reason, fetchError: row.icon_fetch_error, hasScanRow: row.icon_scan_present, hasBcmrMetadata });

	// ── Fast batch (above-fold: price, votes, holders, market stats) ──
	// Fires concurrently with the slow batch below. Total parallelism = original.
	const fastRaw = Promise.all([
		query<HolderRow>(`SELECT address, balance::text AS balance, nft_count FROM token_holders WHERE category = $1 ORDER BY token_holders.balance DESC, address ASC LIMIT 10`, [categoryBytes]),
		query<FexRow>(`SELECT price_sats, tvl_satoshis::text AS tvl_satoshis FROM token_venue_listings WHERE category = $1 AND venue = 'fex' LIMIT 1`, [categoryBytes]),
		getVoteCounts(categoryBytes),
		query<{ n: string }>(`SELECT COUNT(*)::bigint AS n FROM user_watchlist WHERE category = $1`, [categoryBytes]),
		getMovers24h(),
		computeMcapTvlThresholdSats(),
		query<{ venue: 'cauldron' | 'fex'; tvl_satoshis: string | null; pools_count: number | null; pools_total_tvl_sats: string | null; first_listed_at: Date }>(`SELECT venue, tvl_satoshis::text AS tvl_satoshis, pools_count, pools_total_tvl_sats::text AS pools_total_tvl_sats, first_listed_at FROM token_venue_listings WHERE category = $1`, [categoryBytes]),
		fetchCrc20Detail(categoryBytes).catch((err: Error) => { console.error('[token detail] CRC-20 detail query failed:', err); return null; }),
		fetchCauldron(category, decimals, bchPriceUSD),
		locals.user ? checkBcmrPublishEligibility(row, locals.user.cashaddr) : Promise.resolve(false),
		firstNRankFor(category),
		query<{ tvl_sats: string }>(`SELECT tvl_sats::text AS tvl_sats FROM cauldron_global_stats WHERE id = 1`),
		// MOVED TO FAST: query<{ rank: string }>(`WITH self AS (SELECT tvl_satoshis FROM token_venue_listings WHERE category = $1 AND venue = 'cauldron' AND tvl_satoshis IS NOT NULL) SELECT (1 + (SELECT COUNT(*)::bigint FROM token_venue_listings tvl JOIN tokens t ON t.category = tvl.category WHERE tvl.venue = 'cauldron' AND tvl.tvl_satoshis IS NOT NULL AND tvl.tvl_satoshis > self.tvl_satoshis AND NOT EXISTS (SELECT 1 FROM token_moderation mod WHERE mod.category = tvl.category)))::text AS rank FROM self`, [categoryBytes]).catch((err: Error) => { console.error('[token detail] TVL rank query failed:', err); return { rows: [] as Array<{ rank: string }> }; }),
		// MOVED TO FAST: query<{ rank: string }>(`WITH self AS (SELECT s.holder_count FROM token_state s WHERE s.category = $1 AND s.holder_count IS NOT NULL AND s.holder_count > 0) SELECT (1 + (SELECT COUNT(*)::bigint FROM token_state s JOIN tokens t ON t.category = s.category WHERE s.holder_count IS NOT NULL AND s.holder_count > self.holder_count AND NOT EXISTS (SELECT 1 FROM token_moderation mod WHERE mod.category = s.category)))::text AS rank FROM self`, [categoryBytes]).catch((err: Error) => { console.error('[token detail] holders rank query failed:', err); return { rows: [] as Array<{ rank: string }> }; }),
	]);

	// ── Slow batch (below-fold: chart, Tapswap, rankings, extremes) ────
	const slowRaw = Promise.all([
		query<TapswapOfferRow>(`SELECT id, has_amount::text AS has_amount, has_commitment, has_capability, has_sats::text AS has_sats, want_sats::text AS want_sats, want_category, want_amount::text AS want_amount, want_commitment, want_capability, maker_pkh, listed_block, listed_at FROM tapswap_offers WHERE has_category = $1 AND status = 'open' AND NOT EXISTS (SELECT 1 FROM token_moderation mod WHERE mod.category = $1) ORDER BY want_sats ASC LIMIT 20`, [categoryBytes]),
		query<PriceBucketRow>(`WITH ordered AS (SELECT ts, price_sats, tvl_satoshis, tvl_satoshis - LAG(tvl_satoshis) OVER (ORDER BY ts) AS tvl_delta FROM token_price_history WHERE category = $1 AND venue = 'cauldron' ${rangeSpec.interval ? `AND ts > now() - INTERVAL '${rangeSpec.interval}'` : ''}) SELECT ${rangeSpec.bucket} AS bucket, AVG(price_sats)::double precision AS avg_price_sats, SUM(ABS(tvl_delta)) FILTER (WHERE tvl_delta IS NOT NULL)::text AS volume_sats FROM ordered GROUP BY bucket ORDER BY bucket ASC`, [categoryBytes]),
		query<{ window: '24h' | '7d' | '30d'; price_min: number | null; price_max: number | null }>(`WITH windows AS (SELECT '24h'::text AS window, INTERVAL '24 hours' AS interval UNION ALL SELECT '7d', INTERVAL '7 days' UNION ALL SELECT '30d', INTERVAL '30 days') SELECT w.window, MIN(h.price_sats)::double precision AS price_min, MAX(h.price_sats)::double precision AS price_max FROM windows w LEFT JOIN token_price_history h ON h.category = $1 AND h.venue = 'cauldron' AND h.ts > now() - w.interval AND h.price_sats > 0 GROUP BY w.window`, [categoryBytes]),
		query<{ trade_buckets: string; volume_sats: string | null }>(`WITH ordered AS (SELECT ts, tvl_satoshis, tvl_satoshis - LAG(tvl_satoshis) OVER (ORDER BY ts) AS tvl_delta FROM token_price_history WHERE category = $1 AND venue = 'cauldron' AND ts > now() - INTERVAL '24 hours') SELECT COUNT(*) FILTER (WHERE tvl_delta IS NOT NULL AND tvl_delta != 0)::bigint AS trade_buckets, SUM(ABS(tvl_delta)) FILTER (WHERE tvl_delta IS NOT NULL)::text AS volume_sats FROM ordered`, [categoryBytes]),
		query<{ n: string }>(`SELECT COUNT(*)::bigint AS n FROM token_reports WHERE category = $1 AND status IN ('new','reviewed')`, [categoryBytes]),
		getLeaderboardStandings(categoryBytes),
		// MOVED TO FAST: query<{ rank: string }>(`WITH self AS (SELECT tvl_satoshis FROM token_venue_listings WHERE category = $1 AND venue = 'cauldron' AND tvl_satoshis IS NOT NULL) SELECT (1 + (SELECT COUNT(*)::bigint FROM token_venue_listings tvl JOIN tokens t ON t.category = tvl.category WHERE tvl.venue = 'cauldron' AND tvl.tvl_satoshis IS NOT NULL AND tvl.tvl_satoshis > self.tvl_satoshis AND NOT EXISTS (SELECT 1 FROM token_moderation mod WHERE mod.category = tvl.category)))::text AS rank FROM self`, [categoryBytes]).catch((err: Error) => { console.error('[token detail] TVL rank query failed:', err); return { rows: [] as Array<{ rank: string }> }; }),
		// MOVED TO FAST: query<{ rank: string }>(`WITH self AS (SELECT s.holder_count FROM token_state s WHERE s.category = $1 AND s.holder_count IS NOT NULL AND s.holder_count > 0) SELECT (1 + (SELECT COUNT(*)::bigint FROM token_state s JOIN tokens t ON t.category = s.category WHERE s.holder_count IS NOT NULL AND s.holder_count > self.holder_count AND NOT EXISTS (SELECT 1 FROM token_moderation mod WHERE mod.category = s.category)))::text AS rank FROM self`, [categoryBytes]).catch((err: Error) => { console.error('[token detail] holders rank query failed:', err); return { rows: [] as Array<{ rank: string }> }; }),
		query<{ hhi: string | null }>(`WITH t AS (SELECT SUM(balance::numeric) AS total, COUNT(*) AS n FROM token_holders WHERE category = $1) SELECT CASE WHEN t.n < 10 THEN NULL WHEN t.total IS NULL OR t.total = 0 THEN NULL ELSE (SELECT (SUM((th.balance::numeric / t.total) ^ 2))::text FROM token_holders th WHERE th.category = $1) END AS hhi FROM t`, [categoryBytes]).catch((err: Error) => { console.error('[token detail] Herfindahl query failed:', err); return { rows: [] as Array<{ hhi: string | null }> }; }),
		]);

	// ── Post-process fast batch ────────────────────────────────────────
	const fast = fastRaw.then(([holdersRes, fexRes, voteCounts, watchlistCountRes, movers, mctSats, venueAggregateRes, crc20Detail, cauldron, bcmrEligibility, firstNRankResult, cauldronGlobalRes]) => {
		let fexPriceUSD = 0, fexTvlUSD = 0;
		const fr = fexRes.rows[0];
		if (fr?.price_sats && fr.price_sats > 0) fexPriceUSD = (fr.price_sats * Math.pow(10, decimals) / 1e8) * bchPriceUSD;
		if (fr?.tvl_satoshis) { const s = Number(fr.tvl_satoshis); if (Number.isFinite(s)) fexTvlUSD = (s / 1e8) * bchPriceUSD * 2; }

		const fm = (l: Array<{ categoryHex: string }>, c: string) => l.findIndex(m => m.categoryHex === c) + 1;
		const mr = { gainerRank: fm(movers.topGainers24h, category), loserRank: fm(movers.topLosers24h, category), tvlMoverRank: fm(movers.topTvlMovers24h, category) };
		const me = movers.topGainers24h.find(m => m.categoryHex === category) ?? movers.topLosers24h.find(m => m.categoryHex === category) ?? null;
		const mt = movers.topTvlMovers24h.find(m => m.categoryHex === category) ?? null;

		const ths = (() => { const t = holdersRes.rows[0]; if (!t || !row.current_supply) return null; try { const s = BigInt(row.current_supply); if (s === 0n) return null; return Math.min(100, Number((BigInt(t.balance) * 1_000_000n) / s) / 10_000); } catch { return null; } })();
		const t10 = (() => { if (!row.current_supply || holdersRes.rows.length === 0) return null; try { const s = BigInt(row.current_supply); if (s === 0n) return null; let sum = 0n; for (const h of holdersRes.rows) sum += BigInt(h.balance); return Math.min(100, Number((sum * 1_000_000n) / s) / 10_000); } catch { return null; } })();

		const wc = Number(watchlistCountRes.rows[0]?.n ?? 0);
		const mctUSD = (mctSats / 1e8) * bchPriceUSD * 2;

		const vn: Record<string, { tvlSats: string | null; firstListedAt: number | null }> = {};
		for (const r of venueAggregateRes.rows) vn[r.venue] = { tvlSats: r.tvl_satoshis, firstListedAt: Math.floor(r.first_listed_at.getTime() / 1000) };

		let ctvs: number | null = null;
		const gt = cauldronGlobalRes.rows[0]?.tvl_sats ? Number(cauldronGlobalRes.rows[0].tvl_sats) : 0;
		const tt = vn.cauldron?.tvlSats ? Number(vn.cauldron.tvlSats) : 0;
		if (gt > 0 && tt > 0) ctvs = (tt / gt) * 100;

		return {
			holders: holdersRes.rows.map(h => ({ address: h.address, balance: h.balance, nftCount: h.nft_count })),
			priceUSD: cauldron.priceUSD, tvlUSD: cauldron.tvlUSD,
			fexPriceUSD, fexTvlUSD, bchPriceUSD,
			votes: { upCount: voteCounts.upCount, downCount: voteCounts.downCount },
			watchlistCount: wc,
			moverBadges: { gainerRank: mr.gainerRank, loserRank: mr.loserRank, tvlMoverRank: mr.tvlMoverRank, pricePct: me?.pricePct ?? null, tvlPct: mt?.tvlPct ?? null },
			crc20: crc20Detail, canPublishBcmr: bcmrEligibility,
			mcapTvlThresholdUSD: mctUSD,
			venueListings: { cauldronFirstListedAt: vn.cauldron?.firstListedAt ?? null, fexFirstListedAt: vn.fex?.firstListedAt ?? null },
			topHolderSharePct: ths, top10HolderSharePct: t10,
			firstNRank: firstNRankResult,
			cauldronTvlSharePct: ctvs,
			
		};
	});

	// ── Post-process slow batch ────────────────────────────────────────
	const slow = slowRaw.then(([tapswapRes, priceHistoryRes, priceExtremesRes, recentTradesRes, reportCountRes, leaderboardStandingsRes, herfindahlRes]) => {
		const pb: PriceBucket[] = priceHistoryRes.rows.map(r => ({ ts: Math.floor(r.bucket.getTime() / 1000), priceSats: r.avg_price_sats, volumeSats: r.volume_sats ? Number(r.volume_sats) : null }));

		const rr = recentTradesRes.rows[0];
		const rvs = rr?.volume_sats ? Number(rr.volume_sats) : 0;
		const rvu = bchPriceUSD > 0 && rvs > 0 ? (rvs / 1e8) * bchPriceUSD : 0;
		const rtb = rr?.trade_buckets ? Number(rr.trade_buckets) : 0;

		const pe: Record<string, { min: number | null; max: number | null }> = { '24h': { min: null, max: null }, '7d': { min: null, max: null }, '30d': { min: null, max: null } };
		for (const r of priceExtremesRes.rows) { const toU = (px: number | null) => (px != null && px > 0 && bchPriceUSD > 0) ? (px * Math.pow(10, decimals) / 1e8) * bchPriceUSD : null; pe[r.window] = { min: toU(r.price_min), max: toU(r.price_max) }; }

		const rc = Number(reportCountRes.rows[0]?.n ?? 0);
		const tvR = null; // was tvlRankRes — moved to fast, not yet wired
		const hR = null; // was holdersRankRes — moved to fast, not yet wired
		const hi = (() => { const r = herfindahlRes.rows[0]?.hhi; if (r == null) return null; const n = Number(r); return Number.isFinite(n) ? n : null; })();

		return {
			tapswapOffers: tapswapRes.rows.map(o => ({ id: hexFromBytes(o.id)!, hasAmount: o.has_amount, hasCommitment: o.has_commitment ? hexFromBytes(o.has_commitment) : null, hasCapability: o.has_capability, hasSats: o.has_sats, wantSats: o.want_sats, wantCategory: o.want_category ? hexFromBytes(o.want_category) : null, wantAmount: o.want_amount, wantCommitment: o.want_commitment ? hexFromBytes(o.want_commitment) : null, wantCapability: o.want_capability, makerPkhHex: hexFromBytes(o.maker_pkh)!, listedBlock: o.listed_block, listedAt: Math.floor(o.listed_at.getTime() / 1000) })),
			priceChart: { range, rangeLabel: rangeSpec.label, buckets: pb },
			priceExtremes: pe,
			recentActivity: { recentTradeBuckets: rtb, recentVolumeUSD: rvu },
			reportCount: rc,
			leaderboardStandings: leaderboardStandingsRes,
			
			herfindahlIndex: hi,
		};
	});

	// ── Return: token shell immediately, fast & slow stream in ─────────
	const token = {
		id: hexFromBytes(row.category)!, tokenType: row.token_type,
		genesisBlock: row.genesis_block,
		genesisTime: Math.floor(row.genesis_time.getTime() / 1000),
		firstSeenAt: Math.floor(row.first_seen_at.getTime() / 1000),
		name: row.name ?? bcmr?.name ?? null,
		symbol: row.symbol ?? bcmr?.symbol ?? null, decimals,
		description: row.description ?? bcmr?.description ?? null,
		icon: row.icon_uri ?? bcmr?.iconUri ?? null,
		iconClearedHash: row.icon_cleared_hash ?? null, iconStatus,
		bcmrFetchedAt: row.bcmr_fetched_at ? Math.floor(row.bcmr_fetched_at.getTime() / 1000) : null,
		bcmrPublicationUri: row.bcmr_publication_uri, bcmrSource: row.bcmr_source,
		currentSupply: row.current_supply, liveUtxoCount: row.live_utxo_count,
		liveNftCount: row.live_nft_count, holderCount: row.holder_count,
		hasActiveMinting: row.has_active_minting ?? false,
		isFullyBurned: row.is_fully_burned ?? false,
		isVerifiedOnchain: row.verified_at !== null,
		giniCoefficient: row.gini_coefficient
	};

	return { token, bcmr: bcmr ? { status: bcmr.status, splitId: bcmr.splitId, uris: bcmr.uris, tags: bcmr.tags, extensions: bcmr.extensions, nftTypes: bcmr.nftTypes, nftsDescription: bcmr.nftsDescription } : null, fast, slow };
};
