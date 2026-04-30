// /crc20 — dedicated landing page for CRC-20 tokens. Pulls the symbol-
// bucket aggregate via fetchCrc20Symbols + a few headline counts. The
// "browse the directory" CTA links into the homepage with
// ?crc20=canonical so the full TokenGrid plumbing (sort, search,
// pagination, badges) is reused without duplication.

import { fetchCrc20Symbols } from '$lib/server/crc20';
import { query } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [symbols, countsRes] = await Promise.all([
		fetchCrc20Symbols(),
		query<{
			total_categories: string;
			canonical_winners: string;
			distinct_symbols: string;
			contested_symbols: string;
		}>(
			`SELECT
				COUNT(*)::bigint                                  AS total_categories,
				COUNT(*) FILTER (WHERE is_canonical)::bigint      AS canonical_winners,
				COUNT(DISTINCT symbol_bytes)::bigint              AS distinct_symbols,
				COUNT(*) FILTER (
					WHERE symbol_bytes IN (
						SELECT symbol_bytes FROM token_crc20
						 GROUP BY symbol_bytes HAVING COUNT(*) > 1
					)
				)::bigint                                          AS contested_symbols
			   FROM token_crc20`
		)
	]);

	const counts = countsRes.rows[0] ?? {
		total_categories: '0',
		canonical_winners: '0',
		distinct_symbols: '0',
		contested_symbols: '0'
	};

	return {
		symbols,
		counts: {
			totalCategories: Number(counts.total_categories),
			canonicalWinners: Number(counts.canonical_winners),
			distinctSymbols: Number(counts.distinct_symbols),
			contestedSymbols: Number(counts.contested_symbols)
		}
	};
};
