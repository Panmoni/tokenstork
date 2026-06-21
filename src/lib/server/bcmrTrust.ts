// BCMR trust/stability scoring (watchdog M4). Pure mapper: a per-token
// `token_bcmr_profile` summary row (recomputed by the on-chain walker) → a
// tier + label + human-readable reasons for the directory/detail badge.
//
// "Trust" here is strictly about METADATA STABILITY, not the token's value or
// legitimacy: a token that hasn't touched its BCMR in two years reads very
// differently from one that swapped its identity last week or whose current
// metadata just got pulled. The whole point of the watchdog is to make that
// difference legible.
//
// Pure + dependency-free so it stays trivially correct under `pnpm run check`.

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

export interface BcmrTrust {
	tier: BcmrTrustTier;
	/** Short badge label. */
	label: string;
	/** Human-readable bullets explaining the tier (for a tooltip). */
	reasons: string[];
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

function approxAge(seconds: number): string {
	if (seconds < 2 * DAY) return 'today';
	const days = Math.floor(seconds / DAY);
	if (days < 14) return `${days}d ago`;
	if (days < 60) return `${Math.floor(days / 7)}w ago`;
	if (days < 730) return `${Math.floor(days / 30)}mo ago`;
	return `${Math.floor(days / 365)}y ago`;
}

function approxSpan(seconds: number): string {
	const days = Math.floor(seconds / DAY);
	if (days < 1) return 'less than a day';
	if (days < 60) return `${days} days`;
	if (days < 730) return `${Math.floor(days / 30)} months`;
	return `${Math.floor(days / 365)} years`;
}

/**
 * Score a token's BCMR metadata stability. `nowSec` is injected (not read from
 * the clock) so the function is pure and testable.
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
		return { tier: 'none', label: 'No on-chain BCMR', reasons: [] };
	}

	const reasons: string[] = [];

	// ── Suspicious signals (take precedence over everything) ────────────────
	if (p.everPulled) {
		reasons.push('current metadata was pulled or stopped verifying');
	}
	if (p.verifiedCount === 0) {
		reasons.push('no publication has ever verified against its on-chain hash');
	}
	const moveAge =
		p.authorityMovedAt != null ? nowSec - p.authorityMovedAt : null;
	if (moveAge != null && moveAge <= RECENT_AUTHORITY_MOVE_DAYS * DAY) {
		reasons.push(`authority key moved ${approxAge(moveAge)}`);
	}
	// Many publications but most don't verify — churny + untrustworthy.
	const unverified = p.totalCount - p.verifiedCount;
	if (p.totalCount >= 2 && unverified > p.verifiedCount) {
		reasons.push(`${unverified} of ${p.totalCount} publications did not verify`);
	}
	if (reasons.length > 0) {
		return { tier: 'suspicious', label: '⚠ Unstable', reasons };
	}

	// From here, every version that exists is verified history.
	const sinceChange = p.lastChangeAt != null ? nowSec - p.lastChangeAt : null;
	const sinceFirst = p.firstPublishedAt != null ? nowSec - p.firstPublishedAt : null;

	if (sinceFirst != null && sinceFirst < NEW_DAYS * DAY) {
		return {
			tier: 'new',
			label: 'New',
			reasons: [`BCMR first published ${approxAge(sinceFirst)}`]
		};
	}

	if (
		p.versionCount >= VOLATILE_VERSIONS &&
		sinceChange != null &&
		sinceChange < VOLATILE_DAYS * DAY
	) {
		return {
			tier: 'volatile',
			label: 'Volatile',
			reasons: [
				`${p.versionCount} versions, last changed ${approxAge(sinceChange)}`
			]
		};
	}

	if (
		sinceChange != null &&
		sinceChange >= STABLE_DAYS * DAY &&
		p.versionCount <= 2
	) {
		return {
			tier: 'stable',
			label: 'Stable',
			reasons: [
				`${p.versionCount} version${p.versionCount === 1 ? '' : 's'}, unchanged for ${approxSpan(sinceChange)}`
			]
		};
	}

	const r: string[] = [`${p.versionCount} version${p.versionCount === 1 ? '' : 's'}`];
	if (sinceChange != null) r.push(`last changed ${approxAge(sinceChange)}`);
	return { tier: 'established', label: 'Established', reasons: r };
}
