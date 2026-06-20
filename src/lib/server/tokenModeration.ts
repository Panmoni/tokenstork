// Token moderation writes — hide/unhide a category by writing or deleting
// its `token_moderation` row. A present row removes the token from the
// directory, public API, search, stats, and holder/airdrop reads (every
// read path shares NOT_MODERATED_CLAUSE in $lib/moderation). Deleting the
// row cleanly un-hides; the underlying `tokens` row is never touched.
//
// Server-side only; callers MUST gate on $lib/server/admin first. Hiding
// has been an owner-only psql step until now — this module is the
// programmatic equivalent so the /admin/reports surface can close the loop.

import { query, withTransaction, categoryFromHex } from '$lib/server/db';
import type { ReportReason } from '$lib/moderation';

/**
 * Hide a token. Idempotent upsert — re-hiding an already-hidden category
 * refreshes its reason/note rather than erroring. When `reportId` is given,
 * the matching report is flipped to `actioned` in the SAME transaction, so
 * "hide the token and close the report" is atomic: there's never a hidden
 * token whose report is still `new`, or an `actioned` report with a token
 * that didn't get hidden.
 */
export async function hideToken(
	categoryHex: string,
	reason: ReportReason,
	note: string | null,
	reportId?: number
): Promise<void> {
	const category = categoryFromHex(categoryHex);
	await withTransaction(async (client) => {
		await client.query(
			`INSERT INTO token_moderation (category, reason, moderator_note)
			      VALUES ($1, $2, $3)
			 ON CONFLICT (category)
			   DO UPDATE SET reason = EXCLUDED.reason,
			                 moderator_note = EXCLUDED.moderator_note`,
			[category, reason, note]
		);
		if (reportId != null) {
			await client.query(
				`UPDATE token_reports
				    SET status = 'actioned',
				        reviewed_at = now(),
				        moderator_note = COALESCE($2, moderator_note)
				  WHERE id = $1`,
				[reportId, note]
			);
		}
	});
}

/** Un-hide a token. Returns false if it wasn't hidden to begin with. */
export async function unhideToken(categoryHex: string): Promise<boolean> {
	const res = await query(`DELETE FROM token_moderation WHERE category = $1`, [
		categoryFromHex(categoryHex)
	]);
	return (res.rowCount ?? 0) > 0;
}
