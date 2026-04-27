// Directory home. SSR-loads the first page of tokens from Postgres
// directly (no /api/tokens round trip — the app and DB share a process).

import { query, hexFromBytes } from '$lib/server/db';
import { computeMcapTvlThresholdSats } from '$lib/server/mcapThreshold';
import { getMovers24h } from '$lib/server/movers';
import { NOT_MODERATED_CLAUSE } from '$lib/moderation';
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
	tapswap_listing_count: string | null;
	fex_price_sats: number | null;
	fex_tvl_satoshis: string | null;
	// History-derived: nearest-older price-point per window. Nullable when
	// history hasn't accumulated far enough back (early-days-of-deploy case).
	price_sats_1h_ago: number | null;
	price_sats_24h_ago: number | null;
	price_sats_7d_ago: number | null;
	// Last-7d points as a Postgres double-precision array, oldest first.
	sparkline_points: number[] | null;
	// Icon safety pipeline (item #22): hex of the cleared content hash
	// for this token's icon, or NULL if the icon hasn't been scanned and
	// cleared. Drives the placeholder vs /icons/<hash>.webp decision in
	// the UI helper $lib/icons.ts#iconHrefFor.
	icon_cleared_hash: string | null;
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

// Default sort: TVL desc. The directory used to open name-sorted, which
// surfaced every empty / emoji token first and pushed the actually-traded
// ones deep. TVL-default matches aggregator convention (CoinGecko, etc.)
// and makes the site useful on first paint.
const DEFAULT_SORT = 'tvl';

const PAGE_SIZE = 100;

