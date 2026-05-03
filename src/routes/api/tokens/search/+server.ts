// GET /api/tokens/search?q=<term>&limit=20
//
// Lightweight directory search for the airdrop wizard's recipient
// picker. Returns up to 20 matching categories with display fields
// (name, symbol, decimals, holder count). Pure ILIKE on name +
// symbol + 64-char-hex direct lookup; no fuzzy / no pagination — the
// caller surfaces a small typeahead, not a full directory.
//
// Public + cheap. No auth required (the answers are already on the
// directory page). Moderation filter applied so hidden categories
// don't leak in.

import { json, error } from '@sveltejs/kit';
import { query, hexFromBytes, categoryFromHex } from '$lib/server/db';
import { NOT_MODERATED_CLAUSE } from '$lib/moderation';
import type { RequestHandler } from './$types';

const MAX_LIMIT = 20;
const MIN_QUERY_LEN = 2;
const MAX_QUERY_LEN = 64;

interface DbRow {
	category: Buffer;
	token_type: 'FT' | 'NFT' | 'FT+NFT';
	name: string | null;
	symbol: string | null;
	decimals: number | null;
	icon_uri: string | null;
	icon_cleared_hash: string | null;
	holder_count: number | null;
}

function escapeIlike(s: string): string {
	return s.replace(/[\\%_]/g, '\\$&');
}

export const GET: RequestHandler = async ({ url }) => {
	const raw = (url.searchParams.get('q') ?? '').trim();
	if (raw.length < MIN_QUERY_LEN) {
		return json({ tokens: [] });
	}
	if (raw.length > MAX_QUERY_LEN) {
		error(400, 'q too long');
	}

	// 64-char hex paste? Direct lookup. Faster + less surprising than
	// trying to fuzzy-match a category id.
	if (/^[0-9a-fA-F]{64}$/.test(raw)) {
		let categoryBytes: Buffer;
		try {
			categoryBytes = categoryFromHex(raw);
		} catch {
			error(400, 'invalid category hex');
		}
		const result = await query<DbRow>(
			`SELECT t.category, t.token_type,
			        m.name, m.symbol, m.decimals,
			        m.icon_uri,
			        encode(imo.content_hash, 'hex') AS icon_cleared_hash,
			        s.holder_count
			   FROM tokens t
			   LEFT JOIN token_metadata m ON m.category = t.category
			   LEFT JOIN token_state s    ON s.category = t.category
			   LEFT JOIN icon_url_scan ius ON ius.icon_uri = m.icon_uri
			   LEFT JOIN icon_moderation imo
			          ON imo.content_hash = ius.content_hash
			         AND imo.state = 'cleared'
			  WHERE t.category = $1
			    AND ${NOT_MODERATED_CLAUSE}`,
			[categoryBytes]
		);
		return json({ tokens: result.rows.map(formatRow) });
	}

	const pat = `%${escapeIlike(raw)}%`;
	const result = await query<DbRow>(
		`SELECT t.category, t.token_type,
		        m.name, m.symbol, m.decimals,
		        m.icon_uri,
		        encode(imo.content_hash, 'hex') AS icon_cleared_hash,
		        s.holder_count
		   FROM tokens t
		   LEFT JOIN token_metadata m ON m.category = t.category
		   LEFT JOIN token_state s    ON s.category = t.category
		   LEFT JOIN icon_url_scan ius ON ius.icon_uri = m.icon_uri
		   LEFT JOIN icon_moderation imo
		          ON imo.content_hash = ius.content_hash
		         AND imo.state = 'cleared'
		  WHERE (m.name ILIKE $1 ESCAPE '\\' OR m.symbol ILIKE $1 ESCAPE '\\')
		    AND ${NOT_MODERATED_CLAUSE}
		  ORDER BY s.holder_count DESC NULLS LAST, m.name ASC NULLS LAST
		  LIMIT $2`,
		[pat, MAX_LIMIT]
	);
	return json({ tokens: result.rows.map(formatRow) });
};

function formatRow(r: DbRow): {
	categoryHex: string;
	tokenType: 'FT' | 'NFT' | 'FT+NFT';
	name: string | null;
	symbol: string | null;
	decimals: number;
	iconUri: string | null;
	iconClearedHash: string | null;
	holderCount: number | null;
} {
	return {
		categoryHex: hexFromBytes(r.category) ?? '',
		tokenType: r.token_type,
		name: r.name,
		symbol: r.symbol,
		decimals: r.decimals ?? 0,
		iconUri: r.icon_uri,
		iconClearedHash: r.icon_cleared_hash,
		holderCount: r.holder_count ?? null
	};
}
