// /airdrops/new — wizard route. Auth-gated; pre-loads sender's
// eligibility for `?source=<categoryHex>` if provided so the wizard
// can skip the source-token picker.

import { redirect, error } from '@sveltejs/kit';
import { categoryFromHex, hexFromBytes } from '$lib/server/db';
import { eligibilityFor, holderListFor, holderSnapshotFor } from '$lib/server/airdrops';
import { fetchBcmr } from '$lib/server/external';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		const ret = encodeURIComponent(url.pathname + url.search);
		throw redirect(303, `/login?return=${ret}`);
	}
	const senderCashaddr = locals.user.cashaddr;

	const sourceParam = url.searchParams.get('source');
	let preselectedSource: { categoryHex: string; balance: string; nftCount: number; name: string | null; symbol: string | null; decimals: number } | null = null;

	if (sourceParam) {
		if (!/^[0-9a-fA-F]{64}$/.test(sourceParam)) {
			error(400, 'invalid source category');
		}
		let categoryBytes;
		try {
			categoryBytes = categoryFromHex(sourceParam);
		} catch {
			error(400, 'invalid source category');
		}
		const eligibility = await eligibilityFor(senderCashaddr, categoryBytes);
		if (!eligibility) {
			// Wizard renders an explainer; user will pick a different source.
			preselectedSource = null;
		} else {
			// Pull BCMR for display (name/symbol/decimals).
			const bcmr = await fetchBcmr(sourceParam.toLowerCase()).catch(() => null);
			preselectedSource = {
				categoryHex: sourceParam.toLowerCase(),
				balance: eligibility.balance,
				nftCount: eligibility.nft_count,
				name: bcmr?.name ?? null,
				symbol: bcmr?.symbol ?? null,
				decimals: bcmr?.decimals ?? 0
			};
		}
	}

	return {
		senderCashaddr,
		preselectedSource
	};
};
