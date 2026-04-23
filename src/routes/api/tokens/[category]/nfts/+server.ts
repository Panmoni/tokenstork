// GET /api/tokens/<category_hex>/nfts?limit=500&offset=0&capability=none|mutable|minting

import { json, error, isHttpError } from '@sveltejs/kit';
import { bytesFromHex, hexFromBytes, query } from '$lib/server/db';
import { NOT_MODERATED_CLAUSE } from '$lib/moderation';
import type { RequestHandler } from './$types';

const HEX_REGEX = /^[0-9a-fA-F]{64}$/;

interface NftRow {
	commitment: Buffer;
	capability: 'none' | 'mutable' | 'minting';
	owner_address: string | null;
	snapshot_at: Date;
}

export const GET: RequestHandler = async ({ params, url, setHeaders }) => {
	const category = params.category;
	if (!category || !HEX_REGEX.test(category)) {
		error(400, 'invalid category (expected 64 hex chars)');
	}

	const capability = url.searchParams.get('capability');
	if (capability && !['none', 'mutable', 'minting'].includes(capability)) {
		error(400, 'invalid capability');
	}

	const limit = Math.min(
		Math.max(Number(url.searchParams.get('limit') ?? 500) || 500, 1),
		5000
	);
	const offset = Math.max(
		Number(url.searchParams.get('offset') ?? 0) || 0,
		0
	);

	setHeaders({ 'cache-control': 'public, max-age=60' });

	try {
		const categoryBytes = bytesFromHex(category);

		// Existence + moderation guard. Same pattern as the holders endpoint:
		// collapse "exists in tokens AND not in moderation" into a single
		// query, translate any miss to 410 so probing for hidden categories
		// doesn't leak info. Shared NOT_MODERATED_CLAUSE from $lib/moderation.
		const guardRes = await query(
			`SELECT 1
			   FROM tokens t
			  WHERE t.category = $1
			    AND ${NOT_MODERATED_CLAUSE}
			  LIMIT 1`,
			[categoryBytes]
		);
		if (guardRes.rows.length === 0) {
			error(410, 'This token is not available.');
		}

		const whereParts: string[] = ['category = $1'];
		const queryValues: unknown[] = [categoryBytes];
		if (capability) {
			whereParts.push(`capability = $${queryValues.length + 1}`);
			queryValues.push(capability);
		}
		const whereSql = `WHERE ${whereParts.join(' AND ')}`;

		const countRes = await query<{ total: string }>(
			`SELECT COUNT(*)::bigint AS total FROM nft_instances ${whereSql}`,
			queryValues
		);
		const total = Number(countRes.rows[0]?.total ?? 0);

		const rowsRes = await query<NftRow>(
			`SELECT commitment, capability, owner_address, snapshot_at
			   FROM nft_instances
			   ${whereSql}
			  ORDER BY commitment ASC
			  LIMIT $${queryValues.length + 1} OFFSET $${queryValues.length + 2}`,
			[...queryValues, limit, offset]
		);

		return json({
			category: category.toLowerCase(),
			nfts: rowsRes.rows.map((r) => ({
				commitment: hexFromBytes(r.commitment)!,
				capability: r.capability,
				ownerAddress: r.owner_address,
				snapshotAt: Math.floor(r.snapshot_at.getTime() / 1000)
			})),
			count: rowsRes.rows.length,
			limit,
			offset,
			total
		});
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[api/tokens/[category]/nfts] error:', err);
		error(500, 'Failed to fetch NFTs');
	}
};
