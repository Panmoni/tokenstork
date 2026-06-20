// GET /api/crc20/symbols — symbol-bucket aggregate. One row per distinct
// CRC-20 symbol, with contender count and the canonical winner's category.
// Powers the /crc20 page header + the disputed-symbols table; also a
// useful debug endpoint for operators.

import { json, error, isHttpError } from '@sveltejs/kit';
import { fetchCrc20Symbols } from '$lib/server/crc20';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ setHeaders }) => {
	// Global symbol-bucket aggregate, cookie-independent — make it CDN-
	// cacheable (s-maxage) with a stale-while-revalidate window so the
	// edge absorbs repeats and never blocks callers at expiry.
	setHeaders({ 'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600' });
	try {
		const symbols = await fetchCrc20Symbols();
		return json({ symbols, count: symbols.length });
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[api/crc20/symbols] error:', err);
		error(500, 'Failed to fetch CRC-20 symbol buckets');
	}
};
