// BCH wallet-signature authentication.
//
// Server-only — never imported on the client. The whole login flow is:
//
//   1. Client POSTs cashaddr to /api/auth/challenge.
//   2. Server stores a (nonce, cashaddr, message, expires_at) row and
//      returns the canonical message text the wallet must sign.
//   3. User signs the message in their wallet. The wallet emits a 65-byte
//      compact signature, base64-encoded.
//   4. Client POSTs (nonce, signature) to /api/auth/verify.
//   5. Server reconstructs the message hash, recovers the pubkey from the
//      signature, derives a cashaddr from the pubkey, and confirms it
//      equals the cashaddr the challenge committed to.
//   6. On success: insert/touch users row, issue a session cookie.
//
// Crypto primitives come from @bitauth/libauth — the canonical BCH crypto
// library. We don't re-implement secp256k1; we glue the message-hash format
// (a Bitcoin convention since 2011) on top of libauth's recovery primitive.
//
// Threat model:
//   - Replay: each challenge is single-use (consumed_at) + 5 min TTL.
//   - Cross-domain replay: the canonical message includes the literal
//     "TokenStork.com login" string and the user's claimed cashaddr, so a
//     signature for a different site or a different account can't fool us.
//   - Session theft: the cookie is HttpOnly + Secure + SameSite=Strict.

import {
	CashAddressNetworkPrefix,
	CashAddressType,
	decodeCashAddress,
	encodeCashAddress,
	hash160,
	secp256k1,
	sha256
} from '@bitauth/libauth';
import { randomBytes } from 'node:crypto';

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/** Bitcoin Signed Message magic prefix. The 0x18 length-byte plus the
 *  24-character literal "Bitcoin Signed Message:\n". This format originated
 *  in Bitcoin Core's `signmessage`/`verifymessage` RPCs and BCH wallets
 *  (Electron Cash, Cashonize, Paytaca) all use the same magic verbatim. */
const BITCOIN_SIGNED_MESSAGE_PREFIX = new Uint8Array([
	0x18,
	0x42, 0x69, 0x74, 0x63, 0x6f, 0x69, 0x6e, 0x20, // "Bitcoin "
	0x53, 0x69, 0x67, 0x6e, 0x65, 0x64, 0x20,       // "Signed "
	0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x3a, // "Message:"
	0x0a                                             // "\n"
]);

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Cookie name used for the session token. HttpOnly so JS can't read it,
 *  SameSite=Strict so it doesn't cross origins. */
export const SESSION_COOKIE_NAME = 'tokenstork_session';

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface ChallengeRecord {
	nonce: string;
	cashaddr: string;
	message: string;
	expiresAt: Date;
}

export interface SessionRecord {
	id: string;
	cashaddr: string;
	createdAt: Date;
	expiresAt: Date;
}

export type VerifyResult =
	| { ok: true; cashaddr: string }
	| { ok: false; error: string };

// ----------------------------------------------------------------------------
// Challenge construction
// ----------------------------------------------------------------------------

/** Generate a cryptographically-random base64url nonce. 256 bits of
 *  entropy is overkill for a 5-minute-TTL single-use token but the
 *  uniformity makes collision-impossible-by-construction the standard. */
export function newNonce(): string {
	return base64UrlEncode(randomBytes(32));
}

/** Build the canonical message a user signs. Includes:
 *  - "TokenStork.com login" — domain anchor; signature for another site
 *    won't validate here.
 *  - The cashaddr — the user is committing to this specific address.
 *  - A nonce — single-use anti-replay.
 *  - An ISO 8601 expiry — wallets typically display the message they're
 *    being asked to sign; the user gets a visible confirmation that the
 *    challenge is fresh.
 *
 *  The format is stable across builds — clients never construct this; it
 *  comes from the server. But if you ever change it, version the prefix. */
export function buildChallengeMessage(args: {
	cashaddr: string;
	nonce: string;
	expiresAt: Date;
}): string {
	return [
		'TokenStork.com login',
		`Address: ${args.cashaddr}`,
		`Nonce: ${args.nonce}`,
		`Expires: ${args.expiresAt.toISOString()}`
	].join('\n');
}

