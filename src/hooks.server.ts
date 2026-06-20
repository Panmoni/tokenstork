// SvelteKit server hooks.
//
// Two concerns today:
//   1. Read the session cookie on every request, look up the active
//      session, and attach `event.locals.user` so loaders + endpoints
//      can render logged-in state without re-querying.
//   2. Enforce a same-origin Origin / Referer check on every
//      state-changing /api/** request. SvelteKit's built-in
//      `csrf.checkOrigin` only blocks cross-site POSTs whose
//      Content-Type is form-encoded / multipart / text-plain — JSON
//      POSTs (which most of /api/** speaks) bypass that gate. This
//      hook closes the gap so a same-site XSS sink anywhere on the
//      origin can't trigger arbitrary mint broadcasts / votes /
//      reports / logouts as the victim.
//
// The session lookup is one Postgres roundtrip per authenticated request.
// The lookup helper now updates `last_used_at` lazily (every 5 min) so
// authenticated reads no longer take a row lock per request — a flood of
// stolen-cookie reads can't tip the pool.

import { error, type Handle } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { SESSION_COOKIE_NAME } from '$lib/server/auth';
import { findActiveSession } from '$lib/server/auth-db';

// Origins allowed to make state-changing /api/** calls. Production
// origins are baked in; localhost is permitted only in dev. Operators
// can extend the list via EXTRA_ALLOWED_ORIGINS (comma-separated) for
// staging / per-PR preview hostnames.
const PROD_ALLOWED_ORIGINS = ['https://tokenstork.com', 'https://drop.tokenstork.com'];
const DEV_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://localhost:5173'];
const EXTRA_ORIGINS = (env.EXTRA_ALLOWED_ORIGINS ?? '')
	.split(',')
	.map((s) => s.trim())
	.filter((s) => s.length > 0);
const ALLOWED_ORIGINS = new Set([
	...PROD_ALLOWED_ORIGINS,
	...(dev ? DEV_ALLOWED_ORIGINS : []),
	...EXTRA_ORIGINS
]);

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function originOf(value: string | null): string | null {
	if (!value) return null;
	try {
		const u = new URL(value);
		return `${u.protocol}//${u.host}`;
	} catch {
		return null;
	}
}

/** Returns true when the request's Origin / Referer header indicates
 *  it was issued from one of the allowed origins (or from this site
 *  itself). Returns false on any header that fails to parse / is
 *  missing — fail-closed for state-changing requests. */
function isSameSiteOrAllowed(request: Request, selfOrigin: string): boolean {
	const origin = request.headers.get('origin');
	if (origin === 'null') {
		// Browsers send `Origin: null` for sandboxed iframes / file://
		// origins. Block — there's no legitimate API caller in that mode.
		return false;
	}
	if (origin) {
		return origin === selfOrigin || ALLOWED_ORIGINS.has(origin);
	}
	// No Origin header — fall back to Referer. Some legacy clients omit
	// Origin on same-origin POSTs; Referer is checked the same way.
	const refOrigin = originOf(request.headers.get('referer'));
	if (refOrigin) {
		return refOrigin === selfOrigin || ALLOWED_ORIGINS.has(refOrigin);
	}
	return false;
}

export const handle: Handle = async ({ event, resolve }) => {
	// CSRF / origin gate for state-changing /api/** calls. Runs BEFORE
	// session lookup so an attacker can't even reach the cookie-reading
	// path with a cross-site request.
	if (
		STATE_CHANGING_METHODS.has(event.request.method) &&
		event.url.pathname.startsWith('/api/')
	) {
		const selfOrigin = `${event.url.protocol}//${event.url.host}`;
		if (!isSameSiteOrAllowed(event.request, selfOrigin)) {
			throw error(403, 'cross-origin request blocked');
		}
	}

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
			const e = err as Error & { code?: string };
			console.error(
				`[hooks.server] session lookup failed: code=${e.code ?? '?'} ${e.message}`
			);
		}
	}
	const response = await resolve(event);
	applyEdgeCacheHeaders(event, response);
	return response;
};

// Route prefixes that must NEVER be edge-cached: auth, admin, and the
// stateful wizards / per-user surfaces. Matched on segment boundaries so
// `/mint` does NOT also denylist `/mints` (a public read page).
const NO_CACHE_PREFIXES = ['/login', '/admin', '/watchlist', '/mint', '/publish-bcmr', '/api'];

function isCacheableRoute(pathname: string): boolean {
	for (const prefix of NO_CACHE_PREFIXES) {
		if (pathname === prefix || pathname.startsWith(prefix + '/')) return false;
	}
	return true;
}

/**
 * Tier 4 — anonymous page micro-caching at the edge.
 *
 * For ANONYMOUS, GET, 200, text/html responses on public read routes, mark
 * the document publicly cacheable for a short window with a long stale-
 * while-revalidate tail. This lets Cloudflare serve the static shell +
 * skeleton from the edge near-instantly while the live grid hydrates
 * client-side (see +page.svelte). `max-age=0` keeps browsers revalidating
 * (so a shared browser never holds a stale page); only the shared CDN
 * caches, via `s-maxage`.
 *
 * Safety:
 *  - Gated on `!event.locals.user`, so a logged-in user's personalized
 *    HTML (watchlist stars, vote state) is NEVER marked public.
 *  - Skipped when a header already set cache-control (don't clobber the
 *    /api endpoints' own directives) or when the response sets a cookie.
 *  - text/html gate excludes /api JSON and SvelteKit `__data.json`
 *    revalidation payloads, so client polling always reaches fresh origin
 *    data (which itself hits the in-process SWR memo).
 *
 * INERT until the Cloudflare side is configured — CF does not cache HTML
 * by default regardless of these headers. The companion Cache Rules
 * ("Cache Everything" for HTML + "Bypass cache when the session cookie is
 * present") are documented in docs/caching.md.
 */
function applyEdgeCacheHeaders(event: Parameters<Handle>[0]['event'], response: Response): void {
	if (event.request.method !== 'GET') return;
	if (event.locals.user) return;
	if (response.status !== 200) return;
	if (response.headers.has('cache-control')) return;
	if (response.headers.has('set-cookie')) return;
	const contentType = response.headers.get('content-type') ?? '';
	if (!contentType.includes('text/html')) return;
	if (!isCacheableRoute(event.url.pathname)) return;

	response.headers.set('cache-control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=300');
}
