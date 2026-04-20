// Global server load: fetch the total tokens-tracked count so HelloBar
// and MetricsBar can render it on first paint (SSR), without a client
// round-trip.

import { query } from '$lib/server/db';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => {
	let tokensTracked = 0;
	try {
		const res = await query<{ total: string }>(
			`SELECT COUNT(*)::bigint AS total FROM tokens`
		);
		tokensTracked = Number(res.rows[0]?.total ?? 0);
	} catch (err) {
		console.error('[+layout.server] tokens count failed:', err);
	}
	return { tokensTracked };
};
