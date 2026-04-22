// /stats — headline numbers for the directory. Intentionally small until
// we have a concrete story for charts. Everything here is derived from the
// same tables the directory renders from; no external calls.
//
// `newIn24h` is sourced from the parent layout's load (+layout.server.ts)
// rather than re-queried here, so a visit to /stats doesn't run the same
// 24h count twice in one pageview. The 7d / 30d / type-split / burned
// counters remain local to this page — they aren't useful on every request.

import { query } from '$lib/server/db';
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
		Promise.allSettled([
			query<TypeCount>(
				`SELECT token_type, COUNT(*)::bigint AS total
				   FROM tokens
				   GROUP BY token_type`
			),
			// genesis_time is the on-chain block timestamp at which the category
			// first appeared — "token minted N days ago." `first_seen_at` is our
			// indexer's row-write time and would lump every category into the last
			// 24 hours right after a fresh backfill.
			query<WindowCount>(
				`SELECT COUNT(*)::bigint AS total
				   FROM tokens
				   WHERE genesis_time > now() - INTERVAL '7 days'`
			),
			query<WindowCount>(
				`SELECT COUNT(*)::bigint AS total
				   FROM tokens
				   WHERE genesis_time > now() - INTERVAL '30 days'`
			),
			// is_fully_burned comes from token_state, which is only populated
			// once BlockBook-backed enrichment runs. Until Phase 2d lands this
			// row is missing for every category — we handle it as null in the
			// UI and render an explanatory placeholder.
			query<WindowCount>(
				`SELECT COUNT(*)::bigint AS total
				   FROM token_state
				   WHERE is_fully_burned = true`
			)
		])
	]);

	const [typesRes, d7Res, d30Res, burnedRes] = pageResults;

	const pickNumber = (r: PromiseSettledResult<{ rows: WindowCount[] }>): number =>
		r.status === 'fulfilled' ? Number(r.value.rows[0]?.total ?? 0) : 0;

	const byType: Record<'FT' | 'NFT' | 'FT+NFT', number> = { FT: 0, NFT: 0, 'FT+NFT': 0 };
	if (typesRes.status === 'fulfilled') {
		for (const row of typesRes.value.rows) byType[row.token_type] = Number(row.total);
	}

	const enrichmentReady = burnedRes.status === 'fulfilled';

	for (const r of [typesRes, d7Res, d30Res, burnedRes]) {
		if (r.status === 'rejected') console.error('[stats] metric query failed:', r.reason);
	}

	return {
		byType,
		newIn24h: parentData.newIn24h,
		newIn7d: pickNumber(d7Res),
		newIn30d: pickNumber(d30Res),
		burned: enrichmentReady ? pickNumber(burnedRes) : null
	};
};
