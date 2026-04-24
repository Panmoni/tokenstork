// /stats — headline numbers for the directory. Intentionally small until
// we have a concrete story for charts. Everything here is derived from the
// same tables the directory renders from; no external calls.
//
// `newIn24h` is sourced from the parent layout's load (+layout.server.ts)
// rather than re-queried here, so a visit to /stats doesn't run the same
// 24h count twice in one pageview. The 7d / 30d / type-split / burned
// counters remain local to this page — they aren't useful on every request.

import { query } from '$lib/server/db';
import { NOT_MODERATED_CLAUSE } from '$lib/moderation';
import type { PageServerLoad } from './$types';

interface TypeCount {
	token_type: 'FT' | 'NFT' | 'FT+NFT';
	total: string;
}

interface WindowCount {
	total: string;
}

export const load: PageServerLoad = async ({ parent }) => {
	const [parentData, pageResults] = await Promise.all([
		parent(),
		// Every counter excludes moderation-hidden categories via the shared
		// NOT_MODERATED_CLAUSE fragment ($lib/moderation). The burned count
		// joins through `tokens t` rather than reading `token_state` directly
		// so the same clause applies — a hidden-but-burned token shouldn't
		// inflate the counter.
		Promise.allSettled([
			query<TypeCount>(
				`SELECT t.token_type, COUNT(*)::bigint AS total
				   FROM tokens t
				  WHERE ${NOT_MODERATED_CLAUSE}
				  GROUP BY t.token_type`
			),
			// genesis_time is the on-chain block timestamp at which the category
			// first appeared — "token minted N days ago." `first_seen_at` is our
			// indexer's row-write time and would lump every category into the last
			// 24 hours right after a fresh backfill.
			query<WindowCount>(
				`SELECT COUNT(*)::bigint AS total
				   FROM tokens t
				  WHERE t.genesis_time > now() - INTERVAL '7 days'
				    AND ${NOT_MODERATED_CLAUSE}`
			),
			query<WindowCount>(
				`SELECT COUNT(*)::bigint AS total
				   FROM tokens t
				  WHERE t.genesis_time > now() - INTERVAL '30 days'
				    AND ${NOT_MODERATED_CLAUSE}`
			),
			// is_fully_burned comes from token_state, which is only populated
			// once BlockBook-backed enrichment runs. Until Phase 2d lands this
			// row is missing for every category — we handle it as null in the
			// UI and render an explanatory placeholder.
			query<WindowCount>(
				`SELECT COUNT(*)::bigint AS total
				   FROM tokens t
				   JOIN token_state s ON s.category = t.category
				  WHERE s.is_fully_burned = true
				    AND ${NOT_MODERATED_CLAUSE}`
			),
			// Distinct categories currently for sale on Tapswap (P2P).
			// Venues are now a visible axis in the stats — a separate card
			// lets visitors eyeball "how many tokens are actually tradeable."
			query<WindowCount>(
				`SELECT COUNT(DISTINCT o.has_category)::bigint AS total
				   FROM tapswap_offers o
				   JOIN tokens t ON t.category = o.has_category
				  WHERE o.status = 'open'
				    AND o.has_category IS NOT NULL
				    AND ${NOT_MODERATED_CLAUSE}`
			)
		])
	]);

	const [typesRes, d7Res, d30Res, burnedRes, tapswapCatsRes] = pageResults;

	const pickNumber = (r: PromiseSettledResult<{ rows: WindowCount[] }>): number =>
		r.status === 'fulfilled' ? Number(r.value.rows[0]?.total ?? 0) : 0;

	const byType: Record<'FT' | 'NFT' | 'FT+NFT', number> = { FT: 0, NFT: 0, 'FT+NFT': 0 };
	if (typesRes.status === 'fulfilled') {
		for (const row of typesRes.value.rows) byType[row.token_type] = Number(row.total);
	}

	const enrichmentReady = burnedRes.status === 'fulfilled';

	for (const r of [typesRes, d7Res, d30Res, burnedRes, tapswapCatsRes]) {
		if (r.status === 'rejected') console.error('[stats] metric query failed:', r.reason);
	}

	return {
		byType,
		newIn24h: parentData.newIn24h,
		newIn7d: pickNumber(d7Res),
		newIn30d: pickNumber(d30Res),
		burned: enrichmentReady ? pickNumber(burnedRes) : null,
		tapswapListedCategories: pickNumber(tapswapCatsRes)
	};
};
