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

	const challenge = await findOpenChallenge(nonce);
	if (!challenge) {
		// Either expired, already-consumed, or never existed. Generic
		// failure message so clients can't tell the cases apart.
		return json({ ok: false, error: 'invalid or expired challenge' }, { status: 401 });
	}

	const verified = verifySignedMessage(challenge.message, signature);
	if (!verified.ok) {
		return json({ ok: false, error: 'signature verification failed' }, { status: 401 });
	}
	if (verified.cashaddr !== challenge.cashaddr) {
		// The signature was valid for SOME address but not the one the
		// challenge was issued for. Still 401 — same surface.
		return json({ ok: false, error: 'signature verification failed' }, { status: 401 });
	}

	// Atomic single-use guard. If another concurrent request already
	// consumed this challenge, refuse — even though the signature was
	// valid, replay protection demands single-use semantics.
	const consumed = await consumeChallenge(nonce);
	if (!consumed) {
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
