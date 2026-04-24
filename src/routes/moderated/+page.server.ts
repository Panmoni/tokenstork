// /moderated — public transparency view of every category in
// token_moderation. Inverse of NOT_MODERATED_CLAUSE: the only place on
// the site that surfaces hidden tokens. Direct token URLs still 410;
// this page intentionally does not link out to them.
//
// `moderator_note` stays operator-private (never selected here). Reason
// + hidden_at are public so visitors can see what we filter and why.

import { query, hexFromBytes } from '$lib/server/db';
import { REPORT_REASONS_SET, type ReportReason } from '$lib/moderation';
import type { PageServerLoad } from './$types';

interface DbRow {
	category: Buffer;
	name: string | null;
	symbol: string | null;
	token_type: 'FT' | 'NFT' | 'FT+NFT';
	reason: string;
	hidden_at: Date;
}

export interface ModeratedRow {
	id: string;
	name: string | null;
	symbol: string | null;
	tokenType: 'FT' | 'NFT' | 'FT+NFT';
	reason: ReportReason;
	hiddenAt: number; // unix seconds
}

export const load: PageServerLoad = async () => {
	try {
		const res = await query<DbRow>(
			`SELECT t.category,
			        m.name,
			        m.symbol,
			        t.token_type,
			        mod.reason,
			        mod.hidden_at
			   FROM token_moderation mod
			   JOIN tokens t           ON t.category = mod.category
			   LEFT JOIN token_metadata m ON m.category = mod.category
			  ORDER BY mod.hidden_at DESC`
		);

		const rows: ModeratedRow[] = res.rows.map((r) => ({
			id: hexFromBytes(r.category)!,
			name: r.name,
			symbol: r.symbol,
			tokenType: r.token_type,
			reason: REPORT_REASONS_SET.has(r.reason) ? (r.reason as ReportReason) : 'other',
			hiddenAt: Math.floor(r.hidden_at.getTime() / 1000)
		}));

		return { rows, error: null as string | null };
	} catch (err) {
		console.error('[moderated] load failed:', err);
		return { rows: [] as ModeratedRow[], error: 'Could not load the moderation list.' };
	}
};
