// POST /api/auth/logout — invalidate the current session + clear the cookie.
//
// Idempotent: returns 200 whether or not a valid session was present.

import { json } from '@sveltejs/kit';
import { SESSION_COOKIE_NAME } from '$lib/server/auth';
import { deleteSession } from '$lib/server/auth-db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
	const sessionId = cookies.get(SESSION_COOKIE_NAME);
	if (sessionId) {
		await deleteSession(sessionId);
	}
	cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
	return json({ ok: true });
};
