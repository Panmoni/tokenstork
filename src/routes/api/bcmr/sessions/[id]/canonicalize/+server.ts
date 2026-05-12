// POST /api/bcmr/sessions/[id]/canonicalize
//
// Generate the canonical BCMR-v2 envelope JSON from the session's draft
// fields (name, ticker, decimals, description, iconUri, categoryHex,
// tokenType from the linked tokens row), compute sha256, persist both
// onto the session.
//
// Idempotent for a given draft: re-running canonicalize against an
// unchanged draft produces identical bytes and an identical hash.
// Append-only at the DB level — the session's `content_hash` is
// guarded by `IS NULL` in `updateSession` so a retry that produces
// a different hash (because the user edited a field after the first
// canonicalize) will fail; the wizard re-creates the session in that
// case rather than overwriting an already-recorded hash.

import { json, error, isHttpError } from '@sveltejs/kit';
import { getSession, updateSession } from '$lib/server/bcmrPublishSessions';
import { generateBcmr } from '$lib/mint/bcmr';
import { canonicalizeBcmr, contentHashHex } from '$lib/bcmrPublish/canonical';
import { query } from '$lib/server/db';
import type { RequestHandler } from './$types';
import type { TokenType, NftCapability } from '$lib/mint/genesis';

export const POST: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Wallet sign-in required');
	const sessionId = params.id!;

	const session = await getSession(locals.user.cashaddr, sessionId);
	if (!session) error(404, 'Session not found');
	if (session.state !== 'drafting') {
		error(409, `Session is in state '${session.state}'; only drafting sessions can be canonicalized`);
	}

	// All identity fields must be present before canonicalization. The
	// wizard's per-step validators already enforce this client-side; this
	// is the server-side enforcement.
	const missing: string[] = [];
	if (!session.name || !session.name.trim()) missing.push('name');
	if (!session.ticker || !session.ticker.trim()) missing.push('ticker');
	if (session.decimals == null) missing.push('decimals');
	if (missing.length > 0) {
		error(400, `Missing required fields: ${missing.join(', ')}`);
	}

	// Look up token_type from the tokens row so the BCMR JSON correctly
	// surfaces NFT-shape metadata for FT+NFT / NFT categories.
	const tokenTypeRes = await query<{ token_type: string }>(
		`SELECT token_type FROM tokens WHERE encode(category, 'hex') = $1`,
		[session.categoryHex]
	);
	const tokenType = (tokenTypeRes.rows[0]?.token_type ?? 'FT') as TokenType;

	const inputs = {
		categoryHex: session.categoryHex,
		tokenType,
		name: session.name!.trim(),
		ticker: session.ticker!.trim(),
		decimals: session.decimals!,
		description: session.description?.trim() || undefined,
		iconUri: session.iconUri?.trim() || undefined,
		// NFT-specific fields aren't part of the v1 wizard yet — the
		// publication describes the *category-level* identity. Per-NFT
		// commitment registration is a follow-up (#33 future scope).
		nftCommitmentHex: undefined,
		nftCapability: undefined as NftCapability | undefined
	};

	const bcmrJson = generateBcmr(inputs);
	const canonical = canonicalizeBcmr(bcmrJson);
	const hashHex = contentHashHex(canonical);

	// Persist. Append-only guard on content_hash means a retried PATCH
	// with a different hash (because user edited fields after a first
	// canonicalize) returns null — the wizard handles that by surfacing
	// "your draft changed; start fresh" and offering to abandon.
	const updated = await updateSession(locals.user.cashaddr, sessionId, {
		bcmrJson,
		contentHashHex: hashHex
	});
	if (!updated) {
		error(
			409,
			'Session content hash already recorded; abandon this draft and start fresh if you need to change fields.'
		);
	}

	return json({
		bcmrJson,
		canonical, // canonical JSON string (the bytes that get hashed)
		contentHashHex: hashHex,
		session: updated
	});
};
