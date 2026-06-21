// BCMR trust/stability scoring (watchdog M4). Pure mapper: a per-token
// `token_bcmr_profile` summary row (recomputed by the on-chain walker) → a
// tier + structured reason codes for the directory/detail badge.
//
// "Trust" here is strictly about METADATA STABILITY, not the token's value or
// legitimacy: a token that hasn't touched its BCMR in two years reads very
// differently from one that swapped its identity last week or whose current
// metadata just got pulled. The whole point of the watchdog is to make that
// difference legible.
//
// Pure + dependency-free, and crucially LOCALE-FREE: it returns reason CODES +
// raw numeric params, never user-facing English. The component renders them via
// Paraglide `m.*()` (i18n) using its existing localized age formatter — so the
// badge is translated like the rest of the page, and this stays trivially
// correct under `pnpm run check` without dragging the i18n runtime into
// $lib/server (where `m.*()` isn't used anywhere else).

export interface BcmrProfileRow {
	/** Distinct content_hash ever published (verified or not). */
	versionCount: number;
	/** Verified history rows (sha256(body) matched the on-chain hash). */
	verifiedCount: number;
	/** All locator-bearing history rows. */
	totalCount: number;
	/** Unix seconds of the earliest verified version (null if none). */
	firstPublishedAt: number | null;
	/** Unix seconds of the most recent verified version. */
	lastChangeAt: number | null;
	/** Unix seconds of the most recent authority-key move (null if never). */
	authorityMovedAt: number | null;
	/** A version_pulled event has fired at least once. */
	everPulled: boolean;
}

export type BcmrTrustTier =
	| 'none'
	| 'suspicious'
	| 'new'
	| 'volatile'
	| 'established'
	| 'stable';

export type BcmrTrustReasonCode =
	| 'pulled'
	| 'never_verified'
	| 'authority_moved'
	| 'unverified_ratio'
	| 'first_published'
	| 'versions'
	| 'last_changed';

/** One reason for the badge tooltip — a code + the params its message needs.
 *  `ageDays` is whole days (the component formats it via its localized age
 *  helper); `count`/`unverified`/`total` are plain counts. */
export interface BcmrTrustReason {
	code: BcmrTrustReasonCode;
	ageDays?: number;
	count?: number;
	unverified?: number;
	total?: number;
}

export interface BcmrTrust {
	tier: BcmrTrustTier;
	reasons: BcmrTrustReason[];
}

const DAY = 86_400;
// A metadata mutation this recent is "fresh" enough to dominate the read.
const RECENT_AUTHORITY_MOVE_DAYS = 30;
// Younger than this → not enough history to call it stable.
const NEW_DAYS = 14;
// This many distinct versions with a recent change → churny.
const VOLATILE_VERSIONS = 4;
const VOLATILE_DAYS = 30;
// Untouched at least this long (with few versions) → genuinely stable.
const STABLE_DAYS = 365;

const days = (seconds: number): number => Math.floor(seconds / DAY);

/**
 * Score a token's BCMR metadata stability. `nowSec` is injected (not read from
 * the clock) so the function is pure.
 *
 * Tiers, first match wins:
 *  - suspicious — current metadata pulled, or a publication that never verified,
 *    or the authority key moved very recently. The rug-adjacent signals.
 *  - none       — no on-chain BCMR (nothing to score).
 *  - new        — first published recently; not enough track record yet.
 *  - volatile   — many versions and changed recently; identity is churny.
 *  - stable     — untouched for a long time with few versions.
 *  - established — verified history, none of the above.
 */
export function scoreBcmrTrust(p: BcmrProfileRow | null, nowSec: number): BcmrTrust {
	if (!p || p.totalCount === 0) {
		return { tier: 'none', reasons: [] };
	}

	const reasons: BcmrTrustReason[] = [];

	// ── Suspicious signals (take precedence over everything) ────────────────
	if (p.everPulled) {
		reasons.push({ code: 'pulled' });
	}
	if (p.verifiedCount === 0) {
		reasons.push({ code: 'never_verified' });
	}
	const moveAge = p.authorityMovedAt != null ? nowSec - p.authorityMovedAt : null;
	if (moveAge != null && moveAge <= RECENT_AUTHORITY_MOVE_DAYS * DAY) {
		reasons.push({ code: 'authority_moved', ageDays: days(moveAge) });
	}
	// Many publications but most don't verify — churny + untrustworthy.
	const unverified = p.totalCount - p.verifiedCount;
	if (p.totalCount >= 2 && unverified > p.verifiedCount) {
		reasons.push({ code: 'unverified_ratio', unverified, total: p.totalCount });
	}
	if (reasons.length > 0) {
		return { tier: 'suspicious', reasons };
	}

	// From here, every version that exists is verified history.
	const sinceChange = p.lastChangeAt != null ? nowSec - p.lastChangeAt : null;
	const sinceFirst = p.firstPublishedAt != null ? nowSec - p.firstPublishedAt : null;

	if (sinceFirst != null && sinceFirst < NEW_DAYS * DAY) {
		return { tier: 'new', reasons: [{ code: 'first_published', ageDays: days(sinceFirst) }] };
	}

	if (
		p.versionCount >= VOLATILE_VERSIONS &&
		sinceChange != null &&
		sinceChange < VOLATILE_DAYS * DAY
	) {
		return {
			tier: 'volatile',
			reasons: [
				{ code: 'versions', count: p.versionCount },
				{ code: 'last_changed', ageDays: days(sinceChange) }
			]
		};
	}

	if (sinceChange != null && sinceChange >= STABLE_DAYS * DAY && p.versionCount <= 2) {
		return {
			tier: 'stable',
			reasons: [
				{ code: 'versions', count: p.versionCount },
				{ code: 'last_changed', ageDays: days(sinceChange) }
			]
		};
	}

	const reasonsOut: BcmrTrustReason[] = [{ code: 'versions', count: p.versionCount }];
	if (sinceChange != null) {
		reasonsOut.push({ code: 'last_changed', ageDays: days(sinceChange) });
	}
	return { tier: 'established', reasons: reasonsOut };
}
