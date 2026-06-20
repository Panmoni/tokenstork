// POST /api/admin/icons/[content_hash]/clear
//
// Operator-only (shared admin allowlist). Flips the icon's moderation row
// to state='cleared' so iconHrefFor serves /icons/<hash>.webp publicly.
// Refuses if the transcoded WebP isn't on disk (see clearIcon).
//
// Body: { note?: string }

import { error, isHttpError, json } from '@sveltejs/kit';
import { isAdmin } from '$lib/server/admin';
import { clearIcon } from '$lib/server/iconModeration';
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
		const row = await clearIcon(contentHash, locals.user.cashaddr, note);
		return json({ ok: true, row });
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[api/admin/icons/clear] error:', err);
		// Surface the specific reason (e.g. "no image on disk") to the
		// operator — this endpoint is admin-only, so there's no info leak.
		error(400, (err as Error).message ?? 'Clear failed');
	}
};
