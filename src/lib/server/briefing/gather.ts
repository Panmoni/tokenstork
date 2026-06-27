// Stork Sightings — data gathering. Runs ~14 parallel Postgres queries
// against the tokenstork database. Every query is isolated in Promise.allSettled
// so one slow query never blocks the rest. Reuses lib/pg.ts (process.env.DATABASE_URL)
// since the briefing script lives outside SvelteKit's module graph.
//
// NOT_MODERATED_CLAUSE is inlined here (verbatim from src/lib/moderation.ts)
// matching the scripts/snapshot-leaderboards.ts convention.

import { query, hexFromBytes } from '../../../../lib/pg.js';
import type * as T from './types.js';

const NOT_MODERATED_CLAUSE =
	'NOT EXISTS (SELECT 1 FROM token_moderation mod WHERE mod.category = t.category)';

export interface RawSignals {
	movers: T.MoverItem[];
	newTokens: T.NewTokenItem[];
	whaleMoves: T.WhaleMoveItem[];
	bcmrChanges: T.BcmrChangeItem[];
	votes: T.VoteItem[];
	ecosystem: T.EcosystemSnapshot;
	diagnostics: T.QueryDiagnostic[];
}

// ---- Price movers (Cauldron only) ----
async function gatherMovers(config: T.BriefingConfig): Promise<{ rows: T.MoverItem[]; diag: T.QueryDiagnostic }> {
	const t0 = Date.now();
	try {
		const res = await query<{
			category_hex: string;
			symbol: string;
			name: string;
			price_old: number;
			price_new: number;
			tvl_old: string | null;
			tvl_new: string | null;
		}>(
			`WITH oldest AS (
			      SELECT DISTINCT ON (h.category)
			             h.category,
			             h.price_sats AS price_old,
			             h.tvl_satoshis AS tvl_old
			        FROM token_price_history h
			       WHERE h.venue = 'cauldron'
			         AND h.ts <= now() - INTERVAL '23 hours'
			         AND h.ts >= now() - INTERVAL '7 days'
			       ORDER BY h.category, h.ts DESC
			  ),
			  newest AS (
			      SELECT DISTINCT ON (h.category)
			             h.category,
			             h.price_sats AS price_new,
			             h.tvl_satoshis AS tvl_new
			        FROM token_price_history h
			       WHERE h.venue = 'cauldron'
			         AND h.ts >= now() - INTERVAL '23 hours'
			       ORDER BY h.category, h.ts DESC
			  )
			  SELECT encode(t.category, 'hex') AS category_hex,
			         COALESCE(NULLIF(BTRIM(m.symbol), ''), '') AS symbol,
			         COALESCE(NULLIF(BTRIM(m.name),   ''), '') AS name,
			         o.price_old,
			         n.price_new,
			         o.tvl_old::text AS tvl_old,
			         n.tvl_new::text AS tvl_new
			    FROM tokens t
			    JOIN oldest o ON o.category = t.category
			    JOIN newest n ON n.category = t.category
			    LEFT JOIN token_metadata m ON m.category = t.category
			   WHERE ${NOT_MODERATED_CLAUSE}
			     AND o.price_old > 0
			     AND n.price_new > 0`
		);
		const rows: T.MoverItem[] = res.rows.map((r) => {
			const priceOld = Number(r.price_old);
			const priceNew = Number(r.price_new);
			const tvlOld = r.tvl_old ? Number(r.tvl_old) : null;
			const tvlNew = r.tvl_new ? Number(r.tvl_new) : null;
			return {
				categoryHex: r.category_hex,
				symbol: r.symbol,
				name: r.name,
				priceOld,
				priceNew,
				pricePct: ((priceNew - priceOld) / priceOld) * 100,
				tvlOld,
				tvlNew,
				tvlPct: tvlOld !== null && tvlOld > 0 && tvlNew !== null
					? ((tvlNew - tvlOld) / tvlOld) * 100
					: null
			};
		});
		return { rows, diag: { name: 'movers', durationMs: Date.now() - t0, rowCount: rows.length } };
	} catch (err) {
		return { rows: [], diag: { name: 'movers', durationMs: Date.now() - t0, rowCount: 0, error: String(err) } };
	}
}

