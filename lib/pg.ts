// @/lib/pg.ts
// Pooled Postgres client. One Pool per process.
// Requires DATABASE_URL in the environment.

import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (_pool) return _pool;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }

  _pool = new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  _pool.on("error", (err) => {
    // Unexpected idle-client error. Log; the pool will recover on next checkout.
    console.error("[pg] idle client error:", err);
  });

  return _pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: readonly unknown[]
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params as unknown[] | undefined);
}

// Helper for running multiple statements inside a single transaction.
// Rolls back on any thrown error; commits otherwise.
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Graceful shutdown for long-running workers.
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

// Hex <-> BYTEA helpers. Postgres returns BYTEA as Buffer; we hex-encode at
// the API boundary. Category ids are 32 bytes, commitments are up to 40 bytes.
export function bytesFromHex(hex: string): Buffer {
  if (hex.startsWith("0x")) hex = hex.slice(2);
  if (hex.startsWith("\\x")) hex = hex.slice(2);
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error(`invalid hex string: ${hex.slice(0, 16)}…`);
  }
  return Buffer.from(hex, "hex");
}

export function hexFromBytes(buf: Buffer | Uint8Array | null | undefined): string | null {
  if (!buf) return null;
  return Buffer.from(buf).toString("hex");
}
