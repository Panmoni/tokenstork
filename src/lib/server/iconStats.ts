// Aggregate counts for the icon-safety pipeline (item #22 / docs/icon-
// safety-plan.md). Surfaced on /moderated and /stats so visitors can see
// how many BCMR icons we serve, block, queue, or review — same
// transparency posture the token-moderation table aims at.
//
// Numbers are per UNIQUE IMAGE HASH, not per token. Issuers reuse icons
// across categories; one cleared hash can back dozens of tokens. The
// `tokens_with_cleared_icon` count surfaces the per-token rollup
// separately for the audience that wants to know "how many of my tokens
// will see a real icon vs a placeholder."

import { query } from './db';

export interface IconModerationStats {
	cleared: number;
	blockedAdult: number;
	blockedOversize: number;
	blockedUnsupported: number;
	blockedCsam: number;
	review: number;
	/// URL-keyed: count of icon_uri rows still without a hash decision OR
	/// in retry-after-fetch-error state. Each row is "we know the URL but
	/// haven't successfully scanned it yet."
	pendingUrls: number;
	totalUrls: number;
	/// How many actual `tokens` rows resolve through `token_metadata.icon_uri →
	/// icon_url_scan → icon_moderation` to a `state='cleared'` decision —
	/// the count that matters for the "how many tokens render a real icon
	/// in the directory today" question.
	tokensWithClearedIcon: number;
}

interface DbRow {
	cleared: number;
	blocked_adult: number;
	blocked_oversize: number;
	blocked_unsupported: number;
	blocked_csam: number;
	review_queue: number;
	pending_urls: number;
	total_urls: number;
	tokens_cleared: number;
}

const EMPTY: IconModerationStats = {
	cleared: 0,
	blockedAdult: 0,
	blockedOversize: 0,
	blockedUnsupported: 0,
	blockedCsam: 0,
	review: 0,
	pendingUrls: 0,
	totalUrls: 0,
	tokensWithClearedIcon: 0
};

export async function getIconModerationStats(): Promise<IconModerationStats> {
	try {
		const res = await query<DbRow>(
			`WITH mod_counts AS (
                SELECT
                    COUNT(*) FILTER (WHERE state = 'cleared')::int AS cleared,
                    COUNT(*) FILTER (WHERE state = 'blocked' AND block_reason = 'adult')::int AS blocked_adult,
                    COUNT(*) FILTER (WHERE state = 'blocked' AND block_reason = 'oversize')::int AS blocked_oversize,
                    COUNT(*) FILTER (WHERE state = 'blocked' AND block_reason = 'unsupported_format')::int AS blocked_unsupported,
                    COUNT(*) FILTER (WHERE state = 'blocked' AND block_reason = 'csam')::int AS blocked_csam,
                    COUNT(*) FILTER (WHERE state = 'review')::int AS review_queue
                FROM icon_moderation
            ),
            url_counts AS (
                SELECT
                    COUNT(*) FILTER (WHERE content_hash IS NULL OR fetch_error IS NOT NULL)::int AS pending_urls,
                    COUNT(*)::int AS total_urls
                FROM icon_url_scan
            ),
            tokens_cleared AS (
                SELECT COUNT(DISTINCT t.category)::int AS n
                FROM tokens t
                JOIN token_metadata m ON m.category = t.category
                JOIN icon_url_scan ius ON ius.icon_uri = m.icon_uri
                JOIN icon_moderation imo
                    ON imo.content_hash = ius.content_hash
                   AND imo.state = 'cleared'
                WHERE m.icon_uri IS NOT NULL
            )
            SELECT mc.cleared, mc.blocked_adult, mc.blocked_oversize,
                   mc.blocked_unsupported, mc.blocked_csam, mc.review_queue,
                   uc.pending_urls, uc.total_urls,
                   tc.n AS tokens_cleared
              FROM mod_counts mc, url_counts uc, tokens_cleared tc`
		);
		const r = res.rows[0];
		if (!r) return EMPTY;
		return {
			cleared: r.cleared,
			blockedAdult: r.blocked_adult,
			blockedOversize: r.blocked_oversize,
			blockedUnsupported: r.blocked_unsupported,
			blockedCsam: r.blocked_csam,
			review: r.review_queue,
			pendingUrls: r.pending_urls,
			totalUrls: r.total_urls,
			tokensWithClearedIcon: r.tokens_cleared
		};
	} catch (err) {
		console.error('[iconStats] load failed:', err);
		return EMPTY;
	}
}
