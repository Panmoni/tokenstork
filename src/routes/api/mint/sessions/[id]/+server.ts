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
	type MintSessionPatch
} from '$lib/server/mintSessions';
import type { RequestHandler } from './$types';

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
	let body: MintSessionPatch;
	try {
		body = (await request.json()) as MintSessionPatch;
	} catch {
		error(400, 'Body must be JSON');
	}
	// Lightweight whitelist — only known patchable fields make it
	// through. Future field additions need an explicit entry here.
	const patch: MintSessionPatch = {
		state: body.state,
		tokenType: body.tokenType,
		ticker: body.ticker,
		name: body.name,
		description: body.description,
		decimals: body.decimals,
		supply: body.supply,
		nftCapability: body.nftCapability,
		nftCommitmentHex: body.nftCommitmentHex,
		iconStagingPath: body.iconStagingPath,
		genesisTxidHex: body.genesisTxidHex,
		categoryHex: body.categoryHex
	};
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
