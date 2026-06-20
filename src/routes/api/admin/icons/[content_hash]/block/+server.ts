// POST /api/admin/icons/[content_hash]/block
//
// Operator-only (shared admin allowlist). Deletes the on-disk WebP (so
// Caddy stops serving it) and flips the moderation row to
// state='blocked' with a reason. See blockIcon for the delete-first
// ordering that prevents marking an icon blocked while it's still served.
//
// Body: { reason: 'adult'|'csam'|'oversize'|'unsupported_format', note?: string }

import { error, isHttpError, json } from '@sveltejs/kit';
import { isAdmin } from '$lib/server/admin';
import { blockIcon, isOperatorBlockReason } from '$lib/server/iconModeration';
import type { RequestHandler } from './$types';

const HEX64_REGEX = /^[0-9a-fA-F]{64}$/;

export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) error(401, 'Wallet sign-in required');
	if (!isAdmin(locals.user.cashaddr)) error(404, 'Not found');
	const contentHash = params.content_hash!.toLowerCase();
	if (!HEX64_REGEX.test(contentHash)) error(400, 'content_hash must be 64 hex chars');

	let body: { reason?: unknown; note?: unknown };
	try {
		body = (await request.json()) as { reason?: unknown; note?: unknown };
	} catch {
		body = {};
	}
	if (typeof body.reason !== 'string' || !isOperatorBlockReason(body.reason)) {
		error(400, 'reason must be one of: adult, csam, oversize, unsupported_format');
	}
	const note =
		typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;

	try {
		const row = await blockIcon(contentHash, locals.user.cashaddr, body.reason, note);
		return json({ ok: true, row });
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[api/admin/icons/block] error:', err);
		// Admin-only endpoint: safe to surface the specific failure (e.g.
		// "failed to delete <path>") so the operator knows the block did
		// NOT fully take effect.
		error(500, (err as Error).message ?? 'Block failed');
	}
};
