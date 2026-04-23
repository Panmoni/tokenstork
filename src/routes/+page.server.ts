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
	cauldron_price_sats: number | null;
	cauldron_tvl_satoshis: string | null;
}

// Bucket names by "quality" so the directory opens with recognisable
// English-alphabet tokens, not with rows that start with emoji / box-
// drawing characters / `$` / whitespace. This is a UX sort, not a
// censorship mechanism — the low-quality rows are still discoverable,
// just not the first thing a visitor sees.
//
//   0 → starts with an ASCII letter (A-Z, a-z) — real-name tokens
//   1 → starts with an ASCII digit  (0-9) — numeric names, sometimes legit
//   2 → starts with anything else    — emoji, $, unicode symbols, punctuation
//   3 → empty or NULL name after trim — no usable metadata at all
const NAME_QUALITY = `CASE
	WHEN m.name IS NULL OR BTRIM(m.name) = '' THEN 3
	WHEN m.name ~ '^[A-Za-z]'                 THEN 0
	WHEN m.name ~ '^[0-9]'                    THEN 1
	ELSE                                           2
END`;

// Treat '' and whitespace-only as missing so they sort alongside NULL
// under `NULLS LAST`. The ordering key is applied as the secondary sort
// within each NAME_QUALITY bucket.
const NAME_SORTABLE = `NULLIF(BTRIM(m.name), '')`;

const VALID_SORTS: Record<string, string> = {
	name: `${NAME_QUALITY}, LOWER(${NAME_SORTABLE}) ASC NULLS LAST, t.first_seen_at ASC`,
	supply: `s.current_supply DESC NULLS LAST, ${NAME_QUALITY}, ${NAME_SORTABLE} ASC NULLS LAST`,
	holders: `s.holder_count DESC NULLS LAST, ${NAME_QUALITY}, ${NAME_SORTABLE} ASC NULLS LAST`,
	// When sorting by TVL, put Cauldron-listed tokens first (highest TVL at
	// the top); unlisted tokens sink to the bottom via NULLS LAST.
	tvl: `vl_cauldron.tvl_satoshis DESC NULLS LAST, ${NAME_QUALITY}, ${NAME_SORTABLE} ASC NULLS LAST`,
	recent: 't.genesis_block DESC, t.first_seen_at DESC',
	oldest: 't.genesis_block ASC, t.first_seen_at ASC'
};

const PAGE_SIZE = 100;

export const load: PageServerLoad = async ({ url }) => {
	const sortKey = url.searchParams.get('sort') ?? 'name';
	const sort = VALID_SORTS[sortKey] ?? VALID_SORTS.name;
	const typeParam = url.searchParams.get('type');
	const onlyCauldron = url.searchParams.get('cauldron') === '1';
	const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);

	const search = (url.searchParams.get('search') ?? '').trim();
	const searchLimited = search.slice(0, 128);

	const where: string[] = [];
	const values: unknown[] = [];
	if (typeParam === 'FT' || typeParam === 'NFT' || typeParam === 'FT+NFT') {
		values.push(typeParam);
		where.push(`t.token_type = $${values.length}`);
	}
	if (onlyCauldron) {
		// LEFT JOIN below always populates vl_cauldron for every row; adding
		// `vl_cauldron.category IS NOT NULL` filters to listed rows without
		// a second subquery.
		where.push(`vl_cauldron.category IS NOT NULL`);
	}
	if (searchLimited) {
		// A full 64-char hex query is almost always a paste of a category ID
		// the user wants the exact page for — short-circuit to a direct BYTEA
		// lookup instead of falling back to substring matching (which would
		// work but is needlessly expensive).
		if (/^[0-9a-fA-F]{64}$/.test(searchLimited)) {
			values.push(Buffer.from(searchLimited.toLowerCase(), 'hex'));
			where.push(`t.category = $${values.length}`);
		} else {
			// Free-form query: case-insensitive substring across every
			// user-visible text field — name, symbol, description — plus
			// substring on the hex category (so a user can paste a partial
			// hex like "d29eb" and match).
			//
			// ILIKE with a leading `%` doesn't use a plain btree index on
			// `name`, but at 10-20k rows on a single node this is a handful
			// of ms. The `token_metadata_name_trgm` trigram index can
			// accelerate name matches if we need to move to pg_trgm's
			// similarity() operator later (tracked — not today).
			values.push(`%${searchLimited}%`);
			const pat = `$${values.length}`;
			values.push(`%${searchLimited.toLowerCase()}%`);
			const patLower = `$${values.length}`;
			where.push(
				`(m.name ILIKE ${pat}
				  OR m.symbol ILIKE ${pat}
				  OR m.description ILIKE ${pat}
				  OR encode(t.category, 'hex') LIKE ${patLower})`
			);
		}
	}
	const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

	// vl_cauldron is a LEFT JOIN so every row can still surface price/TVL
	// columns when the token is listed, and unlisted tokens just get NULLs.
	// When the "onlyCauldron" filter is on, the WHERE clause above promotes
	// the LEFT JOIN into an effective INNER JOIN via `IS NOT NULL`.
	const fromJoins = `
		FROM tokens t
		LEFT JOIN token_metadata m ON m.category = t.category
		LEFT JOIN token_state    s ON s.category = t.category
		LEFT JOIN token_venue_listings vl_cauldron
			ON vl_cauldron.category = t.category AND vl_cauldron.venue = 'cauldron'
	`;

	try {
		const countRes = await query<{ total: string }>(
			`SELECT COUNT(*)::bigint AS total ${fromJoins} ${whereClause}`,
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
				s.verified_at,
				vl_cauldron.price_sats    AS cauldron_price_sats,
				vl_cauldron.tvl_satoshis::text AS cauldron_tvl_satoshis
			   ${fromJoins}
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
			// node-pg returns BIGINT as a string to preserve precision. Parse
			// to number at the edge — TVL in satoshis tops out at ~2.1e15
			// (21M BCH), well under Number.MAX_SAFE_INTEGER (~9e15).
			let tvl: number | null = null;
			if (row.cauldron_tvl_satoshis != null) {
				const parsed = Number(row.cauldron_tvl_satoshis);
				if (Number.isFinite(parsed)) tvl = parsed;
			}
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
				updatedAt: Math.floor(updatedAtMs / 1000),
				cauldronPriceSats: row.cauldron_price_sats,
				cauldronTvlSatoshis: tvl
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
