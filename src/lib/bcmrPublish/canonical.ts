// Canonical-JSON serialization + sha256 for BCMR publications.
//
// The on-chain BCMR locator (`OP_RETURN BCMR <content_hash> <URI>`) commits
// to a specific 32-byte sha256 of the JSON bytes — any consumer that fetches
// the URI hash-verifies the body against this value. So the wizard must
// produce a stable byte sequence for the JSON it's about to publish.
//
// JSON objects are unordered: `{"a":1,"b":2}` and `{"b":2,"a":1}` are
// semantically equal but serialize differently. Without a canonicalization
// step, the publisher and any verifier could legitimately disagree on the
// content hash. We follow a small subset of RFC 8785 (JCS): recursively
// sort object keys lexicographically by Unicode code point, no whitespace,
// JSON.stringify-equivalent string escaping.
//
// We do NOT implement the full RFC 8785 (which has specific number-format
// rules) because every numeric field in our BCMR shape is a small integer
// (decimals 0-8, version {major,minor,patch} all ints). JavaScript's
// `JSON.stringify` already produces canonical representations for those.
//
// Server-side only — uses Node's `crypto` for sha256.

import { createHash } from 'node:crypto';

/**
 * Recursively sort object keys lexicographically and emit a no-whitespace
 * JSON string. Arrays preserve their original element order (per RFC
 * 8785). Strings, numbers, booleans, and null are passed through to
 * JSON.stringify. Non-finite numbers (NaN, ±Infinity) throw — BCMR
 * publication should never carry those.
 */
export function canonicalizeBcmr(value: unknown): string {
	return JSON.stringify(canonicalize(value));
}

function canonicalize(v: unknown): unknown {
	if (v === null) return null;
	if (typeof v === 'number') {
		if (!Number.isFinite(v)) {
			throw new Error('canonicalizeBcmr: non-finite numbers cannot be canonicalized');
		}
		return v;
	}
	if (typeof v === 'string' || typeof v === 'boolean') return v;
	if (typeof v === 'bigint') {
		throw new Error('canonicalizeBcmr: BigInt values cannot be canonicalized — convert to string upstream');
	}
	if (Array.isArray(v)) return v.map(canonicalize);
	if (typeof v === 'object') {
		const obj = v as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		// Lexicographic sort. JS string comparison is code-point order
		// for the BMP and surrogate-pair-order for astral planes — the
		// latter differs from code-point order in edge cases. We don't
		// expect non-BMP keys in BCMR shapes (all keys are ASCII per
		// spec) but a future schema extension could introduce them. If
		// that day comes, switch to a proper code-point comparator.
		const keys = Object.keys(obj).sort();
		for (const k of keys) {
			out[k] = canonicalize(obj[k]);
		}
		return out;
	}
	// undefined / symbol / function — would be silently dropped by
	// JSON.stringify, but a BCMR publication should never reach this
	// branch.
	throw new Error(`canonicalizeBcmr: unsupported type ${typeof v}`);
}

/** sha256(utf-8(canonical-json)) → 32 bytes as lowercase hex. */
export function contentHashHex(canonical: string): string {
	return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
