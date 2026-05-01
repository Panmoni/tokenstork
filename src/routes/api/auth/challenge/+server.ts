// POST /api/auth/challenge — issue a wallet-signed-message challenge.
//
// Body: { cashaddr: string }
// Returns 200 { nonce, message, expiresAt } on success.
// Returns 400 with { error } if the cashaddr is malformed.
//
// The returned `message` is the exact text the user must sign in their
// wallet — the client MUST NOT modify it. The returned `nonce` is what
// /api/auth/verify will look the challenge up by.

import { error, json } from '@sveltejs/kit';
import { normalizeCashaddr } from '$lib/server/auth';
import { persistChallenge } from '$lib/server/auth-db';
import { challengeRateLimiter } from '$lib/server/rateLimit';
import { clientIp } from '$lib/server/clientIp';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	// Per-IP rate limiting — anti-bot. Without it, a script can spam
	// challenges and fill the auth_challenges table with unused rows.
	// 10/min/IP is generous for human retry; tight enough to deny abuse.
	//
	// `clientIp` only honors forwarded-for headers when
	// TRUST_PROXY_HEADERS=true AND the immediate peer IP is in the
	// trusted-proxy CIDR allowlist. Otherwise it falls back to the
	// socket peer address — so any direct hit to the origin can't
	// spoof a per-IP bucket.
	const ip = clientIp({ request, getClientAddress });
	const rl = challengeRateLimiter.consume(ip);
	if (!rl.allowed) {
		const retryAfterSec = Math.ceil((rl.retryAfterMs ?? 0) / 1000);
		return new Response(
			JSON.stringify({
				message: 'rate limit exceeded; try again shortly',
				retryAfterSec
			}),
			{
				status: 429,
				headers: {
					'content-type': 'application/json',
					'retry-after': String(retryAfterSec)
				}
			}
		);
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid JSON');
	}
	if (typeof body !== 'object' || body === null) {
		throw error(400, 'expected JSON object body');
	}
	const cashaddrInput = (body as { cashaddr?: unknown }).cashaddr;
	if (typeof cashaddrInput !== 'string') {
		throw error(400, 'cashaddr is required');
	}
	const cashaddr = normalizeCashaddr(cashaddrInput);
	if (cashaddr === null) {
		throw error(
			400,
			'cashaddr must be a mainnet P2PKH address (bitcoincash:q…)'
		);
	}

	const challenge = await persistChallenge(cashaddr, ip === 'unknown' ? null : ip);
	return json({
		nonce: challenge.nonce,
		message: challenge.message,
		expiresAt: challenge.expiresAt.toISOString()
	});
};
