// GET /api/tokens/[category]/recipientPreview
//
// Public. Returns holder count + display name for a category — drives
// the airdrop wizard's step 2 preview. Cheap COUNT against
// token_holders. No need to gate on auth: the holder count is already
// public on the directory page.

import { json, error } from '@sveltejs/kit';
import { categoryFromHex, query } from '$lib/server/db';
import { isCategoryModerated } from '$lib/server/airdrops';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const hex = params.category.toLowerCase();
	if (!/^[0-9a-fA-F]{64}$/.test(hex)) error(400, 'category must be 64-char hex');
	let categoryBytes;
	try {
		categoryBytes = categoryFromHex(hex);
	} catch {
		error(400, 'invalid category');
	}

	// Moderation gate — same posture as the eligibility endpoint. The
	// preview is consumed by the airdrop wizard, so a moderated
	// category should look as if it has no holders to airdrop to.
	if (await isCategoryModerated(categoryBytes)) {
		error(410, 'Token is moderated; airdrop unavailable');
	}

	const [holdersRes, metaRes] = await Promise.all([
		query<{ holder_count: string; snapshot_at: Date | null }>(
			`SELECT COUNT(*)::bigint AS holder_count, MAX(snapshot_at) AS snapshot_at
			   FROM token_holders
			  WHERE category = $1 AND (balance > 0 OR nft_count > 0)`,
			[categoryBytes]
		),
		// BCMR display fields come from the cached token_metadata row the
		// on-chain walker populates after sha256-verifying the publisher's
		// JSON. No live HTTP call.
		query<{ name: string | null; symbol: string | null; decimals: number | null }>(
			`SELECT name, symbol, decimals FROM token_metadata WHERE category = $1`,
			[categoryBytes]
		)
	]);
	const row = holdersRes.rows[0];
	const meta = metaRes.rows[0];
	return json({
		categoryHex: hex,
		holderCount: Number(row?.holder_count ?? 0),
		snapshotAt: row?.snapshot_at ?? null,
		name: meta?.name ?? null,
		symbol: meta?.symbol ?? null,
		decimals: meta?.decimals ?? 0
	});
};