/** End-to-end challenge factory. Caller persists the result. */
export function newChallenge(cashaddr: string): ChallengeRecord {
	const nonce = newNonce();
	const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
	const message = buildChallengeMessage({ cashaddr, nonce, expiresAt });
	return { nonce, cashaddr, message, expiresAt };
}

// ----------------------------------------------------------------------------
// Cashaddr validation
// ----------------------------------------------------------------------------

/** Accept only mainnet P2PKH cashaddrs — the only address type whose
 *  pubkey can sign a Bitcoin-signed-message (P2SH addresses don't carry a
 *  pubkey, and testnet/regtest aren't relevant for production). Returns
 *  null on any decode failure. */
export function normalizeCashaddr(input: string): string | null {
	const trimmed = input.trim().toLowerCase();
	const candidate = trimmed.startsWith('bitcoincash:') ? trimmed : `bitcoincash:${trimmed}`;
	const decoded = decodeCashAddress(candidate);
	if (typeof decoded === 'string') return null; // libauth returns string on error
	if (decoded.prefix !== CashAddressNetworkPrefix.mainnet) return null;
	if (decoded.type !== CashAddressType.p2pkh) return null;
	// Re-encode so the canonical form is what we store + compare against.
	return encodeCashAddress({
		prefix: CashAddressNetworkPrefix.mainnet,
		type: CashAddressType.p2pkh,
		payload: decoded.payload
	}).address;
}

// ----------------------------------------------------------------------------
// Signature verification
// ----------------------------------------------------------------------------

/** Verify a Bitcoin-signed-message signature against a claimed cashaddr.
 *
 *  Returns the canonical cashaddr on success, or an error string. The
 *  caller should compare the returned cashaddr against the challenge's
 *  recorded cashaddr — if they don't match, reject the verification.
 *
 *  Inputs:
 *    - message: the exact text the user signed (typically built via
 *      buildChallengeMessage; passed back unchanged from the challenge
 *      record).
 *    - signature: 65-byte compact signature, encoded as either base64
 *      (the wc2-bch-bcr spec's canonical form) or hex (130 chars,
 *      optionally `0x`-prefixed) — some BCH wallets in the wild
 *      return hex even though the spec says base64, so we accept
 *      either rather than rejecting non-conformant wallets.
 *      Byte layout (post-decode):
 *        byte 0     : recovery flag (27..30 uncompressed, 31..34 compressed)
 *        bytes 1-32 : r
 *        bytes 33-64: s */
export function verifySignedMessage(
	message: string,
	signature: string
): { ok: true; cashaddr: string } | { ok: false; error: string } {
	const sigBytes = decodeSignatureBytes(signature.trim());
	if (sigBytes === null) {
		return {
			ok: false,
			error: `signature is not a 65-byte hex or base64 value (got ${signature.trim().length} chars)`
		};
	}

	const recoveryFlag = sigBytes[0];
	if (recoveryFlag < 27 || recoveryFlag > 34) {
		return { ok: false, error: `signature recovery byte out of range (got ${recoveryFlag})` };
	}
	const compressed = recoveryFlag >= 31;
	// (recoveryFlag - base) & 0x03 always yields 0..3; the cast is a typing
	// detail required by libauth's `RecoveryId` literal-union.
	const recoveryId = ((recoveryFlag - (compressed ? 31 : 27)) & 0x03) as 0 | 1 | 2 | 3;
	const compactSig = sigBytes.slice(1); // 64 bytes (r||s)

	const messageHash = doubleSha256OfSignedMessage(message);

	// libauth returns a Uint8Array on success or a Secp256k1Error string on
	// failure. The recovery primitive is variant-aware: the compact path
	// builds a compressed pubkey, the uncompressed path returns 65 bytes.
	const recovered = compressed
		? secp256k1.recoverPublicKeyCompressed(compactSig, recoveryId, messageHash)
		: secp256k1.recoverPublicKeyUncompressed(compactSig, recoveryId, messageHash);
	if (typeof recovered === 'string') {
		return { ok: false, error: `pubkey recovery failed: ${recovered}` };
	}
	const pubkey = recovered;

	// Derive the cashaddr from the recovered pubkey: hash160(pubkey) → P2PKH
	// payload → cashaddr. Standard P2PKH derivation; matches what every BCH
	// wallet produces from a private key.
	const pkh = hash160(pubkey);
	const cashaddr = encodeCashAddress({
		prefix: CashAddressNetworkPrefix.mainnet,
		type: CashAddressType.p2pkh,
		payload: pkh
	}).address;

	return { ok: true, cashaddr };
}