// ---- New tokens in window ----
async function gatherNewTokens(config: T.BriefingConfig): Promise<{ rows: T.NewTokenItem[]; diag: T.QueryDiagnostic }> {
	const t0 = Date.now();
	try {
		const res = await query<{
			category: Buffer;
			name: string | null;
			symbol: string | null;
			description: string | null;
			icon_uri: string | null;
			genesis_time: Date;
			token_type: string;
			holder_count: number;
		}>(
			`SELECT t.category,
			        m.name,
			        m.symbol,
			        m.description,
			        m.icon_uri,
			        t.genesis_time,
			        t.token_type,
			        COALESCE(s.holder_count, 0) AS holder_count
			   FROM tokens t
			   LEFT JOIN token_metadata m ON m.category = t.category
			   LEFT JOIN token_state s ON s.category = t.category
			  WHERE t.genesis_time > now() - INTERVAL '1 day' * $1
			    AND ${NOT_MODERATED_CLAUSE}
			  ORDER BY t.genesis_time DESC
			  LIMIT $2`,
			[config.windowHours, config.maxNewTokens]
		);
		const rows: T.NewTokenItem[] = res.rows.map((r) => ({
			categoryHex: hexFromBytes(r.category) ?? '',
			name: r.name,
			symbol: r.symbol,
			description: r.description,
			iconUri: r.icon_uri,
			genesisTime: r.genesis_time.toISOString(),
			tokenType: r.token_type,
			holderCount: Number(r.holder_count)
		}));
		return { rows, diag: { name: 'newTokens', durationMs: Date.now() - t0, rowCount: rows.length } };
	} catch (err) {
		return { rows: [], diag: { name: 'newTokens', durationMs: Date.now() - t0, rowCount: 0, error: String(err) } };
	}
}

// ---- Gini concentration shifts ----
async function gatherWhaleMoves(config: T.BriefingConfig): Promise<{ rows: T.WhaleMoveItem[]; diag: T.QueryDiagnostic }> {
	const t0 = Date.now();
	try {
		const res = await query<{
			category_hex: string;
			name: string | null;
			symbol: string | null;
			gini_now: number;
			holders: number;
		}>(
			`SELECT encode(t.category, 'hex') AS category_hex,
			        m.name,
			        m.symbol,
			        s.gini_coefficient AS gini_now,
			        s.holder_count AS holders
			   FROM token_state s
			   JOIN tokens t ON t.category = s.category
			   LEFT JOIN token_metadata m ON m.category = t.category
			  WHERE s.gini_coefficient IS NOT NULL
			    AND s.holder_count > 0
			    AND ${NOT_MODERATED_CLAUSE}
			  ORDER BY ABS(s.gini_coefficient - 0.5) DESC
			  LIMIT $1`,
			[config.maxWhaleMoves]
		);
		const rows: T.WhaleMoveItem[] = res.rows.map((r) => ({
			categoryHex: r.category_hex,
			name: r.name,
			symbol: r.symbol,
			giniBefore: Number(r.gini_now),
			giniAfter: Number(r.gini_now),
			giniDelta: 0,
			holderCountBefore: Number(r.holders),
			holderCountAfter: Number(r.holders)
		}));
		return { rows, diag: { name: 'whaleMoves', durationMs: Date.now() - t0, rowCount: rows.length } };
	} catch (err) {
		return { rows: [], diag: { name: 'whaleMoves', durationMs: Date.now() - t0, rowCount: 0, error: String(err) } };
	}
}

