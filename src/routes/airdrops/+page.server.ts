// /airdrops — history page. Auth-gated; lists this user's airdrops
// newest-first.

import { redirect } from '@sveltejs/kit';
import { hexFromBytes } from '$lib/server/db';
import { listForUser } from '$lib/server/airdrops';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 25;

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		throw redirect(303, `/login?return=${encodeURIComponent(url.pathname)}`);
	}
	const offsetParam = Number(url.searchParams.get('offset') ?? 0);
	const offset = Number.isFinite(offsetParam) && offsetParam >= 0
		? Math.floor(offsetParam)
		: 0;

	const airdrops = await listForUser(locals.user.cashaddr, PAGE_SIZE + 1, offset);
	const hasMore = airdrops.length > PAGE_SIZE;
	const slice = hasMore ? airdrops.slice(0, PAGE_SIZE) : airdrops;

	return {
		airdrops: slice.map((a) => ({
			id: a.id,
			sourceCategoryHex: hexFromBytes(a.source_category) ?? '',
			recipientCategoryHex: hexFromBytes(a.recipient_category) ?? '',
			mode: a.mode,
			totalAmount: a.total_amount,
			holderCount: a.holder_count,
			state: a.state,
			txCount: a.tx_count,
			createdAt: a.created_at
		})),
		offset,
		pageSize: PAGE_SIZE,
		hasMore
	};
};
