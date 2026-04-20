// GET /api/tokens/<category_hex>/holders?limit=100&offset=0

import { json, error, isHttpError } from '@sveltejs/kit';
import { bytesFromHex, query } from '$lib/server/db';
import type { RequestHandler } from './$types';

const HEX_REGEX = /^[0-9a-fA-F]{64}$/;

interface HolderRow {
	address: string;
	balance: string;
	nft_count: number;
	snapshot_at: Date;
}

export const GET: RequestHandler = async ({ params, url, setHeaders }) => {
	const category = params.category;
	if (!category || !HEX_REGEX.test(category)) {
		error(400, 'invalid category (expected 64 hex chars)');
	}

	const limit = Math.min(
		Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1),
		1000
	);
	const offset = Math.max(
		Number(url.searchParams.get('offset') ?? 0) || 0,
		0
	);

	setHeaders({ 'cache-control': 'public, max-age=60' });

	try {
		const categoryBytes = bytesFromHex(category);

		const countRes = await query<{ total: string }>(
			`SELECT COUNT(*)::bigint AS total FROM token_holders WHERE category = $1`,
			[categoryBytes]
		);
		const total = Number(countRes.rows[0]?.total ?? 0);

		const rowsRes = await query<HolderRow>(
			`SELECT address, balance::text AS balance, nft_count, snapshot_at
			   FROM token_holders
			  WHERE category = $1
			  ORDER BY balance DESC, address ASC
			  LIMIT $2 OFFSET $3`,
			[categoryBytes, limit, offset]
		);

		return json({
			category: category.toLowerCase(),
			holders: rowsRes.rows.map((r) => ({
				address: r.address,
				balance: r.balance,
				nftCount: r.nft_count,
				snapshotAt: Math.floor(r.snapshot_at.getTime() / 1000)
			})),
			count: rowsRes.rows.length,
			limit,
			offset,
			total
		});
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[api/tokens/[category]/holders] error:', err);
		error(500, 'Failed to fetch holders');
	}
};
