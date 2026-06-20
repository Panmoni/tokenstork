// /admin/icons — hidden operator queue for the icon-safety pipeline
// (item #22 / docs/icon-safety-plan.md). Lets the operator work the
// `review` backlog (icons the NSFW gate scored between the block and
// review thresholds, or every new icon when Vision is disabled) and
// hand-decide each: Clear (serve it) or Block (delete + mark).
//
// Gated on the shared admin allowlist ($lib/server/admin). Non-admins get
// a 404 — same posture as /admin/bcmr-submissions: we don't surface the
// route's existence to non-operators.

import { error, redirect } from '@sveltejs/kit';
import { isAdmin } from '$lib/server/admin';
import {
	listIconModeration,
	getIconStateCounts,
	type IconState
} from '$lib/server/iconModeration';
import type { PageServerLoad } from './$types';

const VALID_STATES: ReadonlyArray<IconState | 'all'> = [
	'review',
	'cleared',
	'blocked',
	'pending',
	'all'
];
// The queue is an operator workbench: show the whole backlog on one page so
// the operator can select-all and bulk-approve in a single pass rather than
// clicking through pages. Capped (not unbounded) so a pathological backlog
// can't render tens of thousands of image cards or blow the per-row rollup
// query past its statement timeout; the Newer/Older nav stays as the
// overflow fallback for anything beyond one page.
const PAGE_SIZE = 500;

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		throw redirect(303, `/login?return=${encodeURIComponent(url.pathname)}`);
	}
	if (!isAdmin(locals.user.cashaddr)) {
		// 404 not 403 — don't leak the route's existence to non-admins.
		error(404, 'Not found');
	}

	const stateParam = url.searchParams.get('state') ?? 'review';
	const state = (VALID_STATES as readonly string[]).includes(stateParam)
		? (stateParam as IconState | 'all')
		: 'review';
	const offsetRaw = Number(url.searchParams.get('offset') ?? 0);
	const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.floor(offsetRaw) : 0;

	const [rows, counts] = await Promise.all([
		listIconModeration(state, PAGE_SIZE + 1, offset),
		getIconStateCounts()
	]);
	const hasMore = rows.length > PAGE_SIZE;
	const slice = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

	return {
		rows: slice,
		counts,
		state,
		offset,
		pageSize: PAGE_SIZE,
		hasMore,
		me: locals.user.cashaddr
	};
};
