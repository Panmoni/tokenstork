// /admin/reports — operator queue for user-submitted token abuse reports
// (the "report this token" form → `token_reports`). Surfaces the backlog
// the webhook alert (src/lib/server/reportAlert.ts) would otherwise push;
// here the operator reads and triages it in-app instead.
//
// Gated on the shared admin allowlist ($lib/server/admin). Non-admins get
// a 404 — same posture as the other /admin surfaces: we don't reveal the
// route's existence to non-operators.

import { error, redirect } from '@sveltejs/kit';
import { isAdmin } from '$lib/server/admin';
import {
	listReports,
	getReportStatusCounts,
	REPORT_STATUSES,
	type ReportStatus
} from '$lib/server/tokenReports';
import type { PageServerLoad } from './$types';

const VALID_STATES: ReadonlyArray<ReportStatus | 'all'> = [...REPORT_STATUSES, 'all'];
const PAGE_SIZE = 50;

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		throw redirect(303, `/login?return=${encodeURIComponent(url.pathname)}`);
	}
	if (!isAdmin(locals.user.cashaddr)) {
		// 404 not 403 — don't leak the route's existence to non-admins.
		error(404, 'Not found');
	}

	const stateParam = url.searchParams.get('state') ?? 'new';
	const state = (VALID_STATES as readonly string[]).includes(stateParam)
		? (stateParam as ReportStatus | 'all')
		: 'new';
	const offsetRaw = Number(url.searchParams.get('offset') ?? 0);
	const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.floor(offsetRaw) : 0;

	const [rows, counts] = await Promise.all([
		listReports(state, PAGE_SIZE + 1, offset),
		getReportStatusCounts()
	]);
	const hasMore = rows.length > PAGE_SIZE;
	const slice = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

	return {
		reports: slice,
		counts,
		state,
		offset,
		pageSize: PAGE_SIZE,
		hasMore,
		me: locals.user.cashaddr
	};
};
