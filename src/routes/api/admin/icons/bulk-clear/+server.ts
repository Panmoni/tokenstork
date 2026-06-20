// POST /api/admin/icons/bulk-clear
//
// Operator-only (shared admin allowlist). Bulk variant of the per-hash
// clear endpoint: flips many icon_moderation rows to state='cleared' in a
// single request so the operator can approve a reviewed batch at once. Each
// hash is gated on the same on-disk invariant as the single-clear path (a
// hash whose WebP is missing is skipped, never cleared), so a batch approve
// can never paint a broken public icon.
//
// Body: { hashes: string[], note?: string }
// Returns: { ok: true, cleared: string[], skipped: { hash, reason }[] }

import { error, isHttpError, json } from '@sveltejs/kit';
import { isAdmin } from '$lib/server/admin';
import { bulkClearIcons } from '$lib/server/iconModeration';
import type { RequestHandler } from './$types';

const HEX64_REGEX = /^[0-9a-fA-F]{64}$/;
// Bound a single request so a stray payload can't ask the DB to flip an
// unbounded set. Comfortably above any realistic review batch.
const MAX_HASHES = 1000;

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Wallet sign-in required');
	if (!isAdmin(locals.user.cashaddr)) error(404, 'Not found');

	let body: { hashes?: unknown; note?: unknown };
	try {
		body = (await request.json()) as { hashes?: unknown; note?: unknown };
	} catch {
		body = {};
	}
	if (!Array.isArray(body.hashes) || body.hashes.length === 0) {
		error(400, 'hashes must be a non-empty array');
	}
	if (body.hashes.length > MAX_HASHES) {
		error(400, `too many hashes (max ${MAX_HASHES})`);
	}
	const hashes: string[] = [];
	for (const h of body.hashes) {
		if (typeof h !== 'string' || !HEX64_REGEX.test(h)) {
			error(400, 'every hash must be 64 hex chars');
		}
		hashes.push(h.toLowerCase());
	}
	const note =
		typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;

	try {
		const result = await bulkClearIcons(hashes, locals.user.cashaddr, note);
		return json({ ok: true, ...result });
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[api/admin/icons/bulk-clear] error:', err);
		// Admin-only endpoint: safe to surface the specific failure.
		error(400, (err as Error).message ?? 'Bulk clear failed');
	}
};
