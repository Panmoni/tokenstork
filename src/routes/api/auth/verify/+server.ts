// POST /api/auth/verify — verify a wallet-signed challenge and issue a session cookie.
//
// Body: { nonce: string, signature: string (base64) }
// Returns 200 { ok: true, cashaddr } on success + sets the session cookie.
// Returns 401 { ok: false, error } on invalid signature / missing challenge /
//   cashaddr-mismatch / replay attempt.
//
// The flow is intentionally fail-closed: every Err path returns the same
// shape so a client can't distinguish "challenge expired" from "wrong
// signature" without trying again. Reduces oracle surface for any future
// brute-force attempt against the recovery primitive.

import { dev } from '$app/environment';
import { error, json } from '@sveltejs/kit';
import { SESSION_COOKIE_NAME, verifySignedMessage } from '$lib/server/auth';
import {
	consumeChallenge,
	createSession,
	findOpenChallenge,
	upsertUser
} from '$lib/server/auth-db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid JSON');
	}
	if (typeof body !== 'object' || body === null) {
		throw error(400, 'expected JSON object body');
	}
	const { nonce, signature } = body as { nonce?: unknown; signature?: unknown };
	if (typeof nonce !== 'string' || typeof signature !== 'string') {
		throw error(400, 'nonce and signature are required strings');
	}

	// Diagnostic logging on every failure path — the response body
	// stays generic to avoid timing/oracle leakage to clients, but the
	// server log gets the specific failure mode so the operator can
	// debug "wallet signed but verification failed" cases via
	// `journalctl -u tokenstork.service`. Logs include enough context
	// (truncated nonce, expected vs recovered cashaddr, libauth error
	// detail, signature-byte preview) to identify wallet quirks
	// without dumping the whole signature.
	const sigPreview =
		signature.length > 24 ? `${signature.slice(0, 12)}…${signature.slice(-8)}` : signature;
	const noncePreview = `${nonce.slice(0, 8)}…`;

	const challenge = await findOpenChallenge(nonce);
	if (!challenge) {
		console.error('[auth/verify] challenge not found or expired', {
			nonce: noncePreview
		});
		return json({ ok: false, error: 'invalid or expired challenge' }, { status: 401 });
	}

	const verified = verifySignedMessage(challenge.message, signature);
	if (!verified.ok) {
		console.error('[auth/verify] signature decode/recovery failed', {
			nonce: noncePreview,
			challengeCashaddr: challenge.cashaddr,
			signatureLength: signature.length,
			signaturePreview: sigPreview,
			error: verified.error
		});
		return json({ ok: false, error: 'signature verification failed' }, { status: 401 });
	}
	if (verified.cashaddr !== challenge.cashaddr) {
		// The signature was valid for SOME address but not the one the
		// challenge was issued for. Most common cause: the wallet's
		// CAIP-10 advertised account differs from the key it actually
		// signed with.
		console.error('[auth/verify] cashaddr mismatch', {
			nonce: noncePreview,
			expected: challenge.cashaddr,
			recovered: verified.cashaddr,
			signaturePreview: sigPreview
		});
		return json({ ok: false, error: 'signature verification failed' }, { status: 401 });
	}

	// Atomic single-use guard. If another concurrent request already
	// consumed this challenge, refuse — even though the signature was
	// valid, replay protection demands single-use semantics.
	const consumed = await consumeChallenge(nonce);
	if (!consumed) {
		console.error('[auth/verify] consume race (challenge already used)', {
			nonce: noncePreview
		});
		return json({ ok: false, error: 'invalid or expired challenge' }, { status: 401 });
	}

	await upsertUser(verified.cashaddr);

	const userAgent = request.headers.get('user-agent');
	let ip: string | null = null;
	try {
		ip = getClientAddress();
	} catch {
		// SvelteKit throws if it can't determine — record null and move on.
	}
	const session = await createSession({
		cashaddr: verified.cashaddr,
		userAgent,
		ip
	});

	cookies.set(SESSION_COOKIE_NAME, session.id, {
		path: '/',
		httpOnly: true,
		// Secure must be off in dev (no HTTPS); on in production. The dev
		// flag is set by SvelteKit at build time.
		secure: !dev,
		sameSite: 'strict',
		expires: session.expiresAt
	});

	return json({ ok: true, cashaddr: verified.cashaddr });
};
