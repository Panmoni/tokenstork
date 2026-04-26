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
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	// Per-IP rate limiting — anti-bot. Without it, a script can spam
	// challenges and fill the auth_challenges table with unused rows.
	// 10/min/IP is generous for human retry; tight enough to deny abuse.
	//
	// IP source priority (most-trusted first):
	//   1. `cf-connecting-ip` — set by Cloudflare from the real visitor.
	//      We deploy behind CF (orange-cloud), so this is canonical when
	//      present. Spoofing it past CF requires bypassing CF's edge
	//      entirely, which is a different security problem.
	//   2. `getClientAddress()` — adapter-node's resolved address.
	//      Returns the connection IP (i.e., 127.0.0.1 / Caddy) unless
	//      ADDRESS_HEADER env var is configured. Useful for dev (no proxy).
	//   3. 'unknown' sentinel — keeps un-attributable traffic from
	//      bypassing the cap entirely; effectively a global bucket for
	//      mystery callers.
	const cfIp = request.headers.get('cf-connecting-ip');
	let clientIp = cfIp ?? 'unknown';
	if (!cfIp) {
		try {
			clientIp = getClientAddress();
		} catch {
			// fall through to 'unknown'
		}
	}
	const rl = challengeRateLimiter.consume(clientIp);
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

	const challenge = await persistChallenge(cashaddr);
	return json({
		nonce: challenge.nonce,
		message: challenge.message,
		expiresAt: challenge.expiresAt.toISOString()
	});
};
