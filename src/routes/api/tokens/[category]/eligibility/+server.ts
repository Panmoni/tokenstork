// GET /api/tokens/[category]/eligibility
//
// Auth-gated. Returns the authenticated cashaddr's holding of this
// category (FT balance + nft_count + BCMR display fields), or 410 if
// they don't hold any of it. Drives the airdrop wizard's source-token
// preview at step 1 — gives the user immediate feedback before they
// proceed.

import { json, error } from '@sveltejs/kit';
import { categoryFromHex, query } from '$lib/server/db';
import { eligibilityFor, isCategoryModerated } from '$lib/server/airdrops';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Wallet sign-in required');
	const hex = params.category.toLowerCase();
	if (!/^[0-9a-fA-F]{64}$/.test(hex)) error(400, 'category must be 64-char hex');
	let categoryBytes;
	try {
		categoryBytes = categoryFromHex(hex);
	} catch {
		error(400, 'invalid category');
	}

	// Moderation gate — endpoint is auth-gated and used by the airdrop
	// wizard. Don't surface eligibility info on hidden categories or we
	// open a workflow around moderation.
	if (await isCategoryModerated(categoryBytes)) {
		error(410, 'Token is moderated; airdrop unavailable');
	}

	const eligibility = await eligibilityFor(locals.user.cashaddr, categoryBytes);
	if (!eligibility) {
		error(410, "You don't currently hold this token");
	}

	// BCMR display fields come from the cached token_metadata row the
	// on-chain walker populates after sha256-verifying the publisher's
	// JSON. No live HTTP call.
	const metaRes = await query<{ name: string | null; symbol: string | null; decimals: number | null }>(
		`SELECT name, symbol, decimals FROM token_metadata WHERE category = $1`,
		[categoryBytes]
	);
	const meta = metaRes.rows[0];
	return json({
		categoryHex: hex,
		balance: eligibility.balance,
		nft_count: eligibility.nft_count,
		name: meta?.name ?? null,
		symbol: meta?.symbol ?? null,
		decimals: meta?.decimals ?? 0
	});
};