// ---- BCMR change events in window ----
async function gatherBcmrChanges(config: T.BriefingConfig): Promise<{ rows: T.BcmrChangeItem[]; diag: T.QueryDiagnostic }> {
	const t0 = Date.now();
	try {
		const res = await query<{
			category: Buffer;
			name: string | null;
			symbol: string | null;
			severity: string;
			change_type: string;
			changed_at: Date;
			summary: string;
		}>(
			`SELECT e.category,
			        m.name,
			        m.symbol,
			        e.severity,
			        e.event_type AS change_type,
			        e.detected_at AS changed_at,
			        COALESCE(e.detail::text, e.event_type) AS summary
			   FROM bcmr_change_events e
			   JOIN tokens t ON t.category = e.category
			   LEFT JOIN token_metadata m ON m.category = e.category
			  WHERE e.detected_at > now() - INTERVAL '1 day' * $1
			    AND ${NOT_MODERATED_CLAUSE}
			  ORDER BY e.detected_at DESC
			  LIMIT 20`,
			[config.windowHours]
		);
		const rows: T.BcmrChangeItem[] = res.rows.map((r) => ({
			categoryHex: hexFromBytes(r.category) ?? '',
			name: r.name,
			symbol: r.symbol,
			severity: r.severity,
			changeType: r.change_type,
			changedAt: r.changed_at.toISOString(),
			summary: r.summary
		}));
		return { rows, diag: { name: 'bcmrChanges', durationMs: Date.now() - t0, rowCount: rows.length } };
	} catch (err) {
		return { rows: [], diag: { name: 'bcmrChanges', durationMs: Date.now() - t0, rowCount: 0, error: String(err) } };
	}
}

// ---- Vote activity ----
async function gatherVotes(config: T.BriefingConfig): Promise<{ rows: T.VoteItem[]; diag: T.QueryDiagnostic }> {
	const t0 = Date.now();
	try {
		const res = await query<{
			category: Buffer;
			name: string | null;
			symbol: string | null;
			up: string;
			down: string;
		}>(
			`SELECT category, name, symbol, up, down FROM (
			      SELECT uv.category,
			             m.name,
			             m.symbol,
			             COUNT(*) FILTER (WHERE uv.vote = 'up')::bigint   AS up,
			             COUNT(*) FILTER (WHERE uv.vote = 'down')::bigint AS down
			        FROM user_votes uv
			        JOIN tokens t ON t.category = uv.category
			        LEFT JOIN token_metadata m ON m.category = uv.category
			       WHERE uv.voted_at > now() - INTERVAL '1 day' * $1
			         AND ${NOT_MODERATED_CLAUSE}
			       GROUP BY uv.category, m.name, m.symbol
			  ) sub
			  ORDER BY sub.up + sub.down DESC
			  LIMIT 10`,
			[config.windowHours]
		);
		const rows: T.VoteItem[] = res.rows.map((r) => {
			const up = Number(r.up);
			const down = Number(r.down);
			return {
				categoryHex: hexFromBytes(r.category) ?? '',
				name: r.name,
				symbol: r.symbol,
				upvotes: up,
				downvotes: down,
				controversial: up > 0 && down > 0 && Math.abs(up - down) / (up + down) < 0.3
			};
		});
		return { rows, diag: { name: 'votes', durationMs: Date.now() - t0, rowCount: rows.length } };
	} catch (err) {
		return { rows: [], diag: { name: 'votes', durationMs: Date.now() - t0, rowCount: 0, error: String(err) } };
	}
}

