// POST /api/admin/tokens/[category]/moderate
//
// Operator-only — gated on the shared admin allowlist. Hides or un-hides a
// token by writing/deleting its `token_moderation` row (see
// $lib/server/tokenModeration). Category-keyed and reusable from any admin
// surface; the /admin/reports queue passes `reportId` so a hide also closes
// the report (→ actioned) atomically.
//
// Body: { action: 'hide'|'unhide', reason?: ReportReason, note?: string,
//         reportId?: number }
//   - hide   requires `reason` ∈ the shared report/moderation enum.
//   - unhide ignores reason/reportId.

import { error, isHttpError, json } from '@sveltejs/kit';
import { isAdmin } from '$lib/server/admin';
import { hideToken, unhideToken } from '$lib/server/tokenModeration';
import { REPORT_REASONS_SET, type ReportReason } from '$lib/moderation';
import type { RequestHandler } from './$types';

const HEX64_REGEX = /^[0-9a-fA-F]{64}$/;

export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) error(401, 'Wallet sign-in required');
	if (!isAdmin(locals.user.cashaddr)) error(404, 'Not found');

	const category = params.category!.toLowerCase();
	if (!HEX64_REGEX.test(category)) error(400, 'category must be 64 hex chars');

	let body: { action?: unknown; reason?: unknown; note?: unknown; reportId?: unknown };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		body = {};
	}

	const note =
		typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
	const reportId =
		typeof body.reportId === 'number' && Number.isInteger(body.reportId) && body.reportId > 0
			? body.reportId
			: undefined;

	try {
		if (body.action === 'hide') {
			if (typeof body.reason !== 'string' || !REPORT_REASONS_SET.has(body.reason)) {
				error(400, 'reason must be one of: spam, phishing, offensive, fraud, illegal, other');
			}
			await hideToken(category, body.reason as ReportReason, note, reportId);
			return json({ ok: true, hidden: true });
		}
		if (body.action === 'unhide') {
			await unhideToken(category);
			return json({ ok: true, hidden: false });
		}
		error(400, "action must be 'hide' or 'unhide'");
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[api/admin/tokens/moderate] error:', err);
		error(500, 'Internal error');
	}
};
