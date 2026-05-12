// /admin/bcmr-submissions — operator-only approval queue for the
// tokenstork-hosted BCMR backup. Gated on the `BCMR_ADMIN_CASHADDRS`
// env var (comma-separated cashaddr allowlist).
//
// Unauthorized visitors get a 404 — we don't surface "this URL exists
// but you can't see it" to non-operators.

import { error, redirect } from '@sveltejs/kit';
import {
	isAdmin,
	listSubmissions,
	type SubmissionState
} from '$lib/server/bcmrTokenstorkSubmissions';
import type { PageServerLoad } from './$types';

const VALID_STATES: ReadonlyArray<SubmissionState | 'all'> = [
	'pending',
	'approved',
	'rejected',
	'all'
];
const PAGE_SIZE = 50;

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		throw redirect(303, `/login?return=${encodeURIComponent(url.pathname)}`);
	}
	if (!isAdmin(locals.user.cashaddr)) {
		// 404 not 403 — don't leak the route's existence to non-admins.
		error(404, 'Not found');
	}

	const stateParam = url.searchParams.get('state') ?? 'pending';
	const state = (VALID_STATES as readonly string[]).includes(stateParam)
		? (stateParam as SubmissionState | 'all')
		: 'pending';
	const offsetRaw = Number(url.searchParams.get('offset') ?? 0);
	const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.floor(offsetRaw) : 0;

	const submissions = await listSubmissions(state, PAGE_SIZE + 1, offset);
	const hasMore = submissions.length > PAGE_SIZE;
	const slice = hasMore ? submissions.slice(0, PAGE_SIZE) : submissions;

	return {
		submissions: slice.map((s) => ({
			contentHashHex: s.contentHashHex,
			categoryHex: s.categoryHex,
			cashaddr: s.cashaddr,
			submittedAt: s.submittedAt,
			reviewState: s.reviewState,
			reviewedAt: s.reviewedAt,
			reviewerCashaddr: s.reviewerCashaddr,
			moderatorNote: s.moderatorNote,
			// Body is shown inline so the operator can read before approving.
			// Capped to a reasonable display size; full body is always in psql.
			jsonBodyPreview: JSON.stringify(s.jsonBody, null, 2).slice(0, 8192)
		})),
		state,
		offset,
		pageSize: PAGE_SIZE,
		hasMore,
		me: locals.user.cashaddr
	};
};
