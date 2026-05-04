// /airdrops/new — wizard route. Auth-gated; pre-loads:
//
//   ?recipient=<hex>  — the token whose holders will receive (the
//                       most common entry point: the "Airdrop to
//                       holders" CTA on every /token/<hex> page).
//   ?source=<hex>     — a specific source token to airdrop. Less
//                       common entry point (no user-facing surface
//                       links it today; kept for completeness).
//
// Always pre-loads the wallet's holdings into `myTokens` so step 1
// can render a clickable dropdown of source candidates.

import { redirect, error } from '@sveltejs/kit';
import { categoryFromHex } from '$lib/server/db';
import {
	eligibilityFor,
	holderSnapshotFor,
	isCategoryModerated,
	listMyTokens,
	type MyTokenRow
} from '$lib/server/airdrops';
import { query } from '$lib/server/db';
import type { PageServerLoad } from './$types';

interface PreselectedSource {
	categoryHex: string;
	balance: string;
	nftCount: number;
	name: string | null;
	symbol: string | null;
	decimals: number;
}

interface PreselectedRecipient {
	categoryHex: string;
	name: string | null;
	symbol: string | null;
	holderCount: number;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		const ret = encodeURIComponent(url.pathname + url.search);
		throw redirect(303, `/login?return=${ret}`);
	}
	const senderCashaddr = locals.user.cashaddr;

	const sourceParam = url.searchParams.get('source');
	let preselectedSource: PreselectedSource | null = null;

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
		if (eligibility) {
			// BCMR display fields come from the cached token_metadata row
			// the on-chain walker populates. No live HTTP call.
			const metaRes = await query<{ name: string | null; symbol: string | null; decimals: number | null }>(
				`SELECT name, symbol, decimals FROM token_metadata WHERE category = $1`,
				[categoryBytes]
			);
			const meta = metaRes.rows[0];
			preselectedSource = {
				categoryHex: sourceParam.toLowerCase(),
				balance: eligibility.balance,
				nftCount: eligibility.nft_count,
				name: meta?.name ?? null,
				symbol: meta?.symbol ?? null,
				decimals: meta?.decimals ?? 0
			};
		}
	}

	const recipientParam = url.searchParams.get('recipient');
	let preselectedRecipient: PreselectedRecipient | null = null;
	if (recipientParam) {
		if (!/^[0-9a-fA-F]{64}$/.test(recipientParam)) {
			error(400, 'invalid recipient category');
		}
		let categoryBytes;
		try {
			categoryBytes = categoryFromHex(recipientParam);
		} catch {
			error(400, 'invalid recipient category');
		}
		// Don't surface holder previews on moderated categories — same
		// posture as /api/tokens/<cat>/recipientPreview.
		if (!(await isCategoryModerated(categoryBytes))) {
			// BCMR display fields come from the cached token_metadata row
			// the on-chain walker populates. No live HTTP call.
			const [metaRes, holderRow, snapshot] = await Promise.all([
				query<{ name: string | null; symbol: string | null }>(
					`SELECT name, symbol FROM token_metadata WHERE category = $1`,
					[categoryBytes]
				),
				query<{ n: string }>(
					`SELECT COUNT(*)::bigint AS n
					   FROM token_holders
					  WHERE category = $1 AND (balance > 0 OR nft_count > 0)`,
					[categoryBytes]
				),
				holderSnapshotFor(categoryBytes)
			]);
			// Snapshot is referenced by the wizard for staleness display;
			// not load-bearing here. Keep the await so any future code can
			// surface it.
			void snapshot;
			const meta = metaRes.rows[0];
			preselectedRecipient = {
				categoryHex: recipientParam.toLowerCase(),
				name: meta?.name ?? null,
				symbol: meta?.symbol ?? null,
				holderCount: Number(holderRow.rows[0]?.n ?? 0)
			};
		}
	}

	// Pre-load the wallet's holdings so step 1 can show a clickable
	// dropdown of source-token candidates. Hard-capped at 200 rows by
	// the helper. Empty array for wallets that hold nothing — wizard
	// renders an explainer in that case.
	const myTokens: MyTokenRow[] = await listMyTokens(senderCashaddr);

	return {
		senderCashaddr,
		preselectedSource,
		preselectedRecipient,
		myTokens
	};
};
