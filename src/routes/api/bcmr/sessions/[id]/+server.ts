// /api/bcmr/sessions/[id]
//
// GET    → fetch one session (cashaddr-scoped)
// PATCH  → mutate fields. Wizard PATCHes on each step transition so a
//          refresh resumes where the user left off.
// DELETE → hard delete (operator-style escape hatch — wizard should
//          usually prefer PATCH state='abandoned').

import { json, error, isHttpError } from '@sveltejs/kit';
import {
	getSession,
	updateSession,
	deleteSession,
	type BcmrPublishSessionPatch,
	type BcmrPublishState
} from '$lib/server/bcmrPublishSessions';
import type { RequestHandler } from './$types';

// Field caps mirror the mint wizard's #28 server-side validator
// (src/routes/api/mint/sessions/[id]/+server.ts), so a publication-flow
// PATCH can't land out-of-spec values via a hand-crafted request that
// bypasses the wizard UI.
const MAX_NAME_LEN = 80;
const MAX_TICKER_LEN = 12;
const MAX_DESCRIPTION_LEN = 500;
const MAX_DECIMALS = 8;
const MAX_ICON_URI_LEN = 1024;
const MAX_PUBLICATION_URI_LEN = 2048;
const MAX_TX_HEX_LEN = 200_000; // 100 KB tx-size cap, same as airdrop broadcast endpoint
const ALLOWED_STATES: BcmrPublishState[] = [
	'drafting',
	'signed',
	'broadcast',
	'confirmed',
	'failed',
	'abandoned'
];

function validatedPatch(body: unknown): BcmrPublishSessionPatch {
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		error(400, 'Body must be a JSON object');
	}
	const b = body as Record<string, unknown>;
	const out: BcmrPublishSessionPatch = {};

	if ('state' in b && b.state !== undefined) {
		if (b.state === null) error(400, 'state cannot be null');
		if (typeof b.state !== 'string' || !ALLOWED_STATES.includes(b.state as BcmrPublishState)) {
			error(400, `state must be one of ${ALLOWED_STATES.join(', ')}`);
		}
		out.state = b.state as BcmrPublishState;
	}
	if ('name' in b) out.name = nullableString(b.name, 'name', MAX_NAME_LEN);
	if ('ticker' in b) out.ticker = nullableString(b.ticker, 'ticker', MAX_TICKER_LEN);
	if ('description' in b) {
		out.description = nullableString(b.description, 'description', MAX_DESCRIPTION_LEN);
	}
	if ('decimals' in b) {
		if (b.decimals === null) {
			out.decimals = null;
		} else if (
			typeof b.decimals !== 'number' ||
			!Number.isInteger(b.decimals) ||
			b.decimals < 0 ||
			b.decimals > MAX_DECIMALS
		) {
			error(400, `decimals must be an integer in [0, ${MAX_DECIMALS}]`);
		} else {
			out.decimals = b.decimals;
		}
	}
	if ('iconUri' in b) out.iconUri = nullableString(b.iconUri, 'iconUri', MAX_ICON_URI_LEN);
	if ('bcmrJson' in b) {
		// JSON object or null — pass through. Canonical form is computed
		// server-side; the wizard should not directly set this via PATCH
		// (it's filled by the /canonicalize endpoint) but we allow null
		// for clearing on state-reset.
		if (b.bcmrJson !== null && (typeof b.bcmrJson !== 'object' || Array.isArray(b.bcmrJson))) {
			error(400, 'bcmrJson must be a JSON object or null');
		}
		out.bcmrJson = b.bcmrJson as unknown;
	}
	if ('contentHashHex' in b) {
		out.contentHashHex = nullableHex(b.contentHashHex, 'contentHashHex', 64, 64);
	}
	if ('publicationUri' in b) {
		out.publicationUri = nullableString(b.publicationUri, 'publicationUri', MAX_PUBLICATION_URI_LEN);
	}
	if ('authchainHeadTxidHex' in b) {
		out.authchainHeadTxidHex = nullableHex(b.authchainHeadTxidHex, 'authchainHeadTxidHex', 64, 64);
	}
	if ('unsignedTxHex' in b) {
		out.unsignedTxHex = nullableHex(b.unsignedTxHex, 'unsignedTxHex', MAX_TX_HEX_LEN);
	}
	if ('signedTxHex' in b) {
		out.signedTxHex = nullableHex(b.signedTxHex, 'signedTxHex', MAX_TX_HEX_LEN);
	}
	if ('publishTxidHex' in b) {
		out.publishTxidHex = nullableHex(b.publishTxidHex, 'publishTxidHex', 64, 64);
	}
	return out;
}

function nullableString(v: unknown, name: string, maxLen: number): string | null {
	if (v === null) return null;
	if (typeof v !== 'string') error(400, `${name} must be a string or null`);
	if (v.length > maxLen) error(400, `${name} exceeds ${maxLen} chars`);
	return v;
}

function nullableHex(
	v: unknown,
	name: string,
	maxLen: number,
	exactLen?: number
): string | null {
	if (v === null) return null;
	if (typeof v !== 'string') error(400, `${name} must be a hex string or null`);
	if (exactLen !== undefined && v.length !== exactLen) {
		error(400, `${name} must be exactly ${exactLen} hex chars`);
	}
	if (v.length > maxLen) error(400, `${name} exceeds ${maxLen} hex chars`);
	if (v !== '' && !/^[0-9a-fA-F]*$/.test(v)) {
		error(400, `${name} must be hex (0-9, a-f)`);
	}
	if (v.length % 2 !== 0) error(400, `${name} must be even-length hex`);
	return v;
}

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Wallet sign-in required');
	try {
		const session = await getSession(locals.user.cashaddr, params.id!);
		if (!session) error(404, 'Session not found');
		return json(session);
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[api/bcmr/sessions/:id GET] error:', err);
		error(500, 'Failed to load session');
	}
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) error(401, 'Wallet sign-in required');
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Body must be JSON');
	}
	const patch = validatedPatch(body);
	try {
		const updated = await updateSession(locals.user.cashaddr, params.id!, patch);
		if (!updated) {
			// Either the session doesn't exist OR the state-machine guard /
			// immutability guard rejected the write. Same 404 from the API
			// caller's perspective so we don't leak which.
			error(404, 'Session not found or write not allowed');
		}
		return json(updated);
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[api/bcmr/sessions/:id PATCH] error:', err);
		error(500, 'Failed to update session');
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Wallet sign-in required');
	try {
		const ok = await deleteSession(locals.user.cashaddr, params.id!);
		if (!ok) error(404, 'Session not found');
		return new Response(null, { status: 204 });
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[api/bcmr/sessions/:id DELETE] error:', err);
		error(500, 'Failed to delete session');
	}
};
