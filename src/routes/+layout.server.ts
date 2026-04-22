// Global server load: fetch a handful of high-level counters so MetricsBar
// renders a full picture on first paint (SSR), without any client round-trip.
//
// Four values, one query round-trip (issued in parallel):
//   - tokensTracked    total rows in `tokens`
//   - tailLastBlock    highest block our tail worker has scanned
//   - newIn24h         categories first seen in the last 24h
//
// If any single query fails we log + fall back to a sensible default so the
// layout never 500s over a stats hiccup.

import { query } from '$lib/server/db';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => {
	const [tokensTrackedRes, syncRes, newIn24hRes] = await Promise.allSettled([
		query<{ total: string }>(`SELECT COUNT(*)::bigint AS total FROM tokens`),
		query<{ tail_last_block: number | null }>(
			`SELECT tail_last_block FROM sync_state WHERE id = 1`
		),
		query<{ total: string }>(
			`SELECT COUNT(*)::bigint AS total FROM tokens WHERE first_seen_at > now() - INTERVAL '24 hours'`
		)
	]);

	const pickCount = (r: PromiseSettledResult<{ rows: { total: string }[] }>): number =>
		r.status === 'fulfilled' ? Number(r.value.rows[0]?.total ?? 0) : 0;

	const tokensTracked = pickCount(tokensTrackedRes);
	const newIn24h = pickCount(newIn24hRes);
	const tailLastBlock =
		syncRes.status === 'fulfilled' ? (syncRes.value.rows[0]?.tail_last_block ?? null) : null;

	for (const r of [tokensTrackedRes, syncRes, newIn24hRes]) {
		if (r.status === 'rejected') console.error('[+layout.server] metric query failed:', r.reason);
	}

	return { tokensTracked, tailLastBlock, newIn24h };
};
