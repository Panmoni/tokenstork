// /blocks — per-block economics dashboard.
//
// Surfaces the rows the workers's pass-4 walker writes into the `blocks`
// table: tx count, coinbase output, implied fees, total economic value
// transferred, block size, derived from the verbose getblock response we
// already fetch for the tokens / Tapswap walkers.
//
// Layout: a paginated table (newest first) + a headline strip showing
// 7d / 30d / all-time aggregates and a few sparklines so the page reads
// as "how is the BCH chain itself doing?" not just a wall of numbers.

import { query } from '$lib/server/db';
import type { PageServerLoad } from './$types';

interface BlockRow {
	height: number;
	hash: Buffer;
	time: Date;
	tx_count: number;
	total_output_sats: string; // NUMERIC(30,0) — comes back as string
	coinbase_sats: string; // BIGINT comes back as string from node-postgres
	fees_sats: string;
	subsidy_sats: string;
	size_bytes: number;
}

interface SummaryRow {
	block_count: string;
	min_height: number | null;
	max_height: number | null;
	total_tx_count: string;
	total_fees_sats: string;
	total_economic_sats: string; // sum of total_output_sats over the window
	avg_block_size: string | null; // NUMERIC from AVG()
}

interface DayBucketRow {
	day: Date;
	tx_count: string;
	fees_sats: string;
	economic_sats: string;
	block_count: string;
}

export interface BlocksPageRow {
	height: number;
	hashHex: string;
	time: string; // ISO
	timeUnix: number;
	txCount: number;
	totalOutputSats: string; // raw decimal string for high-precision rendering
	coinbaseSats: string;
	feesSats: string;
	subsidySats: string;
	sizeBytes: number;
}

export interface BlocksSummary {
	blockCount: number;
	minHeight: number | null;
	maxHeight: number | null;
	totalTxCount: number;
	totalFeesSats: string;
	totalEconomicSats: string;
	avgBlockSize: number | null;
}

export interface BlockTimeWindow {
	blocks: number;
	/** Average inter-block time in seconds. Null when fewer than 2
	 *  blocks are in the window (no delta to average). */
	avgSeconds: number | null;
}

const PAGE_SIZE = 50;
const MAX_PAGE = 10000; // 500k blocks ceiling — generous; stop pathological pagers

