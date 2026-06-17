// POST /api/bcmr/sessions/[id]/broadcast
//
// Body: { signedTxHex: string }
//
// Validates the signed hex shape, forwards to BCHN's
// sendrawtransaction, persists publish_txid + signed_tx_hex onto the
// session, transitions state from drafting → broadcast.
//
// Rate-limiting mirrors /api/mint/broadcast: per-cashaddr cooldown
// (1/min) + per-IP cap (5/min). The publish flow is one-shot per
// category for a given session, but a wallet that flips between
// publishing and updating multiple categories needs reasonable
// headroom.
//
// Preconditions (409 otherwise):
//   - session in 'drafting' state
//   - unsigned_tx_hex present (build-tx complete)
//   - publish_txid NOT already set (append-only)

import { json, error, isHttpError } from '@sveltejs/kit';
import { sendRawTransaction } from '$lib/server/bchn';
import { clientIp } from '$lib/server/clientIp';
import { createRateLimiter } from '$lib/server/rateLimit';
import { getSession, updateSession } from '$lib/server/bcmrPublishSessions';
import { query } from '$lib/server/db';
import type { RequestHandler } from './$types';

/**
 * Tell the indexer the authchain just advanced: update the cached head
 * and backdate token_metadata.fetched_at so the next hourly
 * sync-bcmr-onchain run re-walks this category immediately instead of
 * waiting out the 72h staleness window. Best-effort — the walker
 * self-heals on its own schedule if this fails.
 */
async function nudgeBcmrIndexer(categoryHex: string, newHeadTxid: string): Promise<void> {
	try {
		await query(
			`UPDATE tokens SET authchain_head_txid = decode($1, 'hex')
			  WHERE encode(category, 'hex') = $2`,
			[newHeadTxid, categoryHex]
		);
		await query(
			`UPDATE token_metadata SET fetched_at = now() - interval '10 years'
			  WHERE encode(category, 'hex') = $1`,
			[categoryHex]
		);
	} catch (err) {
		console.error('[api/bcmr/broadcast] indexer nudge failed (walker will self-heal):', err);
	}
}

// Per-cashaddr cooldown: in-memory module-scope Map. Stored across
// requests but not across restarts (a restart is itself a 1-minute
// outage — equivalent to clearing).
//
// SCALING NOTE: same per-process Map limitation as mint/broadcast.
// In multi-process deployments, each process has an independent Map;
// migrate to a shared store (Redis or DB advisory lock) when scaling.
const recentBroadcasts = new Map<string, number>();
const BROADCAST_COOLDOWN_MS = 60_000;


// Periodic pruner: clean up stale entries so the Map doesn't grow unboundedly
// over the process lifetime. Runs every 30 min; entries older than 2× the
// cooldown window are deleted. `.unref()` so it doesn't keep the event loop
// alive at shutdown.
const BCMR_BC_PRUNE_KEY = Symbol.for('tokenstork.bcmrBroadcastCooldownPruner');
type BcmrBcPrunerGlobal = typeof globalThis & { [BCMR_BC_PRUNE_KEY]?: NodeJS.Timeout };
{
	const g = globalThis as BcmrBcPrunerGlobal;
	if (g[BCMR_BC_PRUNE_KEY]) clearInterval(g[BCMR_BC_PRUNE_KEY]);
	const handle: NodeJS.Timeout = setInterval(() => {
		const cutoff = Date.now() - BROADCAST_COOLDOWN_MS * 2;
		for (const [key, ts] of recentBroadcasts) {
			if (ts <= cutoff) recentBroadcasts.delete(key);
		}
	}, 30 * 60 * 1000);
	handle.unref?.();
	g[BCMR_BC_PRUNE_KEY] = handle;
}
const bcmrBroadcastIpLimiter = createRateLimiter({
	maxPerWindow: 5,
	windowMs: 60_000
});

