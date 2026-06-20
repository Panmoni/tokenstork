// POST /api/admin/reports/[id]/status
//
// Operator-only — gated on the shared admin allowlist. Advances a token
// report's triage status (new → reviewed / actioned / dismissed, or back).
// Hiding the token itself is a separate concern (token_moderation); this
// endpoint only moves the report's status + records an optional note.
//
// Body: { status: 'new'|'reviewed'|'actioned'|'dismissed', note?: string }

import { error, isHttpError, json } from '@sveltejs/kit';
import { isAdmin } from '$lib/server/admin';
import { setReportStatus, REPORT_STATUSES_SET, type ReportStatus } from '$lib/server/tokenReports';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) error(401, 'Wallet sign-in required');
	if (!isAdmin(locals.user.cashaddr)) error(404, 'Not found');

	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(400, 'id must be a positive integer');

	let body: { status?: unknown; note?: unknown };
	try {
		body = (await request.json()) as { status?: unknown; note?: unknown };
	} catch {
		body = {};
	}
	if (typeof body.status !== 'string' || !REPORT_STATUSES_SET.has(body.status)) {
		error(400, 'status must be one of: new, reviewed, actioned, dismissed');
	}
	const status = body.status as ReportStatus;
	const note =
		typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;

	try {
		const ok = await setReportStatus(id, status, note);
		if (!ok) error(404, 'Report not found');
		return json({ ok: true });
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[api/admin/reports/status] error:', err);
		error(500, 'Internal error');
	}
};