/** Double-SHA-256 of (magic_prefix || varint(message_length) || message_bytes). */
function doubleSha256OfSignedMessage(message: string): Uint8Array {
	const messageBytes = new TextEncoder().encode(message);
	const messageLen = encodeVarint(messageBytes.length);
	const buf = new Uint8Array(
		BITCOIN_SIGNED_MESSAGE_PREFIX.length + messageLen.length + messageBytes.length
	);
	let offset = 0;
	buf.set(BITCOIN_SIGNED_MESSAGE_PREFIX, offset);
	offset += BITCOIN_SIGNED_MESSAGE_PREFIX.length;
	buf.set(messageLen, offset);
	offset += messageLen.length;
	buf.set(messageBytes, offset);
	return sha256.hash(sha256.hash(buf));
}

/** Bitcoin compact-size varint. Only sub-65k payloads matter for sign-
 *  message; larger paths would need full 8-byte encoding. */
function encodeVarint(n: number): Uint8Array {
	if (n < 0xfd) return new Uint8Array([n]);
	if (n <= 0xffff) {
		const out = new Uint8Array(3);
		out[0] = 0xfd;
		out[1] = n & 0xff;
		out[2] = (n >>> 8) & 0xff;
		return out;
	}
	if (n <= 0xffffffff) {
		const out = new Uint8Array(5);
		out[0] = 0xfe;
		out[1] = n & 0xff;
		out[2] = (n >>> 8) & 0xff;
		out[3] = (n >>> 16) & 0xff;
		out[4] = (n >>> 24) & 0xff;
		return out;
	}
	throw new Error('message too large for compact-size varint');
}

// ----------------------------------------------------------------------------
// Encoding helpers
// ----------------------------------------------------------------------------

/** Decode a wallet signature in either base64 (the wc2-bch-bcr spec's
 *  canonical encoding) or hex (what several BCH wallets actually emit
 *  in the wild). Returns the raw 65-byte signature, or null if the
 *  input doesn't decode to exactly 65 bytes either way.
 *
 *  Hex is tried FIRST when the input shape suggests it (130 chars of
 *  [0-9a-fA-F], optionally `0x`-prefixed). A real base64 signature
 *  contains uppercase letters and `+`/`/`/`=` which won't pass the hex
 *  regex, so the hex pathway never false-matches a base64 input. */
function decodeSignatureBytes(s: string): Uint8Array | null {
	const stripped = s.replace(/^0x/i, '');
	if (stripped.length === 130 && /^[0-9a-fA-F]+$/.test(stripped)) {
		const buf = Buffer.from(stripped, 'hex');
		if (buf.length === 65) {
			return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
		}
	}
	try {
		const buf = Buffer.from(s, 'base64');
		if (buf.length === 65) {
			return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
		}
	} catch {
		// fall through to null
	}
	return null;
}

function base64UrlEncode(bytes: Uint8Array): string {
	return Buffer.from(bytes)
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

// ----------------------------------------------------------------------------
// Session token generation (used by /api/auth/verify after the signature is
// accepted; persisted in `sessions` and set as the cookie value).
// ----------------------------------------------------------------------------

export function newSessionId(): string {
	return base64UrlEncode(randomBytes(32));
}

export function sessionExpiry(): Date {
	return new Date(Date.now() + SESSION_TTL_MS);
}
