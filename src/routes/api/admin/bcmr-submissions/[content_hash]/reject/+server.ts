// POST /api/admin/bcmr-submissions/[content_hash]/reject
//
// Operator-only — gated on BCMR_ADMIN_CASHADDRS allowlist. Flips
// review_state to 'rejected' and records a moderator note (required).
// Does not touch the filesystem.
//
// Body: { note: string } (required, non-empty)

import { error, isHttpError, json } from '@sveltejs/kit';
import { rejectSubmission, isAdmin } from '$lib/server/bcmrTokenstorkSubmissions';
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
		error(400, 'Body must be JSON');
	}
	if (typeof body.note !== 'string' || !body.note.trim()) {
		error(400, 'note required (rejection must record a reason)');
	}
	const note = body.note.trim().slice(0, 500);

	try {
		const submission = await rejectSubmission(contentHash, locals.user.cashaddr, note);
		return json({ ok: true, submission });
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[api/admin/bcmr/reject] error:', err);
		error(500, `Reject failed: ${(err as Error).message}`);
	}
};
