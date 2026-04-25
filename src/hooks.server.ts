// SvelteKit server hooks.
//
// Today: single concern — read the session cookie on every request, look
// up the active session, and attach `event.locals.user` so loaders +
// endpoints can render logged-in state without re-querying.
//
// The session lookup is one Postgres roundtrip per authenticated request.
// Worth it for now because the directory is hot-cached at the venue/price
// level, not the per-user level — auth is the rare slow path. If that
// changes (e.g., logged-in personalization spreads), revisit with a
// signed-cookie or in-memory LRU.

import type { Handle } from '@sveltejs/kit';
import { SESSION_COOKIE_NAME } from '$lib/server/auth';
import { findActiveSession } from '$lib/server/auth-db';

export const handle: Handle = async ({ event, resolve }) => {
	const sessionId = event.cookies.get(SESSION_COOKIE_NAME);
	if (sessionId) {
		try {
			const session = await findActiveSession(sessionId);
			if (session) {
				event.locals.user = { cashaddr: session.cashaddr };
			} else {
				// Session expired or revoked — clear the stale cookie so
				// the browser stops sending it.
				event.cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
			}
		} catch (err) {
			// DB hiccup during session lookup shouldn't take down the
			// whole request; treat as unauthenticated and continue. The
			// next request retries the lookup.
			console.error('[hooks.server] session lookup failed:', err);
		}
	}
	return resolve(event);
};
