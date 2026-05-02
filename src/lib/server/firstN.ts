// First-10 CashToken-ever lookup. Order is fixed by
// `(genesis_block ASC, category ASC)` over the on-chain genesis-tx outpoint
// hashes — deterministic and immutable across every running instance.
// Result never changes, so we lazy-init a Map<categoryHex, rank> on first
// call and cache for the process lifetime.
//
// Block 792,773 was the first block with CashToken activity (28 categories
// landed simultaneously); within-block ordering is the alphanumeric
// category-hex sort. Result: a stable 1..10 ranking suitable for a
// permanent collector's-item badge.

import { hexFromBytes, query } from './db';

let cache: Map<string, number> | null = null;
let inflight: Promise<Map<string, number>> | null = null;

async function load(): Promise<Map<string, number>> {
	const result = await query<{ category: Buffer }>(
		`SELECT category
		   FROM tokens
		  ORDER BY genesis_block ASC, category ASC
		  LIMIT 10`
	);
	const map = new Map<string, number>();
	result.rows.forEach((r, i) => {
		const hex = hexFromBytes(r.category);
		if (hex) map.set(hex, i + 1);
	});
	return map;
}

/** Returns the cached Map<categoryHex, rank> for the first 10 CashTokens.
 *  Lazy-loaded on first call, cached forever after. The DB query is cheap
 *  (a 10-row LIMIT against an indexed `(genesis_block, category)` order),
 *  but caching keeps every page-load off the path. */
export async function getFirstNMap(): Promise<Map<string, number>> {
	if (cache) return cache;
	if (!inflight) {
		inflight = load().then((m) => {
			cache = m;
			return m;
		});
	}
	return inflight;
}

/** Convenience: rank for a single category-hex, or null if not in the top 10. */
export async function firstNRankFor(categoryHex: string): Promise<number | null> {
	const map = await getFirstNMap();
	return map.get(categoryHex) ?? null;
}
