// GET /api/tokens — directory endpoint. Postgres-backed. Response shape
// is byte-for-byte compatible with the prior pages/api/tokens.ts.

import { json, error, isHttpError } from '@sveltejs/kit';
import { hexFromBytes, query } from '$lib/server/db';
import { getFirstNMap } from '$lib/server/firstN';
import { NOT_MODERATED_CLAUSE } from '$lib/moderation';
import { clientIp } from '$lib/server/clientIp';
import { csvExportRateLimiter } from '$lib/server/rateLimit';
import type { RequestHandler } from './$types';

/** Quote a CSV cell per RFC 4180: wrap in `"` if it contains `,`, `"`,
 *  or a newline; double any embedded `"`. Numbers, booleans and null
 *  are coerced to their JSON-ish text form. */
function csvCell(v: unknown): string {
	if (v == null) return '';
	const s = typeof v === 'string' ? v : String(v);
	return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV column order — stable so consumers can pin to it. Mirrors the
 *  JSON shape, dropping fields that don't render usefully as a flat
 *  cell (no nested objects today).
 *
 *  Typed as `ReadonlyArray<keyof TokenApiRow>` so a future field added
 *  to the JSON shape but missed here surfaces as a *deliberate* gap
 *  rather than a silent drift — and so `t[col]` below indexes the
 *  TokenApiRow shape directly (no `as unknown` cast). */
const CSV_COLUMNS: ReadonlyArray<keyof TokenApiRow> = [
	'id',
	'name',
	'symbol',
	'decimals',
	'description',
	'icon',
	'iconClearedHash',
	'tokenType',
	'isVerifiedOnchain',
	'isFullyBurned',
	'currentSupply',
	'liveUtxoCount',
	'liveNftCount',
	'holderCount',
	'hasActiveMinting',
	'firstSeenAt',
	'genesisTime',
	'firstNRank',
	'genesisBlock',
	'updatedAt',
	'isCrc20',
	'crc20Symbol',
	'crc20SymbolIsHex',
	'crc20IsCanonical',
	'crc20Name'
];

function tokensToCsv(tokens: TokenApiRow[]): string {
	const header = CSV_COLUMNS.join(',');
	const rows = tokens.map((t) => CSV_COLUMNS.map((col) => csvCell(t[col])).join(','));
	return [header, ...rows].join('\r\n') + '\r\n';
}

/** Escape `%` and `_` in a user-supplied ILIKE pattern. Without this,
 *  a query of `%%%%%%%%%%%%%%%%%` runs as a deliberately-pessimal
 *  pattern that scans the whole table; `_` does the same on a single
 *  character. The trailing `\` escape character is the standard
 *  Postgres convention.  */
function escapeIlikeLiteral(s: string): string {
	return s.replace(/[\\%_]/g, '\\$&');
}

/** Maximum length for a name-search query. 64 chars is generous for any
 *  real token name; longer values are almost always probing for a
 *  worst-case ILIKE plan. */
const MAX_NAME_SEARCH_LEN = 64;
const MIN_NAME_SEARCH_LEN = 2;

type TokenType = 'FT' | 'NFT' | 'FT+NFT';

interface TokenApiRow {
	id: string;
	name: string | null;
	symbol: string | null;
	decimals: number;
	description: string | null;
	icon: string | null;
	/// Hex of the SHA-256 of this token's icon's cleared bytes, or null
	/// if the icon hasn't been scanned + cleared by the icon-safety
	/// pipeline (see docs/icon-safety-plan.md). External consumers can
	/// resolve to https://tokenstork.com/icons/<hash>.webp for a safe,
	/// origin-served image; null means render a placeholder.
	iconClearedHash: string | null;
	tokenType: TokenType;
	isVerifiedOnchain: boolean;
	isFullyBurned: boolean;
	currentSupply: string | null;
	liveUtxoCount: number | null;
	liveNftCount: number | null;
	holderCount: number | null;
	hasActiveMinting: boolean;
	firstSeenAt: number;
	/// On-chain genesis-tx block timestamp, unix seconds.
	genesisTime: number;
	/// Permanent rank if this is one of the first 10 CashTokens ever
	/// minted (1..10), null otherwise.
	firstNRank: number | null;
	genesisBlock: number;
	updatedAt: number;
	// CRC-20 covenant detection. See docs/crc20-plan.md and
	// $lib/types.ts#TokenApiRow for the full description.
	isCrc20: boolean;
	crc20Symbol: string | null;
	crc20SymbolIsHex: boolean;
	crc20IsCanonical: boolean;
	crc20Name: string | null;
}

interface DbRow {
	category: Buffer;
	token_type: TokenType;
	genesis_block: number;
	genesis_time: Date;
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
	icon_cleared_hash: string | null;
	is_crc20: boolean | null;
	crc20_symbol: string | null;
	crc20_symbol_is_hex: boolean | null;
	crc20_is_canonical: boolean | null;
	crc20_name: string | null;
}

function parseLimit(raw: string | null, fallback: number, max: number): number {
	const n = raw ? Number(raw) : fallback;
	if (!Number.isFinite(n) || n <= 0) return fallback;
	return Math.min(Math.floor(n), max);
}

function parseOffset(raw: string | null): number {
	const n = raw ? Number(raw) : 0;
	if (!Number.isFinite(n) || n < 0) return 0;
	return Math.floor(n);
}

const VALID_SORTS: Record<string, string> = {
	name: 'm.name ASC NULLS LAST, t.first_seen_at ASC',
	supply: 's.current_supply DESC NULLS LAST, m.name ASC NULLS LAST',
	holders: 's.holder_count DESC NULLS LAST, m.name ASC NULLS LAST',
	recent: 't.genesis_block DESC, t.first_seen_at DESC',
	oldest: 't.genesis_block ASC, t.first_seen_at ASC'
};

export const GET: RequestHandler = async ({ url, request, getClientAddress, setHeaders }) => {
	const params = url.searchParams;
	const isCsv = params.get('format') === 'csv';

	// CSV-only: tighter rate limit + longer CDN-side cache. JSON path is
	// already CDN-cacheable + 1000-row capped + same SQL query, so the
	// JSON code path doesn't need extra defenses; the CSV branch's
	// additional surface (much fatter response per row, much more
	// attractive to scrapers) gets its own per-IP ceiling.
	if (isCsv) {
		const ip = clientIp({ request, getClientAddress });
		const rl = csvExportRateLimiter.consume(ip);
		if (!rl.allowed) {
			const retryAfter = Math.max(1, Math.ceil((rl.retryAfterMs ?? 60_000) / 1000));
			// Manual Response (not error()) so we can attach the
			// Retry-After header per RFC 7231 §6.6.4 — well-behaved
			// clients (curl --retry, automated SDKs) honour the
			// header, not the message body.
			return new Response(
				JSON.stringify({ error: `rate limit exceeded; retry after ${retryAfter}s` }),
				{
					status: 429,
					headers: {
						'content-type': 'application/json',
						'retry-after': String(retryAfter)
					}
				}
			);
		}
	}

	if (isCsv) {
		// CSV is cookie-independent — there's no "show me my watchlist
		// as CSV" mode. Drop the `vary: Cookie` the JSON branch carries
		// for SSR's session-aware variants; without it the CDN keys
		// purely on URL and the s-maxage actually absorbs scraper
		// repeats (with `vary: Cookie`, every distinct cookie value
		// instantiates its own cache entry, defeating the whole point).
		setHeaders({
			'cache-control': 'public, max-age=60, s-maxage=300'
		});
	} else {
		// `private` rather than `public` because the response varies by
		// every query parameter — `?sort=`, `?nameSearch=`, `?type=`, etc.
		// A shared CDN keyed only on path would collapse distinct
		// variants into one cache entry. The browser cache still serves
		// repeat hits on the same URL within 60 s, which is what we want.
		setHeaders({
			'cache-control': 'private, max-age=60',
			vary: 'Cookie'
		});
	}

	try {

		const tokenType = params.get('type');
		const verifiedOnly = params.get('verified') === 'true';
		const isFullyBurnedParam = params.get('isFullyBurned');
		const symbol = params.get('symbol');
		const nameSearch = params.get('nameSearch');
		const minSupplyRaw = params.get('minSupply');
		// ?crc20=true | canonical | noncanonical — see SSR loader for semantics.
		const crc20Param = params.get('crc20');
		const sort = VALID_SORTS[params.get('sort') ?? 'name'] ?? VALID_SORTS.name;
		const limit = parseLimit(params.get('limit'), 100, 1000);
		const offset = parseOffset(params.get('offset'));

		// Moderation filter is always on — the public API respects the same
		// blocklist as the directory. Fragment lives in $lib/moderation.
		const where: string[] = [NOT_MODERATED_CLAUSE];
		const values: unknown[] = [];
		const push = (fragment: string, value: unknown) => {
			values.push(value);
			where.push(fragment.replace('$$', `$${values.length}`));
		};

		if (tokenType) {
			if (tokenType !== 'FT' && tokenType !== 'NFT' && tokenType !== 'FT+NFT') {
				error(400, 'invalid type');
			}
			push('t.token_type = $$', tokenType);
		}
		if (verifiedOnly) {
			where.push('s.verified_at IS NOT NULL');
		}
		if (isFullyBurnedParam === 'true') {
			where.push('s.is_fully_burned = true');
		} else if (isFullyBurnedParam === 'false') {
			where.push('(s.is_fully_burned IS NULL OR s.is_fully_burned = false)');
		}
		if (symbol) {
			// Match against either the BCMR symbol (token_metadata.symbol) or
			// the CRC-20 on-chain symbol (token_crc20.symbol). The two come
			// from different sources and are commonly different strings — a
			// CRC-20-BCH token's BCMR symbol may be "CRC20-BCH" but its
			// on-chain claim is "BCH". Single bind reused for both halves.
			values.push(symbol);
			const idx = values.length;
			where.push(`(LOWER(m.symbol) = LOWER($${idx}) OR LOWER(c.symbol) = LOWER($${idx}))`);
		}
		if (nameSearch) {
			const trimmed = nameSearch.trim();
			if (trimmed.length >= MIN_NAME_SEARCH_LEN) {
				const bounded = trimmed.slice(0, MAX_NAME_SEARCH_LEN);
				push("m.name ILIKE $$ ESCAPE '\\'", `%${escapeIlikeLiteral(bounded)}%`);
			}
			// Sub-min-length searches are silently dropped — better than
			// returning the full table for a single-character query.
		}
		if (minSupplyRaw) {
			push('s.current_supply >= $$', minSupplyRaw);
		}
		if (crc20Param === 'true') {
			where.push('c.category IS NOT NULL');
		} else if (crc20Param === 'canonical') {
			where.push('c.is_canonical = true');
		} else if (crc20Param === 'noncanonical') {
			where.push('c.category IS NOT NULL AND c.is_canonical = false');
		}

		const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

		const dataSql = `
			SELECT
				t.category,
				t.token_type,
				t.genesis_block,
				t.genesis_time,
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
				encode(imo.content_hash, 'hex') AS icon_cleared_hash,
				(c.category IS NOT NULL) AS is_crc20,
				c.symbol           AS crc20_symbol,
				c.symbol_is_hex    AS crc20_symbol_is_hex,
				c.is_canonical     AS crc20_is_canonical,
				c.name             AS crc20_name
			FROM tokens t
			LEFT JOIN token_metadata m ON m.category = t.category
			LEFT JOIN token_state s    ON s.category = t.category
			LEFT JOIN token_crc20 c    ON c.category = t.category
			LEFT JOIN icon_url_scan ius ON ius.icon_uri = m.icon_uri
			LEFT JOIN icon_moderation imo
				ON imo.content_hash = ius.content_hash AND imo.state = 'cleared'
			${whereClause}
			ORDER BY ${sort}
			LIMIT $${values.length + 1} OFFSET $${values.length + 2}
		`;
		const dataRes = await query<DbRow>(dataSql, [...values, limit, offset]);

		// Skip the expensive COUNT(*) when the page wasn't filled — we
		// already know the exact total in that case (it's offset + page
		// length). Saves a full filtered-join scan on every page-1 request
		// that returns < limit rows, which is the common case for
		// narrowing filters / search queries.
		let total: number;
		if (dataRes.rowCount !== null && dataRes.rowCount < limit) {
			total = offset + dataRes.rowCount;
		} else {
			const countSql = `
				SELECT COUNT(*)::bigint AS total
				FROM tokens t
				LEFT JOIN token_metadata m ON m.category = t.category
				LEFT JOIN token_state s    ON s.category = t.category
				LEFT JOIN token_crc20 c    ON c.category = t.category
				${whereClause}
			`;
			const countRes = await query<{ total: string }>(countSql, values);
			total = Number(countRes.rows[0]?.total ?? 0);
		}

		// First-10 CashTokens-ever lookup. Lazy-cached in-process; the
		// underlying SQL fires exactly once per server boot.
		const firstNMap = await getFirstNMap();

		const tokens: TokenApiRow[] = dataRes.rows.map((row) => {
			const verifiedAt = row.verified_at?.getTime() ?? null;
			const firstSeenAt = Math.floor(row.first_seen_at.getTime() / 1000);
			const genesisTime = Math.floor(row.genesis_time.getTime() / 1000);
			const categoryHex = hexFromBytes(row.category)!;
			const firstNRank = firstNMap.get(categoryHex) ?? null;
			const metaAt = row.metadata_fetched_at?.getTime();
			const updatedAtMs = Math.max(
				verifiedAt ?? 0,
				metaAt ?? 0,
				row.first_seen_at.getTime()
			);
			return {
				id: categoryHex,
				name: row.name,
				symbol: row.symbol,
				decimals: row.decimals ?? 0,
				description: row.description,
				icon: row.icon_uri,
				iconClearedHash: row.icon_cleared_hash ?? null,
				tokenType: row.token_type,
				isVerifiedOnchain: row.verified_at !== null,
				isFullyBurned: row.is_fully_burned ?? false,
				currentSupply: row.current_supply ?? null,
				liveUtxoCount: row.live_utxo_count,
				liveNftCount: row.live_nft_count,
				holderCount: row.holder_count,
				hasActiveMinting: row.has_active_minting ?? false,
				firstSeenAt,
				genesisTime,
				firstNRank,
				genesisBlock: row.genesis_block,
				updatedAt: Math.floor(updatedAtMs / 1000),
				isCrc20: row.is_crc20 === true,
				crc20Symbol: row.crc20_symbol ?? null,
				crc20SymbolIsHex: row.crc20_symbol_is_hex === true,
				crc20IsCanonical: row.crc20_is_canonical === true,
				crc20Name: row.crc20_name ?? null
			};
		});

		if (isCsv) {
			// `attachment` so browsers save it instead of rendering as
			// text. Filename is timestamped to avoid collisions across
			// repeated exports. UTF-8 BOM prefix so Excel doesn't mangle
			// non-ASCII names (most BCMR names are ASCII; emoji-bearing
			// ones used to render as `Ã©` etc. without the BOM).
			const date = new Date().toISOString().slice(0, 10);
			const body = '﻿' + tokensToCsv(tokens);
			return new Response(body, {
				status: 200,
				headers: {
					'content-type': 'text/csv; charset=utf-8',
					'content-disposition': `attachment; filename="tokenstork-${date}.csv"`
				}
			});
		}

		return json({
			tokens,
			count: tokens.length,
			limit,
			offset,
			total
		});
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[api/tokens] error:', err);
		error(500, 'Failed to fetch tokens');
	}
};
