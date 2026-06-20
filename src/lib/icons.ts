// Resolve a token's icon URL for rendering.
//
// Default-deny: only returns a real /icons/<hash>.webp path when the
// icon has been scanned + cleared. Anything else (including the raw
// IPFS URL!) returns the SVG placeholder. Falling through to the raw
// URL would defeat the safety invariant the entire icon-safety
// pipeline (#22) exists to enforce — see docs/icon-safety-plan.md.
//
// `clearedHash` is the lower-case hex of the SHA-256 of the cleared
// image bytes. It comes from a SQL LEFT JOIN through icon_url_scan
// and icon_moderation gated on `state = 'cleared'`; the join returns
// NULL for any URL that hasn't been scanned, was blocked, is in
// review, or was never seen.

import { PLACEHOLDER_ICON } from './format';

// Max stored-WebP dimension per side — MUST match the worker's
// `WEBP_MAX_DIM` (workers/src/icons.rs). A cleared icon whose source was
// larger than this on either side was downscaled by the pipeline.
export const ICON_MAX_DIM = 512;

// Source formats considered "in standard" for a BCMR token icon. Anything
// else the pipeline accepts (BMP, ICO) is a non-standard source we
// converted — worth disclosing. Transcoding these standard formats to WebP
// is normal and NOT flagged.
const STANDARD_ICON_FORMATS = new Set(['png', 'jpeg', 'gif', 'webp', 'svg']);

/**
 * Describe how a token's served (cleared) icon was adjusted from the
 * publisher's BCMR source — or `null` if it was used as-is. Drives the
 * token page's transparency note. Inputs come from the `imo_clear` join on
 * the +page.server.ts row (only the cleared decision carries the bytes we
 * actually serve). Returns a human phrase like "converted from BMP and
 * resized from 2400×2400px", or null when nothing was adjusted / unknown
 * (legacy cleared icons have null provenance and are in-standard).
 */
export function describeIconAdjustment(input: {
	clearedHash: string | null | undefined;
	sourceFormat: string | null | undefined;
	sourceWidth: number | null | undefined;
	sourceHeight: number | null | undefined;
}): string | null {
	// Only the served icon matters; no cleared hash → nothing rendered.
	if (!input.clearedHash) return null;
	const fmt = input.sourceFormat;
	const w = input.sourceWidth;
	const h = input.sourceHeight;
	const reformatted = !!fmt && !STANDARD_ICON_FORMATS.has(fmt);
	const downscaled = w != null && h != null && Math.max(w, h) > ICON_MAX_DIM;
	if (!reformatted && !downscaled) return null;
	const parts: string[] = [];
	if (reformatted) parts.push(`converted from ${fmt!.toUpperCase()}`);
	if (downscaled) parts.push(`resized from ${w}×${h}px`);
	return parts.join(' and ');
}

export function iconHrefFor(
	rawUri: string | null | undefined,
	clearedHash: string | null | undefined
): string {
	if (clearedHash) return `/icons/${clearedHash}.webp`;
	// IMPORTANT: do NOT fall through to getIPFSUrl(rawUri). That would
	// re-introduce the very risk the pipeline closes — issuer-controlled
	// URLs reaching the visitor's browser unscanned.
	return PLACEHOLDER_ICON;
}

// User-facing reason an icon is NOT being rendered. The icon-safety
// pipeline has multiple states a URL can be in; the detail page surfaces
// the one matching this token so visitors know whether the placeholder
// is a permanent block ("blocked: adult") vs. a transient state
// ("queued for safety scan") that may resolve on its own.
export type IconStatus =
	| 'cleared'
	| 'no_uri'              // BCMR has no icon at all
	| 'pending_scan'        // URI known but never fetched
	| 'fetch_failed'        // worker tried and failed
	| 'review'              // human review queue
	| 'blocked'             // permanent — block_reason carries the why
	| 'unscanned';          // catch-all when state is missing entirely

export interface IconStatusInfo {
	status: IconStatus;
	/** Short user-facing label, e.g. "Queued for safety scan". */
	label: string;
	/** Optional moderator-side reason (only for blocked/review). */
	blockReason: string | null;
}

const BLOCK_REASON_LABEL: Record<string, string> = {
	csam: 'unsafe content',
	adult: 'adult content',
	oversize: 'file too large',
	fetch_failed: 'fetch failed',
	unsupported_format: 'unsupported format'
};

/** Resolve the user-facing reason an icon is hidden. Inputs come from
 *  the LEFT JOIN of `token_metadata.icon_uri` → `icon_url_scan` →
 *  `icon_moderation`, all already on the +page.server.ts row.
 *
 *  Logic precedence (most-specific first):
 *    1. cleared hash present → status='cleared' (no UI banner)
 *    2. no icon_uri at all   → status='no_uri'
 *    3. fetch error recorded → status='fetch_failed'
 *    4. moderation row found → blocked / review (block_reason fills label)
 *    5. URI exists but no scan yet → 'pending_scan'
 *    6. fallthrough → 'unscanned'
 */
export function resolveIconStatus(input: {
	iconUri: string | null | undefined;
	clearedHash: string | null | undefined;
	moderationState: string | null | undefined;
	blockReason: string | null | undefined;
	fetchError: string | null | undefined;
	hasScanRow: boolean;
	/// True iff some BCMR metadata exists for the category (any of name,
	/// symbol, description, or icon_uri populated AND bcmr_source is not
	/// the 404 sentinel). When false, the no-icon banner reads "No BCMR
	/// metadata published" instead of incorrectly blaming missing icon
	/// fields on a registry that was never consulted.
	hasBcmrMetadata: boolean;
}): IconStatusInfo {
	if (input.clearedHash) {
		return { status: 'cleared', label: 'Icon cleared', blockReason: null };
	}
	if (!input.iconUri) {
		return {
			status: 'no_uri',
			label: input.hasBcmrMetadata
				? 'No icon — BCMR metadata does not include one.'
				: 'No BCMR metadata published for this category.',
			blockReason: null
		};
	}
	if (input.fetchError && !input.moderationState) {
		return {
			status: 'fetch_failed',
			label: `Icon could not be fetched (${input.fetchError.slice(0, 80)}).`,
			blockReason: null
		};
	}
	if (input.moderationState === 'blocked') {
		// Strict map lookup. The schema CHECK constraint pins block_reason
		// to a fixed enum, so an unmapped value here means schema drift —
		// we render the generic 'flagged' rather than leak a raw column
		// value into user copy. blockReason still flows out as-is for
		// machine-readable consumers.
		const why = input.blockReason
			? (BLOCK_REASON_LABEL[input.blockReason] ?? 'flagged')
			: 'flagged';
		return {
			status: 'blocked',
			label: `Icon blocked by safety scan (${why}).`,
			blockReason: input.blockReason ?? null
		};
	}
	if (input.moderationState === 'review') {
		return {
			status: 'review',
			label: 'Icon held for human review.',
			blockReason: null
		};
	}
	if (input.moderationState === 'pending' || (input.hasScanRow && !input.moderationState)) {
		return {
			status: 'pending_scan',
			label: 'Icon queued for safety scan — placeholder shown until cleared.',
			blockReason: null
		};
	}
	return {
		status: 'unscanned',
		label: 'Icon not yet scanned — placeholder shown by default.',
		blockReason: null
	};
}
