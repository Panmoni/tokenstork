// /admin — operator landing page. Links the three hidden operator queues
// (reports, icons, bcmr-submissions) with a "needs attention" count each,
// since nothing in the site nav points at them. Same gate + 404 posture
// as every other admin surface ($lib/server/admin).

import { error, redirect } from '@sveltejs/kit';
import { isAdmin } from '$lib/server/admin';
import { getReportStatusCounts } from '$lib/server/tokenReports';
import { getIconStateCounts } from '$lib/server/iconModeration';
import { getSubmissionStateCounts } from '$lib/server/bcmrTokenstorkSubmissions';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		throw redirect(303, `/login?return=${encodeURIComponent(url.pathname)}`);
	}
	if (!isAdmin(locals.user.cashaddr)) {
		// 404 not 403 — don't leak the route's existence to non-admins.
		error(404, 'Not found');
	}

	const [reports, icons, submissions] = await Promise.all([
		getReportStatusCounts(),
		getIconStateCounts(),
		getSubmissionStateCounts()
	]);

	return {
		me: locals.user.cashaddr,
		// `pending` = the actionable backlog for each queue; `total` for context.
		reports: { pending: reports.new, total: reports.all },
		icons: { pending: icons.review, total: icons.pending + icons.cleared + icons.blocked + icons.review },
		submissions: {
			pending: submissions.pending,
			total: submissions.pending + submissions.approved + submissions.rejected
		}
	};
};