export const load: PageServerLoad = async ({ url }) => {
	const sortKey = url.searchParams.get('sort') ?? DEFAULT_SORT;
	const sort = VALID_SORTS[sortKey] ?? VALID_SORTS[DEFAULT_SORT];
	const typeParam = url.searchParams.get('type');
	const onlyCauldron = url.searchParams.get('cauldron') === '1';
	const onlyTapswap = url.searchParams.get('tapswap') === '1';
	const onlyFex = url.searchParams.get('fex') === '1';
	const onlyNew24h = url.searchParams.get('new24h') === '1';
	const onlyNew7d = url.searchParams.get('new7d') === '1';
	const onlyNew30d = url.searchParams.get('new30d') === '1';
	// ?listed=1 — tokens with presence on any venue (Cauldron OR Tapswap).
	// Powers the Listed pill in MetricsBar, which matches the same
	// universe that `listedCount` reports in the layout load.
	const onlyListed = url.searchParams.get('listed') === '1';
	const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);

	const search = (url.searchParams.get('search') ?? '').trim();
	const searchLimited = search.slice(0, 128);

	// Moderation filter is always on — categories in token_moderation are
	// hidden from the directory, the public API, the stats counters, and
	// all search / filter / sort modes. Underlying tokens rows are left
	// in place; a DELETE from token_moderation un-hides. Fragment lives
	// in $lib/moderation so every read path shares one source of truth.
	const where: string[] = [NOT_MODERATED_CLAUSE];
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
	if (onlyTapswap) {
		// Same idiom as cauldron: promote the LEFT JOIN to effective INNER
		// when the filter is active. `has_category IS NOT NULL` catches the
		// has-side listings — someone is SELLING this token on Tapswap.
		where.push(`vl_tapswap.category IS NOT NULL`);
	}
	if (onlyFex) {
		// Same pattern as cauldron: vl_fex is a LEFT JOIN on
		// token_venue_listings filtered by venue='fex'; the filter flips
		// it into an effective INNER by requiring IS NOT NULL.
		where.push(`vl_fex.category IS NOT NULL`);
	}
	// "New within window" filters. Three independent URL params rather
	// than one `new=24h` value so the existing `?new24h=1` links in
	// MetricsBar + /stats cards stay live without a migration. When more
	// than one is set at once, the tightest window wins via interval
	// comparison — unlikely in practice, harmless if it happens.
	if (onlyNew24h) {
		where.push(`t.genesis_time > now() - INTERVAL '24 hours'`);
	}
	if (onlyNew7d) {
		where.push(`t.genesis_time > now() - INTERVAL '7 days'`);
	}
	if (onlyNew30d) {
		where.push(`t.genesis_time > now() - INTERVAL '30 days'`);
	}
	if (onlyListed) {
		// On any venue: Cauldron OR Tapswap OR Fex LEFT JOIN hit. All
		// three use IS NOT NULL against the LEFT-JOINed sources further
		// down, which cost nothing extra because those joins are always
		// part of the fromJoins block regardless of the filter.
		where.push(
			`(vl_cauldron.category IS NOT NULL
			  OR vl_tapswap.category IS NOT NULL
			  OR vl_fex.category IS NOT NULL)`
		);
	}
	// When a free-form search is active, prepend a similarity-DESC fragment
	// to the ORDER BY so best fuzzy matches surface first. The user's
	// selected sort breaks ties within each similarity tier. Stays empty
	// for hex-paste queries (single-row result) and no-search queries.
	let searchOrderPrefix = '';
	if (searchLimited) {
		// A full 64-char hex query is almost always a paste of a category ID
		// the user wants the exact page for — short-circuit to a direct BYTEA
		// lookup instead of falling back to substring matching (which would
		// work but is needlessly expensive).
		if (/^[0-9a-fA-F]{64}$/.test(searchLimited)) {
			values.push(Buffer.from(searchLimited.toLowerCase(), 'hex'));
			where.push(`t.category = $${values.length}`);
		} else {
			// Free-form query. Three bind values:
			//   $q      — raw query for trigram similarity (m.name % $q +
			//             ORDER BY similarity()). Uses the GIN
			//             `token_metadata_name_trgm` index. Default 0.3
			//             threshold means "grm" → "GRIM" (sim 0.375),
			//             "suhi" → "sushi" (sim 0.44), but a much-typo'd
			//             "stbl" → "stable" doesn't (sim 0.17, below
			//             threshold) — acceptable.
			//   pat     — %-wrapped pattern for ILIKE on symbol +
			//             description (no trigram indexes on those, but at
			//             10-20k rows the seq scan is sub-10ms).
			//   patLower — lowercased pattern for hex-substring match on
			//             category (so a partial hex paste like "d29eb"
			//             still matches).
			// OR'd together: typo-tolerant on name, exact-substring on the
			// other fields. The trigram match also catches name typos that
			// ILIKE would miss.
			values.push(searchLimited);
			const qIdx = values.length;
			values.push(`%${searchLimited}%`);
			const pat = `$${values.length}`;
			values.push(`%${searchLimited.toLowerCase()}%`);
			const patLower = `$${values.length}`;
			where.push(
				`(m.name ILIKE ${pat}
				  OR m.symbol ILIKE ${pat}
				  OR m.description ILIKE ${pat}
				  OR encode(t.category, 'hex') LIKE ${patLower}
				  OR m.name % $${qIdx})`
			);
			searchOrderPrefix = `similarity(m.name, $${qIdx}) DESC NULLS LAST, `;
		}
	}
	const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

	// vl_cauldron: one row per (venue, category) in token_venue_listings.
	// vl_tapswap: an aggregate subquery — Tapswap has many offers per
	// category (N rows in tapswap_offers → 1 row here). We expose
	// listing_count to the UI; floor-ask aggregation is deferred to a
	// follow-up because FT/NFT listings aren't comparable on a single axis.
	//
	// Both are LEFT JOINs: rows missing from a venue table still appear in
	// the directory. When a "onlyX" filter is active, the WHERE clause
	// promotes the LEFT JOIN to an effective INNER via `IS NOT NULL`.
	// Price-history lookups use LEFT JOIN LATERAL rather than correlated
	// subqueries in the SELECT list so Postgres plans them once per row
	// against the (category, venue, ts DESC) index — one index seek per
	// lookup, no sort. Each lateral returns at most one row.
	//
	// The sparkline subquery array-aggs last-7d points oldest-first. For
	// an unlisted token this is an empty array (LEFT JOIN + array_agg
	// returns NULL, mapped to [] at the TS boundary). Postgres streams
	// the 42-ish doubles directly; no meaningful cost at this scale.
	const fromJoins = `
		FROM tokens t
		LEFT JOIN token_metadata m ON m.category = t.category
		LEFT JOIN token_state    s ON s.category = t.category
		LEFT JOIN token_venue_listings vl_cauldron
			ON vl_cauldron.category = t.category AND vl_cauldron.venue = 'cauldron'
		LEFT JOIN token_venue_listings vl_fex
			ON vl_fex.category = t.category AND vl_fex.venue = 'fex'
		LEFT JOIN (
			-- Defense-in-depth: exclude moderated categories inside the
			-- subquery too. The outer WHERE already filters them out via
			-- NOT_MODERATED_CLAUSE so nothing leaks today, but pushing the
			-- filter into the aggregation keeps moderated tokens' offers
			-- out of the COUNT even if a future refactor drops the outer
			-- guard.
			SELECT has_category AS category, COUNT(*)::bigint AS listing_count
			  FROM tapswap_offers o
			 WHERE o.status = 'open'
			   AND o.has_category IS NOT NULL
			   AND NOT EXISTS (
			     SELECT 1 FROM token_moderation mod WHERE mod.category = o.has_category
			   )
			 GROUP BY has_category
		) vl_tapswap ON vl_tapswap.category = t.category
		LEFT JOIN LATERAL (
			SELECT price_sats FROM token_price_history
			 WHERE category = t.category AND venue = 'cauldron'
			   AND ts <= now() - INTERVAL '1 hour'
			 ORDER BY ts DESC LIMIT 1
		) ph_1h ON true
		LEFT JOIN LATERAL (
			SELECT price_sats FROM token_price_history
			 WHERE category = t.category AND venue = 'cauldron'
			   AND ts <= now() - INTERVAL '24 hours'
			 ORDER BY ts DESC LIMIT 1
		) ph_24h ON true
		LEFT JOIN LATERAL (
			SELECT price_sats FROM token_price_history
			 WHERE category = t.category AND venue = 'cauldron'
			   AND ts <= now() - INTERVAL '7 days'
			 ORDER BY ts DESC LIMIT 1
		) ph_7d ON true
		LEFT JOIN LATERAL (
			SELECT array_agg(price_sats ORDER BY ts) AS points
			  FROM token_price_history
			 WHERE category = t.category AND venue = 'cauldron'
			   AND ts > now() - INTERVAL '7 days'
		) ph_spark ON true
		-- Icon safety pipeline (item #22): chain through icon_url_scan and
		-- icon_moderation to surface a per-token cleared-hash. The
		-- state=cleared predicate on the JOIN makes the column NULL for
		-- any URL that was not scanned, was blocked, or is in review.
		-- Default-deny: UI renders the placeholder unless this is non-null.
		LEFT JOIN icon_url_scan ius ON ius.icon_uri = m.icon_uri
		LEFT JOIN icon_moderation imo
			ON imo.content_hash = ius.content_hash
			AND imo.state = 'cleared'
	`;

	try {
		const [countRes, mcapTvlThresholdSats] = await Promise.all([
			query<{ total: string }>(
				`SELECT COUNT(*)::bigint AS total ${fromJoins} ${whereClause}`,
				values
			),
			computeMcapTvlThresholdSats()
		]);
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
				vl_cauldron.tvl_satoshis::text AS cauldron_tvl_satoshis,
				vl_tapswap.listing_count::text AS tapswap_listing_count,
				vl_fex.price_sats         AS fex_price_sats,
				vl_fex.tvl_satoshis::text AS fex_tvl_satoshis,
				ph_1h.price_sats   AS price_sats_1h_ago,
				ph_24h.price_sats  AS price_sats_24h_ago,
				ph_7d.price_sats   AS price_sats_7d_ago,
				ph_spark.points    AS sparkline_points,
				encode(imo.content_hash, 'hex') AS icon_cleared_hash
			   ${fromJoins}
			   ${whereClause}
			   ORDER BY ${searchOrderPrefix}${sort}
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
			let fexTvl: number | null = null;
			if (row.fex_tvl_satoshis != null) {
				const parsed = Number(row.fex_tvl_satoshis);
				if (Number.isFinite(parsed)) fexTvl = parsed;
			}

			// Compute % change server-side rather than shipping two prices
			// per window. A window is null-safe: if either end is missing
			// the % is null and the UI renders a placeholder. Skip divide-
			// by-zero when the older price was zero (happens if a venue
			// briefly reported 0; shouldn't recur but defensive).
			const pct = (oldP: number | null): number | null => {
				const now = row.cauldron_price_sats;
				if (now == null || oldP == null || oldP === 0) return null;
				return ((now - oldP) / oldP) * 100;
			};
			const priceChange1hPct = pct(row.price_sats_1h_ago);
			const priceChange24hPct = pct(row.price_sats_24h_ago);
			const priceChange7dPct = pct(row.price_sats_7d_ago);
			const sparklinePoints = Array.isArray(row.sparkline_points)
				? row.sparkline_points.filter((n) => Number.isFinite(n))
				: [];
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
				cauldronTvlSatoshis: tvl,
				tapswapListingCount: row.tapswap_listing_count
					? Number(row.tapswap_listing_count)
					: 0,
				fexPriceSats: row.fex_price_sats,
				fexTvlSatoshis: fexTvl,
				priceChange1hPct,
				priceChange24hPct,
				priceChange7dPct,
				sparklinePoints,
				iconClearedHash: row.icon_cleared_hash ?? null
			};
		});

		// 24h movers — fired in parallel-ish via getMovers24h(), which has its
		// own internal try/catch so a movers query failure degrades to an
		// empty card on the page rather than a homepage error.
		const movers = await getMovers24h();

		return {
			tokens,
			total,
			limit: PAGE_SIZE,
			offset,
			mcapTvlThresholdSats,
			movers,
			error: null
		};
	} catch (err) {
		console.error('[+page.server] load failed:', err);
		return {
			tokens: [],
			total: 0,
			limit: PAGE_SIZE,
			offset: 0,
			mcapTvlThresholdSats: 0,
			movers: { topGainers24h: [], topLosers24h: [], topTvlMovers24h: [], has24hHistory: false },
			error: 'Directory is temporarily unavailable.'
		};
	}
};