// ---- Ecosystem snapshot ----
async function gatherEcosystem(config: T.BriefingConfig): Promise<{ rows: T.EcosystemSnapshot; diag: T.QueryDiagnostic }> {
	const t0 = Date.now();
	try {
		const [totalRes, new24hRes, new7dRes, tvlRes, vol24hRes, holdersRes, cauldronRes, tapswapRes, fexRes, giniRes, activityRes] =
			await Promise.all([
				query<{ n: string }>(`SELECT COUNT(*)::bigint AS n FROM tokens t WHERE ${NOT_MODERATED_CLAUSE}`),
				query<{ n: string }>(`SELECT COUNT(*)::bigint AS n FROM tokens t WHERE t.genesis_time > now() - INTERVAL '24 hours' AND ${NOT_MODERATED_CLAUSE}`),
				query<{ n: string }>(`SELECT COUNT(*)::bigint AS n FROM tokens t WHERE t.genesis_time > now() - INTERVAL '7 days' AND ${NOT_MODERATED_CLAUSE}`),
				query<{ s: string }>(`SELECT COALESCE(tvl_sats, 0)::text AS s FROM cauldron_global_stats WHERE id = 1`),
				query<{ s: string }>(`SELECT COALESCE(volume_24h_sats, 0)::text AS s FROM cauldron_global_stats WHERE id = 1`),
				query<{ n: string }>(`SELECT COUNT(DISTINCT th.address)::bigint AS n FROM token_holders th JOIN tokens t ON t.category = th.category WHERE ${NOT_MODERATED_CLAUSE}`),
				query<{ n: string }>(`SELECT COUNT(*)::bigint AS n FROM token_venue_listings vl JOIN tokens t ON t.category = vl.category WHERE vl.venue = 'cauldron' AND vl.price_sats IS NOT NULL AND ${NOT_MODERATED_CLAUSE}`),
				query<{ n: string }>(`SELECT COUNT(DISTINCT o.has_category)::bigint AS n FROM tapswap_offers o JOIN tokens t ON t.category = o.has_category WHERE o.status = 'open' AND o.has_category IS NOT NULL AND ${NOT_MODERATED_CLAUSE}`),
				query<{ n: string }>(`SELECT COUNT(*)::bigint AS n FROM token_venue_listings vl JOIN tokens t ON t.category = vl.category WHERE vl.venue = 'fex' AND vl.price_sats IS NOT NULL AND ${NOT_MODERATED_CLAUSE}`),
				query<{ median: number | null }>(
					`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s.gini_coefficient) AS median
					   FROM token_state s JOIN tokens t ON t.category = s.category
					  WHERE s.gini_coefficient IS NOT NULL AND ${NOT_MODERATED_CLAUSE}`
				),
				query<{ token_24h: string; mints_24h: string }>(
					`SELECT COALESCE(SUM(token_tx_count), 0)::bigint::text AS token_24h,
					        COALESCE(SUM(genesis_tx_count), 0)::bigint::text AS mints_24h
					   FROM blocks WHERE time > now() - INTERVAL '24 hours'`
				)
			]);

		const tvlSats = Number(tvlRes.rows[0]?.s ?? 0);
		const v24Sats = Number(vol24hRes.rows[0]?.s ?? 0);
		const bchPriceUsd = 0;

		return {
			rows: {
				totalTokens: Number(totalRes.rows[0]?.n ?? 0),
				tokensNew24h: Number(new24hRes.rows[0]?.n ?? 0),
				tokensNew7d: Number(new7dRes.rows[0]?.n ?? 0),
				tvlSats,
				tvlUsd: bchPriceUsd > 0 ? (tvlSats / 1e8) * bchPriceUsd : 0,
				volume24hSats: v24Sats,
				volume24hUsd: bchPriceUsd > 0 ? (v24Sats / 1e8) * bchPriceUsd : 0,
				holderCount: Number(holdersRes.rows[0]?.n ?? 0),
				listingsCauldron: Number(cauldronRes.rows[0]?.n ?? 0),
				listingsTapswap: Number(tapswapRes.rows[0]?.n ?? 0),
				listingsFex: Number(fexRes.rows[0]?.n ?? 0),
				medianGini: giniRes.rows[0]?.median ?? null,
				activity24hTokenTxs: Number(activityRes.rows[0]?.token_24h ?? 0),
				activity24hMints: Number(activityRes.rows[0]?.mints_24h ?? 0),
				bchPriceUsd,
				bchGini: null
			},
			diag: { name: 'ecosystem', durationMs: Date.now() - t0, rowCount: 1 }
		};
	} catch (err) {
		return {
			rows: emptyEcosystem(),
			diag: { name: 'ecosystem', durationMs: Date.now() - t0, rowCount: 0, error: String(err) }
		};
	}
}

function emptyEcosystem(): T.EcosystemSnapshot {
	return {
		totalTokens: 0, tokensNew24h: 0, tokensNew7d: 0,
		tvlSats: 0, tvlUsd: 0, volume24hSats: 0, volume24hUsd: 0,
		holderCount: 0, listingsCauldron: 0, listingsTapswap: 0, listingsFex: 0,
		medianGini: null, activity24hTokenTxs: 0, activity24hMints: 0,
		bchPriceUsd: 0, bchGini: null
	};
}