export const load: PageServerLoad = async ({ url, fetch }) => {
	// `?page=N` (1-based) — clamped to a sane window. Clamping rather than
	// erroring on out-of-range values matches the directory page's pattern.
	const pageParam = Number(url.searchParams.get('page'));
	const page = Number.isFinite(pageParam) && pageParam >= 1
		? Math.min(Math.floor(pageParam), MAX_PAGE)
		: 1;
	const offset = (page - 1) * PAGE_SIZE;

	// Run all reads in parallel — they hit the same `blocks` table
	// but use different index slices, so the pool can fan them out.
	const [
		rowsRes,
		summary7dRes,
		summary30dRes,
		summaryAllRes,
		dayBucketsRes,
		blockTimeRes,
		bchPriceRes
	] = await Promise.all([
			query<BlockRow>(
				`SELECT height, hash, time, tx_count, total_output_sats::text,
				        coinbase_sats::text, fees_sats::text, subsidy_sats::text, size_bytes
				   FROM blocks
				  ORDER BY height DESC
				  LIMIT $1 OFFSET $2`,
				[PAGE_SIZE, offset]
			),
			query<SummaryRow>(
				`SELECT COUNT(*)::text AS block_count,
				        MIN(height)    AS min_height,
				        MAX(height)    AS max_height,
				        COALESCE(SUM(tx_count), 0)::text             AS total_tx_count,
				        COALESCE(SUM(fees_sats), 0)::text            AS total_fees_sats,
				        COALESCE(SUM(total_output_sats), 0)::text    AS total_economic_sats,
				        AVG(size_bytes)::text                        AS avg_block_size
				   FROM blocks
				  WHERE time > now() - INTERVAL '7 days'`
			),
			query<SummaryRow>(
				`SELECT COUNT(*)::text AS block_count,
				        MIN(height)    AS min_height,
				        MAX(height)    AS max_height,
				        COALESCE(SUM(tx_count), 0)::text             AS total_tx_count,
				        COALESCE(SUM(fees_sats), 0)::text            AS total_fees_sats,
				        COALESCE(SUM(total_output_sats), 0)::text    AS total_economic_sats,
				        AVG(size_bytes)::text                        AS avg_block_size
				   FROM blocks
				  WHERE time > now() - INTERVAL '30 days'`
			),
			query<SummaryRow>(
				`SELECT COUNT(*)::text AS block_count,
				        MIN(height)    AS min_height,
				        MAX(height)    AS max_height,
				        COALESCE(SUM(tx_count), 0)::text             AS total_tx_count,
				        COALESCE(SUM(fees_sats), 0)::text            AS total_fees_sats,
				        COALESCE(SUM(total_output_sats), 0)::text    AS total_economic_sats,
				        AVG(size_bytes)::text                        AS avg_block_size
				   FROM blocks`
			),
			// Daily buckets — last 30 days. Fed to the sparklines + a future
			// fuller chart card. Use date_trunc('day', time) so the
			// aggregation lines up cleanly with calendar days.
			query<DayBucketRow>(
				`SELECT date_trunc('day', time) AS day,
				        SUM(tx_count)::text             AS tx_count,
				        SUM(fees_sats)::text            AS fees_sats,
				        SUM(total_output_sats)::text    AS economic_sats,
				        COUNT(*)::text                  AS block_count
				   FROM blocks
				  WHERE time > now() - INTERVAL '30 days'
				  GROUP BY day
				  ORDER BY day ASC`
			),
			// Average inter-block time over 24h / 7d / 30d. Computed as
			// (max - min) / (count - 1) per window — equivalent to the
			// arithmetic mean of consecutive deltas. Each window is a
			// separate FILTER clause on the same scan so we get all three
			// in one round-trip. NULLIF guards single-block-window
			// pathologies (count=1 → divide-by-zero).
			query<{
				blocks_24h: string;
				avg_secs_24h: string | null;
				blocks_7d: string;
				avg_secs_7d: string | null;
				blocks_30d: string;
				avg_secs_30d: string | null;
			}>(
				`SELECT
				   COUNT(*) FILTER (WHERE time > now() - INTERVAL '24 hours')::text AS blocks_24h,
				   (EXTRACT(epoch FROM
				       MAX(time) FILTER (WHERE time > now() - INTERVAL '24 hours')
				     - MIN(time) FILTER (WHERE time > now() - INTERVAL '24 hours'))
				    / NULLIF(COUNT(*) FILTER (WHERE time > now() - INTERVAL '24 hours') - 1, 0)
				   )::text AS avg_secs_24h,
				   COUNT(*) FILTER (WHERE time > now() - INTERVAL '7 days')::text AS blocks_7d,
				   (EXTRACT(epoch FROM
				       MAX(time) FILTER (WHERE time > now() - INTERVAL '7 days')
				     - MIN(time) FILTER (WHERE time > now() - INTERVAL '7 days'))
				    / NULLIF(COUNT(*) FILTER (WHERE time > now() - INTERVAL '7 days') - 1, 0)
				   )::text AS avg_secs_7d,
				   COUNT(*) FILTER (WHERE time > now() - INTERVAL '30 days')::text AS blocks_30d,
				   (EXTRACT(epoch FROM
				       MAX(time) FILTER (WHERE time > now() - INTERVAL '30 days')
				     - MIN(time) FILTER (WHERE time > now() - INTERVAL '30 days'))
				    / NULLIF(COUNT(*) FILTER (WHERE time > now() - INTERVAL '30 days') - 1, 0)
				   )::text AS avg_secs_30d
				 FROM blocks`
			),
			fetchBchPrice(fetch)
		]);

	const rows: BlocksPageRow[] = rowsRes.rows.map((r) => ({
		height: r.height,
		hashHex: r.hash.toString('hex'),
		time: r.time.toISOString(),
		timeUnix: Math.floor(r.time.getTime() / 1000),
		txCount: r.tx_count,
		totalOutputSats: r.total_output_sats,
		coinbaseSats: r.coinbase_sats,
		feesSats: r.fees_sats,
		subsidySats: r.subsidy_sats,
		sizeBytes: r.size_bytes
	}));

	const toSummary = (r: SummaryRow): BlocksSummary => ({
		blockCount: Number(r.block_count),
		minHeight: r.min_height,
		maxHeight: r.max_height,
		totalTxCount: Number(r.total_tx_count),
		totalFeesSats: r.total_fees_sats,
		totalEconomicSats: r.total_economic_sats,
		avgBlockSize: r.avg_block_size !== null ? Math.round(Number(r.avg_block_size)) : null
	});

	// Day buckets → sparkline-ready arrays (oldest-first to match
	// Sparkline.svelte's contract). Numbers fit JS doubles for tx_count
	// (a busy day is ~250k txs); fees + economic are big enough that we
	// keep them as plain numbers only for the visual sparkline (precision
	// loss is irrelevant when the polyline rasters to 96px wide).
	const dayBuckets = dayBucketsRes.rows.map((d) => ({
		day: d.day.toISOString().slice(0, 10),
		txCount: Number(d.tx_count),
		feesSats: Number(d.fees_sats),
		economicSats: Number(d.economic_sats),
		blockCount: Number(d.block_count)
	}));

	const bt = blockTimeRes.rows[0];
	const blockTime: {
		w24h: BlockTimeWindow;
		w7d: BlockTimeWindow;
		w30d: BlockTimeWindow;
	} = {
		w24h: {
			blocks: Number(bt?.blocks_24h ?? 0),
			avgSeconds: bt?.avg_secs_24h ? Number(bt.avg_secs_24h) : null
		},
		w7d: {
			blocks: Number(bt?.blocks_7d ?? 0),
			avgSeconds: bt?.avg_secs_7d ? Number(bt.avg_secs_7d) : null
		},
		w30d: {
			blocks: Number(bt?.blocks_30d ?? 0),
			avgSeconds: bt?.avg_secs_30d ? Number(bt.avg_secs_30d) : null
		}
	};

	return {
		rows,
		page,
		pageSize: PAGE_SIZE,
		summary7d: toSummary(summary7dRes.rows[0]),
		summary30d: toSummary(summary30dRes.rows[0]),
		summaryAll: toSummary(summaryAllRes.rows[0]),
		dayBuckets,
		blockTime,
		bchPriceUSD: bchPriceRes
	};
};

async function fetchBchPrice(fetch: typeof globalThis.fetch): Promise<number> {
	try {
		const res = await fetch('/api/bchPrice', { signal: AbortSignal.timeout(4000) });
		const data = await res.json();
		return typeof data?.USD === 'number' ? data.USD : 0;
	} catch {
		return 0;
	}
}
