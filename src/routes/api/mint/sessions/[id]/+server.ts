// /api/mint/sessions/[id]
//
// GET    → fetch one session (scoped to the authenticated user)
// PATCH  → mutate fields. The wizard calls this on each step
//          transition so a refresh resumes where the user left off.
// DELETE → hard delete (operator-style escape hatch — UI should usually
//          prefer PATCH state='abandoned').

import { json, error, isHttpError } from '@sveltejs/kit';
import {
	getSession,
	updateSession,
	deleteSession,
	type MintSessionPatch,
	type MintState,
	type MintTokenType,
	type NftCapability
} from '$lib/server/mintSessions';
import type { RequestHandler } from './$types';

// Mirror of the wizard's client-side checks at +page.svelte:76-104.
// Re-enforced here so a direct PATCH bypassing the wizard can't store
// out-of-spec values. Field-level rather than schema-level so existing
// callers (which patch one or two fields at a time) keep working — every
// validator returns the cleaned value, throws on bad shape via error(400).
const MAX_NAME_LEN = 80;
const MAX_TICKER_LEN = 12;
const MAX_DESCRIPTION_LEN = 500;
const MAX_NFT_COMMITMENT_HEX_LEN = 80; // 40 bytes per CashTokens spec
const MAX_DECIMALS = 8;
const MAX_FT_SUPPLY = 2n ** 63n - 1n;
const ALLOWED_STATES: MintState[] = [
	'drafting',
	'signed',
	'broadcast',
	'confirmed',
	'failed',
	'abandoned'
];
const ALLOWED_TOKEN_TYPES: MintTokenType[] = ['FT', 'NFT', 'FT+NFT'];
const ALLOWED_NFT_CAPABILITIES: NftCapability[] = ['none', 'mutable', 'minting'];

function validatedPatch(body: unknown): MintSessionPatch {
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		error(400, 'Body must be a JSON object');
	}
	const b = body as Record<string, unknown>;
	const out: MintSessionPatch = {};

	if ('state' in b && b.state !== undefined) {
		if (b.state === null) error(400, 'state cannot be null');
		if (typeof b.state !== 'string' || !ALLOWED_STATES.includes(b.state as MintState)) {
			error(400, `state must be one of ${ALLOWED_STATES.join(', ')}`);
		}
		out.state = b.state as MintState;
	}
	if ('tokenType' in b) {
		if (b.tokenType === null) {
			out.tokenType = null;
		} else if (
			typeof b.tokenType !== 'string' ||
			!ALLOWED_TOKEN_TYPES.includes(b.tokenType as MintTokenType)
		) {
			error(400, `tokenType must be one of ${ALLOWED_TOKEN_TYPES.join(', ')}`);
		} else {
			out.tokenType = b.tokenType as MintTokenType;
		}
	}
	if ('ticker' in b) {
		out.ticker = nullableString(b.ticker, 'ticker', MAX_TICKER_LEN);
	}
	if ('name' in b) {
		out.name = nullableString(b.name, 'name', MAX_NAME_LEN);
	}
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
	if ('supply' in b) {
		if (b.supply === null) {
			out.supply = null;
		} else if (typeof b.supply !== 'string') {
			error(400, 'supply must be a base-10 integer string');
		} else {
			let n: bigint;
			try {
				n = BigInt(b.supply);
			} catch {
				error(400, 'supply must be a base-10 integer string');
			}
			if (n < 0n || n > MAX_FT_SUPPLY) {
				error(400, `supply out of range [0, ${MAX_FT_SUPPLY.toString()}]`);
			}
			out.supply = b.supply;
		}
	}
	if ('nftCapability' in b) {
		if (b.nftCapability === null) {
			out.nftCapability = null;
		} else if (
			typeof b.nftCapability !== 'string' ||
			!ALLOWED_NFT_CAPABILITIES.includes(b.nftCapability as NftCapability)
		) {
			error(400, `nftCapability must be one of ${ALLOWED_NFT_CAPABILITIES.join(', ')}`);
		} else {
			out.nftCapability = b.nftCapability as NftCapability;
		}
	}
	if ('nftCommitmentHex' in b) {
		out.nftCommitmentHex = nullableHex(
			b.nftCommitmentHex,
			'nftCommitmentHex',
			MAX_NFT_COMMITMENT_HEX_LEN
		);
	}
	if ('iconStagingPath' in b) {
		// Path-traversal guard. The path is operator-managed today (the
		// wizard never populates it); validating here is defense-in-depth
		// against future writers.
		if (b.iconStagingPath === null) {
			out.iconStagingPath = null;
		} else if (typeof b.iconStagingPath !== 'string' || b.iconStagingPath.length > 256) {
			error(400, 'iconStagingPath must be a string ≤256 chars');
		} else if (b.iconStagingPath.includes('..') || b.iconStagingPath.startsWith('/')) {
			error(400, 'iconStagingPath must be a relative path without ..');
		} else {
			out.iconStagingPath = b.iconStagingPath;
		}
	}
	if ('iconUri' in b) {
		if (b.iconUri === null) {
			out.iconUri = null;
		} else if (typeof b.iconUri !== 'string' || b.iconUri.length > 2048) {
			error(400, 'iconUri must be a string ≤2048 chars');
		} else {
			out.iconUri = b.iconUri;
		}
	}
	if ('outpointTxid' in b) {
		out.outpointTxid = nullableHex(b.outpointTxid, 'outpointTxid', 64, 64);
	}
	if ('outpointSatoshis' in b) {
		if (b.outpointSatoshis === null || b.outpointSatoshis === undefined) {
			out.outpointSatoshis = null;
		} else if (
			typeof b.outpointSatoshis !== 'number' ||
			!Number.isInteger(b.outpointSatoshis) ||
			b.outpointSatoshis < 0
		) {
			error(400, 'outpointSatoshis must be a non-negative integer');
		} else {
			out.outpointSatoshis = b.outpointSatoshis;
		}
	}
	if ('genesisTxidHex' in b) {
		out.genesisTxidHex = nullableHex(b.genesisTxidHex, 'genesisTxidHex', 64, 64);
	}
	if ('categoryHex' in b) {
		out.categoryHex = nullableHex(b.categoryHex, 'categoryHex', 64, 64);
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
		console.error('[api/mint/sessions/:id GET] error:', err);
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
	// Validated whitelist — every patchable field is checked for type,
	// length, and range. Bypassing the wizard with a hand-crafted PATCH
	// can no longer land out-of-spec values (negative supply, decimals
	// > 8, oversize NFT commitment, etc.) in the DB.
	const patch = validatedPatch(body);
	try {
		const updated = await updateSession(locals.user.cashaddr, params.id!, patch);
		if (!updated) {
			// Either the session doesn't exist OR the state-machine guard
			// rejected the transition. Same 404 from the API caller's
			// perspective so we don't leak which.
			error(404, 'Session not found or state transition not allowed');
		}
		return json(updated);
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[api/mint/sessions/:id PATCH] error:', err);
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
		console.error('[api/mint/sessions/:id DELETE] error:', err);
		error(500, 'Failed to delete session');
	}
};
