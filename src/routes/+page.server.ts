// Directory home. SSR-loads the first page of tokens from Postgres
// directly (no /api/tokens round trip — the app and DB share a process).

import { query, hexFromBytes } from '$lib/server/db';
import type { PageServerLoad } from './$types';
import type { TokenApiRow, TokenType } from '$lib/types';

interface DbRow {
	category: Buffer;
	token_type: TokenType;
	genesis_block: number;
	first_seen_at: Date;
	name: string | null;
	symbol: string | null;
	decimals: number | null;
	description: string | null;
	icon_uri: string | null;
	current_supply: string | null;
	live_utxo_count: number | null;
	live_nft_count: number | null;
	holder_count: number | null;
	has_active_minting: boolean | null;
	is_fully_burned: boolean | null;
	verified_at: Date | null;
	metadata_fetched_at: Date | null;
}

const VALID_SORTS: Record<string, string> = {
	name: 'm.name ASC NULLS LAST, t.first_seen_at ASC',
	supply: 's.current_supply DESC NULLS LAST, m.name ASC NULLS LAST',
	holders: 's.holder_count DESC NULLS LAST, m.name ASC NULLS LAST',
	recent: 't.genesis_block DESC, t.first_seen_at DESC',
	oldest: 't.genesis_block ASC, t.first_seen_at ASC'
};

const PAGE_SIZE = 100;

export const load: PageServerLoad = async ({ url }) => {
	const sortKey = url.searchParams.get('sort') ?? 'name';
	const sort = VALID_SORTS[sortKey] ?? VALID_SORTS.name;
	const typeParam = url.searchParams.get('type');
	const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);

	const search = (url.searchParams.get('search') ?? '').trim();
	const searchLimited = search.slice(0, 128);

	const where: string[] = [];
	const values: unknown[] = [];
	if (typeParam === 'FT' || typeParam === 'NFT' || typeParam === 'FT+NFT') {
		values.push(typeParam);
		where.push(`t.token_type = $${values.length}`);
	}
	if (searchLimited) {
		// A 64-char hex search → exact category lookup (BYTEA = $n).
		// Otherwise → ILIKE over name and symbol, plus hex prefix of the category.
		if (/^[0-9a-fA-F]{64}$/.test(searchLimited)) {
			values.push(Buffer.from(searchLimited.toLowerCase(), 'hex'));
			where.push(`t.category = $${values.length}`);
		} else {
			values.push(`%${searchLimited}%`);
			const pat = `$${values.length}`;
			values.push(searchLimited.toLowerCase() + '%');
			const prefix = `$${values.length}`;
			where.push(
				`(m.name ILIKE ${pat} OR LOWER(m.symbol) LIKE ${prefix} OR encode(t.category, 'hex') LIKE ${prefix})`
			);
		}
	}
	const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

	try {
		const countRes = await query<{ total: string }>(
			`SELECT COUNT(*)::bigint AS total
			   FROM tokens t
			   LEFT JOIN token_metadata m ON m.category = t.category
			   LEFT JOIN token_state s    ON s.category = t.category
			   ${whereClause}`,
			values
		);
		const total = Number(countRes.rows[0]?.total ?? 0);

		const dataRes = await query<DbRow>(
			`SELECT
				t.category,
				t.token_type,
				t.genesis_block,
				t.first_seen_at,
				m.name,
				m.symbol,
				m.decimals,
				m.description,
				m.icon_uri,
				m.fetched_at AS metadata_fetched_at,
				s.current_supply::text AS current_supply,
				s.live_utxo_count,
				s.live_nft_count,
				s.holder_count,
				s.has_active_minting,
				s.is_fully_burned,
				s.verified_at
			   FROM tokens t
			   LEFT JOIN token_metadata m ON m.category = t.category
			   LEFT JOIN token_state s    ON s.category = t.category
			   ${whereClause}
			   ORDER BY ${sort}
			   LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
			[...values, PAGE_SIZE, offset]
		);

		const tokens: TokenApiRow[] = dataRes.rows.map((row) => {
			const verifiedAt = row.verified_at?.getTime() ?? null;
			const firstSeenAt = Math.floor(row.first_seen_at.getTime() / 1000);
			const metaAt = row.metadata_fetched_at?.getTime();
			const updatedAtMs = Math.max(
				verifiedAt ?? 0,
				metaAt ?? 0,
				row.first_seen_at.getTime()
			);
			return {
				id: hexFromBytes(row.category)!,
				name: row.name,
				symbol: row.symbol,
				decimals: row.decimals ?? 0,
				description: row.description,
				icon: row.icon_uri,
				tokenType: row.token_type,
				isVerifiedOnchain: row.verified_at !== null,
				isFullyBurned: row.is_fully_burned ?? false,
				currentSupply: row.current_supply ?? null,
				liveUtxoCount: row.live_utxo_count,
				liveNftCount: row.live_nft_count,
				holderCount: row.holder_count,
				hasActiveMinting: row.has_active_minting ?? false,
				firstSeenAt,
				genesisBlock: row.genesis_block,
				updatedAt: Math.floor(updatedAtMs / 1000)
			};
		});

		return {
			tokens,
			total,
			limit: PAGE_SIZE,
			offset,
			error: null
		};
	} catch (err) {
		console.error('[+page.server] load failed:', err);
		return {
			tokens: [],
			total: 0,
			limit: PAGE_SIZE,
			offset: 0,
			error: 'Directory is temporarily unavailable.'
		};
	}
};