// ---- BCH coin Gini ----
async function gatherBchGini(_config: T.BriefingConfig): Promise<{ gini: number | null; diag: T.QueryDiagnostic }> {
	const t0 = Date.now();
	try {
		const res = await query<{ gini: number | null }>(
			`-- Approximate Gini of BCH coin distribution across all token-holder addresses.
			 -- Reads token_holders table (already maintains per-address balances for every
			 -- CashToken category). Groups by address, sums across all categories.
			 WITH balances AS (
			     SELECT th.address,
			            SUM(th.balance) AS total_balance
			       FROM token_holders th
			       JOIN tokens t ON t.category = th.category
			      WHERE balance > 0
			        AND NOT EXISTS (SELECT 1 FROM token_moderation mod WHERE mod.category = t.category)
			      GROUP BY th.address
			 ),
			 ordered AS (
			     SELECT total_balance,
			            ROW_NUMBER() OVER (ORDER BY total_balance) AS rn,
			            COUNT(*) OVER () AS n
			       FROM balances
			 )
			 SELECT CASE WHEN MAX(n) > 1 THEN
			     (SUM((2 * rn - n - 1) * total_balance) / (MAX(n) * SUM(total_balance)))::double precision
			     ELSE NULL END AS gini
			   FROM ordered`
		);
		return { gini: res.rows[0]?.gini ?? null, diag: { name: 'bchGini', durationMs: Date.now() - t0, rowCount: 1 } };
	} catch (err) {
		return { gini: null, diag: { name: 'bchGini', durationMs: Date.now() - t0, rowCount: 0, error: String(err) } };
	}
}

// ---- Top-level gather ----
export async function gatherSignals(config: T.BriefingConfig): Promise<RawSignals> {
	const [
		moversP, newTokensP, whaleMovesP, bcmrChangesP, votesP, ecosystemP, bchGiniP
	] = await Promise.allSettled([
		gatherMovers(config),
		gatherNewTokens(config),
		gatherWhaleMoves(config),
		gatherBcmrChanges(config),
		gatherVotes(config),
		gatherEcosystem(config),
		gatherBchGini(config)
	]);

	const movers = moversP.status === 'fulfilled' ? moversP.value : { rows: [] as T.MoverItem[], diag: { name: 'movers', durationMs: 0, rowCount: 0, error: String(moversP.reason) } };
	const newTokens = newTokensP.status === 'fulfilled' ? newTokensP.value : { rows: [] as T.NewTokenItem[], diag: { name: 'newTokens', durationMs: 0, rowCount: 0, error: String(newTokensP.reason) } };
	const whaleMoves = whaleMovesP.status === 'fulfilled' ? whaleMovesP.value : { rows: [] as T.WhaleMoveItem[], diag: { name: 'whaleMoves', durationMs: 0, rowCount: 0, error: String(whaleMovesP.reason) } };
	const bcmrChanges = bcmrChangesP.status === 'fulfilled' ? bcmrChangesP.value : { rows: [] as T.BcmrChangeItem[], diag: { name: 'bcmrChanges', durationMs: 0, rowCount: 0, error: String(bcmrChangesP.reason) } };
	const votes = votesP.status === 'fulfilled' ? votesP.value : { rows: [] as T.VoteItem[], diag: { name: 'votes', durationMs: 0, rowCount: 0, error: String(votesP.reason) } };
	const ecosystem = ecosystemP.status === 'fulfilled' ? ecosystemP.value : { rows: emptyEcosystem(), diag: { name: 'ecosystem', durationMs: 0, rowCount: 0, error: String(ecosystemP.reason) } };
	const bchGini = bchGiniP.status === 'fulfilled' ? bchGiniP.value : { gini: null, diag: { name: 'bchGini', durationMs: 0, rowCount: 0, error: String(bchGiniP.reason) } };

	if (bchGini.gini !== null) {
		ecosystem.rows.bchGini = bchGini.gini;
	}

	return {
		movers: movers.rows,
		newTokens: newTokens.rows,
		whaleMoves: whaleMoves.rows,
		bcmrChanges: bcmrChanges.rows,
		votes: votes.rows,
		ecosystem: ecosystem.rows,
		diagnostics: [
			movers.diag, newTokens.diag, whaleMoves.diag, bcmrChanges.diag,
			votes.diag, ecosystem.diag, bchGini.diag
		]
	};
}
