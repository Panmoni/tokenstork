// Server-only pooled Postgres client for SvelteKit.
// One Pool per process. Requires DATABASE_URL in the environment.
// Stays on `pg` (node-postgres) to match the SQL already written in
// pages/api/* — the port is a 1:1 copy rather than a rewrite.

import pg from 'pg';
import { env } from '$env/dynamic/private';

type Pool = pg.Pool;
type PoolClient = pg.PoolClient;
type QueryResult<T extends pg.QueryResultRow = pg.QueryResultRow> = pg.QueryResult<T>;

let _pool: Pool | null = null;

// Pool sizing. Each SSR page can fan out 10+ concurrent queries via
// Promise.all (homepage trigram search + venue laterals + vote
// scores). With max=10 a single stuck query starves every other
// request. 25 keeps the worst-case query path concurrency-safe while
// staying well under typical Postgres max_connections defaults.
const POOL_MAX = Number(env.PG_POOL_MAX ?? 25);

// Hard ceiling on any single statement. Anything legitimately slower
// than 10 s belongs in a worker, not in a request path. Without this,
// a plan regression on the trigram search or a wedged backend can hold
// pool slots indefinitely and tip the entire app over. Override via
// PG_STATEMENT_TIMEOUT_MS for emergencies.
const STATEMENT_TIMEOUT_MS = Number(env.PG_STATEMENT_TIMEOUT_MS ?? 10_000);

export function getPool(): Pool {
	if (_pool) return _pool;

	const url = env.DATABASE_URL;
	if (!url) {
		throw new Error('DATABASE_URL is not set');
	}

	_pool = new pg.Pool({
		connectionString: url,
		max: POOL_MAX,
		idleTimeoutMillis: 30_000,
		connectionTimeoutMillis: 5_000,
		// query_timeout is enforced client-side by node-postgres; pair it
		// with statement_timeout below so the server also kills the
		// query if the client crashed mid-await and never aborted it.
		query_timeout: STATEMENT_TIMEOUT_MS,
		// application_name surfaces in pg_stat_activity / slow-query logs
		// so an operator can attribute a stuck query to this process
		// rather than guess. Leave the default for any worker that
		// imports a different db helper.
		application_name: 'tokenstork-web',
		statement_timeout: STATEMENT_TIMEOUT_MS
	});

	_pool.on('error', (err) => {
		// Avoid logging the full pg error object — it can contain bound
		// parameter values for the query that failed. Code + severity
		// + message are enough for an operator to grep journalctl.
		const e = err as Error & { code?: string; severity?: string };
		console.error(
			`[pg] idle client error: code=${e.code ?? '?'} severity=${e.severity ?? '?'} ${e.message}`
		);
	});

	return _pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
	text: string,
	params?: readonly unknown[]
): Promise<QueryResult<T>> {
	return getPool().query<T>(text, params as unknown[] | undefined);
}

export async function withTransaction<T>(
	fn: (client: PoolClient) => Promise<T>
): Promise<T> {
	const client = await getPool().connect();
	try {
		await client.query('BEGIN');
		const result = await fn(client);
		await client.query('COMMIT');
		return result;
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}

export async function closePool(): Promise<void> {
	if (_pool) {
		await _pool.end();
		_pool = null;
	}
}

// Hex <-> BYTEA helpers. Postgres returns BYTEA as Buffer; we hex-encode at
// the API boundary. Category ids are 32 bytes, commitments up to 40.
//
// Upper bound chosen to comfortably cover commitments (≤ 40 bytes) and
// category ids (32 bytes) without echoing arbitrarily large user input
// into a Buffer allocation. Anything bigger is a caller bug.
const MAX_HEX_LEN = 256;

export function bytesFromHex(hex: string): Buffer {
	if (hex.startsWith('0x')) hex = hex.slice(2);
	if (hex.startsWith('\\x')) hex = hex.slice(2);
	if (hex.length > MAX_HEX_LEN) {
		throw new Error('invalid hex string: exceeds max length');
	}
	if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
		throw new Error('invalid hex string');
	}
	return Buffer.from(hex, 'hex');
}

// Strict 32-byte-category helper. Use this whenever the input is meant to
// be a CashTokens category id — every BYTEA-keyed query downstream
// trusts the byte length, and a stricter gate at the boundary means
// downstream call sites can rely on a known shape.
export function categoryFromHex(hex: string): Buffer {
	const cleaned = hex.startsWith('0x')
		? hex.slice(2)
		: hex.startsWith('\\x')
			? hex.slice(2)
			: hex;
	if (cleaned.length !== 64 || !/^[0-9a-fA-F]+$/.test(cleaned)) {
		throw new Error('invalid category (expected 64 hex chars)');
	}
	return Buffer.from(cleaned.toLowerCase(), 'hex');
}

export function hexFromBytes(
	buf: Buffer | Uint8Array | null | undefined
): string | null {
	if (!buf) return null;
	return Buffer.from(buf).toString('hex');
}
