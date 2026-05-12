// /api/bcmr/sessions
//
// POST → create a new draft session for (authenticated user, category).
//         Body: { categoryHex: 64-char hex }. Returns the full session
//         shape so the wizard can immediately bind `id` for subsequent
//         PATCHes.
// GET  → list the user's sessions, newest first, paginated. Used by the
//         /publish-bcmr landing route to surface in-progress drafts.

import { json, error, isHttpError } from '@sveltejs/kit';
import { createSession, listSessions } from '$lib/server/bcmrPublishSessions';
import type { RequestHandler } from './$types';

const HEX64_REGEX = /^[0-9a-fA-F]{64}$/;
const MAX_LIST_LIMIT = 50;
const DEFAULT_LIST_LIMIT = 20;

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Wallet sign-in required');
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Body must be JSON');
	}
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		error(400, 'Body must be a JSON object');
	}
	const categoryHex = (body as Record<string, unknown>).categoryHex;
	if (typeof categoryHex !== 'string' || !HEX64_REGEX.test(categoryHex)) {
		error(400, 'categoryHex must be a 64-char hex string');
	}
	try {
		const session = await createSession(locals.user.cashaddr, categoryHex.toLowerCase());
		return json(session, { status: 201 });
	} catch (err) {
		if (isHttpError(err)) throw err;
		const e = err as Error & { tooManyDrafts?: boolean; code?: string };
		if (e.tooManyDrafts) error(429, e.message);
		// 23505 = unique-violation. The partial index on
		// `(cashaddr, category) WHERE state='drafting'` enforces
		// "one drafting session per wallet per category" at the DB level.
		// Surface as 409 so the wizard can route the user to their
		// existing draft instead of starting a duplicate.
		if (e.code === '23505') {
			error(409, 'You already have a drafting session for this category. Resume it or abandon it first.');
		}
		console.error('[api/bcmr/sessions POST] error:', err);
		error(500, 'Failed to create session');
	}
};

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) error(401, 'Wallet sign-in required');
	const limit = clampInt(url.searchParams.get('limit'), DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);
	const offset = clampInt(url.searchParams.get('offset'), 0, 0, 10_000);
	try {
		const sessions = await listSessions(locals.user.cashaddr, limit, offset);
		return json({ sessions, limit, offset });
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[api/bcmr/sessions GET] error:', err);
		error(500, 'Failed to list sessions');
	}
};

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
	if (!raw) return fallback;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < min || n > max) return fallback;
	return n;
}
