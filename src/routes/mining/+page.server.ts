// /mining — chain-economics dashboard from a miner's perspective.
//
// Builds on the `blocks` table that /blocks already drives. Adds three
// derived signals not surfaced on /blocks:
//   - Miner-pool attribution from coinbase scriptSig text patterns,
//     bucketed across 7d / 30d / all-time windows
//   - Per-day fee-rate proxy: total fees / total bytes
//   - Per-day average miner-take per block (subsidy + fees, ~6.25 BCH
//     today + whatever fees the fee market actually delivers)
//
// All queries hit `blocks` only (no token joins). Fast even at 155k+
// rows because of the time index already in place from the /blocks ship.
//
// Pool attribution lives in a Postgres-side LATERAL CASE expression so
// we don't need to run a separate per-row Rust pass at SSR time. The
// pool list mirrors the workers/src/blocks.rs `KNOWN_POOLS` table —
// keep them in sync; the Rust side is authoritative since the walker
// would normalize attribution at write-time if we ever cached it on the
// row, but for now both sides do the substring match.

import { query } from '$lib/server/db';
import type { PageServerLoad } from './$types';

interface PoolWindowRow {
	pool: string;
	blocks: string;
	fees_sats: string;
	tx_count: string;
}

interface DayBucketRow {
	day: Date;
	blocks: string;
	fees_sats: string;
	tx_count: string;
	bytes: string;
}

export interface MinerPoolStat {
	pool: string;
	blocks: number;
	feesSats: string;
	txCount: number;
}

export interface DayBucket {
	day: string; // YYYY-MM-DD
	blocks: number;
	feesSats: number;
	txCount: number;
	bytes: number;
	feeRateSatsPerByte: number; // derived
}

// Postgres-side pool detection — keep this list in lockstep with
// `workers/src/blocks.rs::KNOWN_POOLS`. Order matters: more-specific
// tags first, generic fallback last.
const POOL_CASE = `
	CASE
		WHEN coinbase_script_sig IS NULL THEN 'Unknown'
		WHEN position(E'/ViaBTC/'::bytea       in coinbase_script_sig) > 0 THEN 'ViaBTC'
		WHEN position(E'/AntPool/'::bytea      in coinbase_script_sig) > 0 THEN 'AntPool'
		WHEN position(E'/F2Pool/'::bytea       in coinbase_script_sig) > 0 THEN 'F2Pool'
		WHEN position(E'/BTC.COM/'::bytea      in coinbase_script_sig) > 0 THEN 'BTC.com'
		WHEN position(E'Foundry USA Pool'::bytea in coinbase_script_sig) > 0 THEN 'Foundry USA'
		WHEN position(E'Mining-Dutch'::bytea   in coinbase_script_sig) > 0 THEN 'Mining-Dutch'
		WHEN position(E'binance/pool'::bytea   in coinbase_script_sig) > 0 THEN 'Binance Pool'
		WHEN position(E'BTC.TOP'::bytea        in coinbase_script_sig) > 0 THEN 'BTC.TOP'
		WHEN position(E'MARA Pool'::bytea      in coinbase_script_sig) > 0 THEN 'Mara Pool'
		WHEN position(E'luxor.tech'::bytea     in coinbase_script_sig) > 0 THEN 'Luxor'
		WHEN position(E'ULTIMUSPOOL'::bytea    in coinbase_script_sig) > 0 THEN 'ULTIMUSPOOL'
		WHEN position(E'SBICrypto.com'::bytea  in coinbase_script_sig) > 0 THEN 'SBI Crypto'
		WHEN position(E'/solo.ckpool.org/'::bytea in coinbase_script_sig) > 0 THEN 'Solo CKPool'
		WHEN position(E'ckpool'::bytea         in coinbase_script_sig) > 0 THEN 'CKPool'
		WHEN position(E'2miners.com'::bytea    in coinbase_script_sig) > 0 THEN '2Miners'
		ELSE 'Unknown'
	END
`;

export const load: PageServerLoad = async () => {
	const [pool7d, pool30d, poolAll, dayBuckets] = await Promise.all([
		query<PoolWindowRow>(
			`SELECT ${POOL_CASE} AS pool,
			        COUNT(*)::text                           AS blocks,
			        COALESCE(SUM(fees_sats), 0)::text        AS fees_sats,
			        COALESCE(SUM(tx_count), 0)::text         AS tx_count
			   FROM blocks
			  WHERE time > now() - INTERVAL '7 days'
			  GROUP BY pool
			  ORDER BY COUNT(*) DESC`
		),
		query<PoolWindowRow>(
			`SELECT ${POOL_CASE} AS pool,
			        COUNT(*)::text                           AS blocks,
			        COALESCE(SUM(fees_sats), 0)::text        AS fees_sats,
			        COALESCE(SUM(tx_count), 0)::text         AS tx_count
			   FROM blocks
			  WHERE time > now() - INTERVAL '30 days'
			  GROUP BY pool
			  ORDER BY COUNT(*) DESC`
		),
		query<PoolWindowRow>(
			`SELECT ${POOL_CASE} AS pool,
			        COUNT(*)::text                           AS blocks,
			        COALESCE(SUM(fees_sats), 0)::text        AS fees_sats,
			        COALESCE(SUM(tx_count), 0)::text         AS tx_count
			   FROM blocks
			  GROUP BY pool
			  ORDER BY COUNT(*) DESC`
		),
		// Daily buckets over the last 30 days for the headline charts.
		query<DayBucketRow>(
			`SELECT date_trunc('day', time)              AS day,
			        COUNT(*)::text                       AS blocks,
			        COALESCE(SUM(fees_sats), 0)::text    AS fees_sats,
			        COALESCE(SUM(tx_count), 0)::text     AS tx_count,
			        COALESCE(SUM(size_bytes), 0)::text   AS bytes
			   FROM blocks
			  WHERE time > now() - INTERVAL '30 days'
			  GROUP BY day
			  ORDER BY day ASC`
		)
	]);

	const toPoolStats = (rows: PoolWindowRow[]): MinerPoolStat[] =>
		rows.map((r) => ({
			pool: r.pool,
			blocks: Number(r.blocks),
			feesSats: r.fees_sats,
			txCount: Number(r.tx_count)
		}));

	const dayBucketsTyped: DayBucket[] = dayBuckets.rows.map((r) => {
		const blocks = Number(r.blocks);
		const feesSats = Number(r.fees_sats);
		const bytes = Number(r.bytes);
		const feeRate = bytes > 0 ? feesSats / bytes : 0;
		return {
			day: r.day.toISOString().slice(0, 10),
			blocks,
			feesSats,
			txCount: Number(r.tx_count),
			bytes,
			feeRateSatsPerByte: feeRate
		};
	});

	return {
		pool7d: toPoolStats(pool7d.rows),
		pool30d: toPoolStats(pool30d.rows),
		poolAll: toPoolStats(poolAll.rows),
		dayBuckets: dayBucketsTyped
	};
};
