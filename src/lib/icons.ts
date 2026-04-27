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
