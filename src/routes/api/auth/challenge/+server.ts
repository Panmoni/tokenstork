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
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
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