export const POST: RequestHandler = async ({ locals, request, params, getClientAddress }) => {
	if (!locals.user) error(401, 'Wallet sign-in required');
	const sessionId = params.id!;
	const cashaddr = locals.user.cashaddr;

	// Cooldown check first (cheap in-memory) so a blocked retry doesn't
	// burn IP-limiter quota. Same defensive ordering as mint/broadcast.
	const last = recentBroadcasts.get(cashaddr);
	if (last !== undefined && Date.now() - last < BROADCAST_COOLDOWN_MS) {
		const remaining = Math.ceil((BROADCAST_COOLDOWN_MS - (Date.now() - last)) / 1000);
		error(429, `Please wait ${remaining}s before broadcasting another publish tx`);
	}

	const ip = clientIp({ request, getClientAddress });
	const ipRl = bcmrBroadcastIpLimiter.consume(ip);
	if (!ipRl.allowed) {
		const retryAfter = Math.ceil((ipRl.retryAfterMs ?? 0) / 1000);
		error(429, `Too many broadcasts from this address; try again in ${retryAfter}s`);
	}

	// Session preconditions.
	const session = await getSession(cashaddr, sessionId);
	if (!session) error(404, 'Session not found');
	if (session.publishTxidHex) {
		// Already broadcast. Return the existing txid for idempotency —
		// matches the same-shape response so the wizard can advance
		// without flagging a "double broadcast" warning.
		return json({ txid: session.publishTxidHex, alreadyBroadcast: true, session });
	}
	if (session.state !== 'drafting' && session.state !== 'signed') {
		error(
			409,
			`Session is in state '${session.state}'; only drafting/signed sessions can be broadcast`
		);
	}
	if (!session.unsignedTxHex) error(409, 'Build tx first (step 5 build-tx)');

	// Parse + validate signed hex.
	let body: { signedTxHex?: unknown };
	try {
		body = (await request.json()) as { signedTxHex?: unknown };
	} catch {
		error(400, 'Body must be JSON');
	}
	const signedHex = body.signedTxHex;
	if (typeof signedHex !== 'string' || signedHex.length === 0) {
		error(400, 'signedTxHex (string) is required');
	}
	if (!/^[0-9a-fA-F]+$/.test(signedHex) || signedHex.length % 2 !== 0) {
		error(400, 'signedTxHex must be even-length hex');
	}
	if (signedHex.length > 200_000) error(400, 'signedTxHex exceeds 100 KB tx size cap');

	// Forward to BCHN. sendRawTransaction already does the 64-char hex
	// validation on the returned txid (added 2026-05-09 review fix).
	let txid: string;
	try {
		txid = await sendRawTransaction(signedHex);
	} catch (err) {
		if (isHttpError(err)) throw err;
		const e = err as Error & { code?: number };
		console.error('[api/bcmr/broadcast] BCHN error:', e.message, 'code=', e.code);
		// Stamp cooldown on failure (otherwise a bad signed hex burns
		// one IP slot per retry and locks out the NAT).
		recentBroadcasts.set(cashaddr, Date.now());
		// The signed tx is dead — discard the cached build so the next
		// "Sign with Wallet" click rebuilds fresh instead of re-signing
		// the same rejected transaction.
		try {
			await updateSession(cashaddr, sessionId, {
				unsignedTxHex: null,
				sourceOutputs: null
			});
		} catch (clearErr) {
			console.error('[api/bcmr/broadcast] failed to clear stale build:', clearErr);
		}
		error(
			400,
			`BCHN rejected: ${e.message ?? 'unknown'} — the draft tx was discarded; click "Sign with Wallet" again to rebuild`
		);
	}

	// Persist. Append-only guard on publish_txid in updateSession means
	// a concurrent broadcast (double-tab race) for the same session
	// can't overwrite — the second call returns null → 409. The
	// canonical txid for a session is write-once.
	let updated: Awaited<ReturnType<typeof updateSession>>;
	try {
		updated = await updateSession(cashaddr, sessionId, {
			state: 'broadcast',
			signedTxHex: signedHex,
			publishTxidHex: txid
		});
	} catch (err) {
		console.error('[api/bcmr/broadcast] persist error:', err);
		error(
			500,
			`Broadcast succeeded (txid=${txid}) but persistence failed. The tx is on chain; the session row is out of sync.`
		);
	}
	if (!updated) {
		// 409 — race or pre-existing publish_txid. Surface the txid we
		// just broadcast so the wizard can record it client-side even
		// if the DB row is stale.
		recentBroadcasts.set(cashaddr, Date.now());
		await nudgeBcmrIndexer(session.categoryHex, txid);
		return json(
			{ txid, alreadyBroadcast: false, persistRace: true },
			{ status: 200 }
		);
	}

	recentBroadcasts.set(cashaddr, Date.now());
	await nudgeBcmrIndexer(session.categoryHex, txid);
	console.info('[api/bcmr/broadcast] success', {
		sessionId,
		txid,
		cashaddr,
		categoryHex: session.categoryHex
	});
	return json({ txid, alreadyBroadcast: false, session: updated });
};
