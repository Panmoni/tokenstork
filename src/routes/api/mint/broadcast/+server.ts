// /api/mint/broadcast
//
// POST { rawHex } → forwards to BCHN's `sendrawtransaction`. Returns
// the resulting txid. Authenticated; rate-limited to one broadcast per
// minute per cashaddr to make a runaway-loop less expensive.
//
// We do NOT verify the rawHex is actually a CashTokens genesis tx —
// the wallet signed it with the user's key, and the user is the one
// asking us to broadcast. If it's malformed, BCHN rejects with an
// RPC error and we surface that to the caller.

import { json, error, isHttpError } from '@sveltejs/kit';
import { sendRawTransaction } from '$lib/server/bchn';
import type { RequestHandler } from './$types';

// Per-cashaddr rate limiter: in-memory Map of last-broadcast timestamps.
// Survives across requests (module-scope) but not across restarts —
// acceptable since a restart is itself a 1-minute outage.
const recentBroadcasts = new Map<string, number>();
const BROADCAST_COOLDOWN_MS = 60_000;

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Wallet sign-in required');

	const last = recentBroadcasts.get(locals.user.cashaddr);
	if (last !== undefined && Date.now() - last < BROADCAST_COOLDOWN_MS) {
		const remaining = Math.ceil((BROADCAST_COOLDOWN_MS - (Date.now() - last)) / 1000);
		error(429, `Please wait ${remaining}s before broadcasting another tx`);
	}

	let body: { rawHex?: unknown };
	try {
		body = (await request.json()) as { rawHex?: unknown };
	} catch {
		error(400, 'Body must be JSON');
	}
	const rawHex = body.rawHex;
	if (typeof rawHex !== 'string' || rawHex.length === 0) {
		error(400, 'rawHex (string) is required');
	}
	if (!/^[0-9a-fA-F]+$/.test(rawHex) || rawHex.length % 2 !== 0) {
		error(400, 'rawHex must be even-length hex');
	}
	// 100 KB consensus tx-size cap; allow up to 200 KB hex (= 100 KB
	// bytes) here, BCHN will reject over-budget txs anyway.
	if (rawHex.length > 200_000) {
		error(400, 'rawHex exceeds 100 KB tx size cap');
	}

	try {
		const txid = await sendRawTransaction(rawHex);
		recentBroadcasts.set(locals.user.cashaddr, Date.now());
		return json({ txid });
	} catch (err) {
		if (isHttpError(err)) throw err;
		const e = err as Error & { code?: number };
		console.error('[api/mint/broadcast] BCHN error:', e.message, 'code=', e.code);
		// Surface the BCHN error message to the caller — it's already
		// structured ("transaction rejected: bad-txns-inputs-missingorspent")
		// and helpful for debugging the user's signed tx. We just don't
		// surface 500 because the BCHN side is reachable.
		error(400, e.message ?? 'Broadcast failed');
	}
};
