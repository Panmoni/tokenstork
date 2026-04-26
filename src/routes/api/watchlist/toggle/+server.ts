// POST /api/watchlist/toggle — auth-gated. Adds the category to the user's
// watchlist if absent, removes it if present. Returns the post-toggle state.
//
// Body: { category: string }   // 64-char hex of the BCH category
// Returns 200 { inWatchlist: boolean } on success.
//         401 if no authenticated session.
//         400 if the category hex is malformed.
//         404 if the category doesn't exist in `tokens` (FK rejection).

import { error, json } from '@sveltejs/kit';
import { toggleWatchlist } from '$lib/server/watchlist';
import type { RequestHandler } from './$types';

const HEX_CATEGORY_RE = /^[0-9a-fA-F]{64}$/;

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, 'sign in required');
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
		// Most likely cause of an error here is the FK violation when the
		// category doesn't exist in `tokens`. Return 404 rather than 500
		// so the client can render a sensible message.
		if (err && typeof err === 'object' && 'code' in err && err.code === '23503') {
			throw error(404, 'unknown token category');
		}
		throw err;
	}
};
