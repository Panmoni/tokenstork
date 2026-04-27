// /api/mint/sessions
//
// POST → create a new draft session for the authenticated user.
//          Returns the session shape so the wizard can immediately bind
//          its `id` for subsequent PATCHes.
// GET  → list the user's sessions, newest first. Used by the (future)
//          mint-session resume picker.

import { json, error, isHttpError } from '@sveltejs/kit';
import { createSession, listSessions } from '$lib/server/mintSessions';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Wallet sign-in required');
	try {
		const session = await createSession(locals.user.cashaddr);
		return json(session, { status: 201 });
	} catch (err) {
		if (isHttpError(err)) throw err;
		// `tooManyDrafts` thrown by createSession when the per-user
		// MAX_DRAFTING_PER_USER cap is reached — surface as 429 with
		// the user-friendly message rather than 500.
		const e = err as Error & { tooManyDrafts?: boolean };
		if (e.tooManyDrafts) error(429, e.message);
		console.error('[api/mint/sessions POST] error:', err);
		error(500, 'Failed to create session');
	}
};

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Wallet sign-in required');
	try {
		const sessions = await listSessions(locals.user.cashaddr);
		return json({ sessions });
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[api/mint/sessions GET] error:', err);
		error(500, 'Failed to list sessions');
	}
};
