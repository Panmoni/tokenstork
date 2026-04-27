// Minimal BCHN JSON-RPC client for SvelteKit-side use.
//
// Today it exposes one method: `sendrawtransaction`, used by the mint
// broadcast endpoint. The Rust workers have a much fuller client at
// `workers/src/bchn.rs`; this is the TS-side equivalent for the narrow
// case where the SvelteKit app needs to call BCHN directly (signed-tx
// broadcast from a browser flow).
//
// Env vars: BCHN_RPC_URL (default http://127.0.0.1:8332), BCHN_RPC_AUTH
// (required, format `user:password`).

import { env } from '$env/dynamic/private';

interface RpcSuccess<T> {
	result: T;
	error: null;
	id: number | string;
}
interface RpcFailure {
	result: null;
	error: { code: number; message: string };
	id: number | string;
}
type RpcResponse<T> = RpcSuccess<T> | RpcFailure;

function rpcUrl(): string {
	return env.BCHN_RPC_URL || 'http://127.0.0.1:8332';
}

function rpcAuth(): string {
	const auth = env.BCHN_RPC_AUTH;
	if (!auth) {
		throw new Error('BCHN_RPC_AUTH not set (format: user:password)');
	}
	return Buffer.from(auth).toString('base64');
}

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
	const res = await fetch(rpcUrl(), {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Basic ${rpcAuth()}`
		},
		body: JSON.stringify({
			jsonrpc: '1.0',
			id: 'tokenstork',
			method,
			params
		}),
		// 15s ceiling on the request — sendrawtransaction is fast in the
		// happy path; a hang here usually means BCHN is wedged.
		signal: AbortSignal.timeout(15_000)
	});
	if (!res.ok && res.status !== 500) {
		// Anything OTHER than 500 (which BCHN uses for RPC-level errors
		// with a JSON-shaped body) is something is wrong at the
		// transport layer.
		throw new Error(`BCHN HTTP ${res.status}`);
	}
	const body: RpcResponse<T> = await res.json();
	if (body.error) {
		const err = new Error(`BCHN RPC error ${body.error.code}: ${body.error.message}`);
		// Hoist the RPC code so callers can branch on common cases like
		// -25 (TX rejected) without parsing the message.
		(err as Error & { code: number }).code = body.error.code;
		throw err;
	}
	return body.result as T;
}

/**
 * Broadcast a signed raw transaction. Returns the resulting txid (in
 * UI / big-endian hex).
 *
 * BCHN error codes worth surfacing to the user:
 *   -25 transaction rejected (bad inputs, fee too low, etc.)
 *   -26 transaction already in mempool / blockchain
 *   -27 transaction already known
 *
 * Network errors are thrown unchanged — caller should map to a user
 * friendly message.
 */
export async function sendRawTransaction(rawHex: string): Promise<string> {
	if (!/^[0-9a-fA-F]+$/.test(rawHex)) {
		throw new Error('rawHex must be hex-only');
	}
	if (rawHex.length === 0 || rawHex.length % 2 !== 0) {
		throw new Error('rawHex must be non-empty and even length');
	}
	return await rpcCall<string>('sendrawtransaction', [rawHex]);
}
