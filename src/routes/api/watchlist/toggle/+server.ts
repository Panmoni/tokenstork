// POST /api/watchlist/toggle — auth-gated. Adds the category to the user's
// watchlist if absent, removes it if present. Returns the post-toggle state.
//
// Body: { category: string }   // 64-char hex of the BCH category
// Returns 200 { inWatchlist: boolean } on success.
//         401 if no authenticated session.
//         400 if the category hex is malformed.
//         404 if the category doesn't exist in `tokens` (FK rejection).

import { error, json } from '@sveltejs/kit';
import { toggleWatchlist, WatchlistCapError, WATCHLIST_MAX_ENTRIES } from '$lib/server/watchlist';
import { createRateLimiter } from '$lib/server/rateLimit';
import type { RequestHandler } from './$types';

const HEX_CATEGORY_RE = /^[0-9a-fA-F]{64}$/;

// Per-wallet toggle limiter. 30/min covers any realistic UI usage
// (one click per token); blocks scripts that try to mass-toggle the
// directory. Per-IP would be wrong here — the watchlist is per-wallet
// anyway and the auth gate already requires a verified session.
const watchlistToggleLimiter = createRateLimiter({
	maxPerWindow: 30,
	windowMs: 60_000
});

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, 'sign in required');
	}

	const rl = watchlistToggleLimiter.consume(`wl:${locals.user.cashaddr}`);
	if (!rl.allowed) {
		throw error(
			429,
			`too many watchlist changes; try again in ${Math.ceil((rl.retryAfterMs ?? 0) / 1000)}s`
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
	const cat = (body as { category?: unknown }).category;
	if (typeof cat !== 'string' || !HEX_CATEGORY_RE.test(cat)) {
		throw error(400, 'category must be a 64-char hex string');
	}

	const categoryBytes = Buffer.from(cat.toLowerCase(), 'hex');
	try {
		const result = await toggleWatchlist(locals.user.cashaddr, categoryBytes);
		return json(result);
	} catch (err) {
		if (err instanceof WatchlistCapError) {
			throw error(
				409,
				`watchlist is full (${WATCHLIST_MAX_ENTRIES} entries); remove one first`
			);
		}
		// Most likely cause of an error here is the FK violation when the
		// category doesn't exist in `tokens`. Return 404 rather than 500
		// so the client can render a sensible message.
		if (err && typeof err === 'object' && 'code' in err && err.code === '23503') {
			throw error(404, 'unknown token category');
		}
		throw err;
	}
};
