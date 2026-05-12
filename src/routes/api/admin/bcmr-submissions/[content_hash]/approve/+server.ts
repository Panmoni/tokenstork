// POST /api/admin/bcmr-submissions/[content_hash]/approve
//
// Operator-only — gated on BCMR_ADMIN_CASHADDRS allowlist. Writes the
// submission's JSON to /var/lib/tokenstork/bcmr/<hash>.json for Caddy
// to serve, then flips review_state to 'approved'.
//
// Body: { note?: string }

import { error, isHttpError, json } from '@sveltejs/kit';
import { approveSubmission, isAdmin } from '$lib/server/bcmrTokenstorkSubmissions';
import type { RequestHandler } from './$types';

const HEX64_REGEX = /^[0-9a-fA-F]{64}$/;

export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) error(401, 'Wallet sign-in required');
	if (!isAdmin(locals.user.cashaddr)) error(404, 'Not found');
	const contentHash = params.content_hash!.toLowerCase();
	if (!HEX64_REGEX.test(contentHash)) error(400, 'content_hash must be 64 hex chars');

	let body: { note?: unknown };
	try {
		body = (await request.json()) as { note?: unknown };
	} catch {
		body = {};
	}
	const note =
		typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;

	try {
		const submission = await approveSubmission(contentHash, locals.user.cashaddr, note);
		return json({ ok: true, submission });
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[api/admin/bcmr/approve] error:', err);
		error(500, `Approve failed: ${(err as Error).message}`);
	}
};
