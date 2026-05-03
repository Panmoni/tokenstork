// /mints — history page. Auth-gated; lists this user's mint sessions
// newest-first.

import { redirect } from '@sveltejs/kit';
import { listSessionsPaginated } from '$lib/server/mintSessions';
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

	const sessions = await listSessionsPaginated(locals.user.cashaddr, PAGE_SIZE + 1, offset);
	const hasMore = sessions.length > PAGE_SIZE;
	const slice = hasMore ? sessions.slice(0, PAGE_SIZE) : sessions;

	return {
		mints: slice.map((s) => ({
			id: s.id,
			state: s.state,
			tokenType: s.tokenType,
			ticker: s.ticker,
			name: s.name,
			supply: s.supply,
			decimals: s.decimals,
			nftCapability: s.nftCapability,
			categoryHex: s.categoryHex,
			genesisTxidHex: s.genesisTxidHex,
			createdAt: s.createdAt
		})),
		offset,
		pageSize: PAGE_SIZE,
		hasMore
	};
};
