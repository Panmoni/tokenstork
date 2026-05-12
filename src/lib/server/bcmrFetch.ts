// Defense-in-depth fetcher for BCMR publication URIs that publishers
// host themselves. Sits between the SvelteKit `/api/bcmr/sessions/[id]/
// verify-uri` endpoint and the upstream URL the user pasted.
//
// The load-bearing safety property is the hash gate: we always sha256
// the response body and only accept it if the digest matches the
// session's pre-computed `content_hash`. So a wrong-host fetch fails
// verification and goes nowhere; the SSRF concern is reduced to
// signal-leak (an authenticated user could probe internal hosts and
// learn "did this URL respond" via response codes).
//
// Mitigations layered here (defense in depth):
//   1. Scheme must be https://. No http://, file://, data:, ipfs://,
//      etc. The user can host on any IPFS gateway they like — they
//      paste the resolved gateway URL.
//   2. DNS resolution → IP allowlist check. Loopback, private,
//      link-local, CGNAT, multicast, and the 169.254.169.254 cloud
//      metadata IP are all rejected.
//   3. Body size capped at 8 MiB (matches the worker's
//      BCMR_ONCHAIN_MAX_BODY_BYTES default — the on-chain walker uses
//      the same limit for fetching publisher URIs).
//   4. Timeout (default 15s, generous for cold-cache IPFS gateway
//      fetches but tight enough that a hostile peer can't stall a
//      Node worker).
//   5. No redirects followed. Cleanest mitigation against the
//      DNS-rebinding-after-redirect class of attacks; if a publisher
//      redirects (common for CDN-fronted URLs) the user should paste
//      the final URL.
//
// Known gap: DNS rebinding (first lookup → public IP, connection-time
// lookup → private IP). Closing this fully requires pinned-IP
// connections via custom `https.Agent`, which Node's fetch doesn't
// expose cleanly. The hash gate eliminates the data-exfiltration risk;
// the residual probe-only leak is documented and accepted for v1.

import { lookup as dnsLookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';
import { timedFetch } from './fetch';

export interface BcmrFetchResult {
	bodyBytes: Uint8Array;
	sha256Hex: string;
	sizeBytes: number;
}

export class BcmrFetchError extends Error {
	constructor(
		message: string,
		public readonly kind:
			| 'invalid-scheme'
			| 'invalid-url'
			| 'dns-resolution'
			| 'private-ip'
			| 'http-status'
			| 'oversize'
			| 'fetch-failed'
			| 'redirect-refused'
	) {
		super(message);
	}
}

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Fetch a publisher's BCMR-hosted URL safely. The caller compares the
 * returned sha256 with the on-chain (or pre-computed) content_hash —
 * we don't enforce a match here, the verify-uri endpoint does that.
 *
 * Throws `BcmrFetchError` with a `kind` discriminator on any failure
 * so the caller can map to a precise user-facing error message.
 */
export async function fetchAndHashBcmr(rawUrl: string): Promise<BcmrFetchResult> {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		throw new BcmrFetchError('URL is malformed', 'invalid-url');
	}

	// 1. Scheme gate. https only.
	if (parsed.protocol !== 'https:') {
		throw new BcmrFetchError(
			`URL must be https:// (got ${parsed.protocol})`,
			'invalid-scheme'
		);
	}

	// 2. DNS → IP allowlist. Reject every reserved range that an SSRF
	//    probe would target. Resolves only the hostname; the actual fetch
	//    below still does its own resolution (TOCTOU gap → DNS rebinding,
	//    documented in module header).
	let resolved: Awaited<ReturnType<typeof dnsLookup>>;
	try {
		resolved = await dnsLookup(parsed.hostname, { verbatim: true });
	} catch (err) {
		throw new BcmrFetchError(
			`DNS resolution failed: ${(err as Error).message}`,
			'dns-resolution'
		);
	}
	if (isDisallowedIp(resolved.address, resolved.family)) {
		throw new BcmrFetchError(
			`URL resolves to a private/reserved address: ${resolved.address}`,
			'private-ip'
		);
	}

	// 3. Fetch with manual redirect=manual so a 3xx response surfaces as
	//    an error rather than auto-following (defense against
	//    redirect-to-private-IP attacks). User can paste the final URL
	//    if their host serves via a redirect.
	let res: Response;
	try {
		res = await timedFetch(parsed.toString(), {
			method: 'GET',
			redirect: 'manual',
			timeoutMs: DEFAULT_TIMEOUT_MS,
			headers: { accept: 'application/json, */*;q=0.5' }
		});
	} catch (err) {
		throw new BcmrFetchError(
			`fetch failed: ${(err as Error).message}`,
			'fetch-failed'
		);
	}
	if (res.status >= 300 && res.status < 400) {
		throw new BcmrFetchError(
			`URL returned a redirect (HTTP ${res.status}); paste the final URL directly`,
			'redirect-refused'
		);
	}
	if (!res.ok) {
		throw new BcmrFetchError(`URL returned HTTP ${res.status}`, 'http-status');
	}

	// 4. Stream + cap body size. We DON'T trust the Content-Length header
	//    — applying the cap to actually-received bytes prevents a peer
	//    that lies in the header (claims 1 KB, streams 1 GB) from
	//    bypassing the limit.
	const reader = res.body?.getReader();
	if (!reader) {
		throw new BcmrFetchError('response has no body stream', 'fetch-failed');
	}
	const chunks: Uint8Array[] = [];
	let received = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		received += value.byteLength;
		if (received > MAX_BODY_BYTES) {
			try {
				await reader.cancel();
			} catch {
				/* best effort */
			}
			throw new BcmrFetchError(
				`response exceeds ${MAX_BODY_BYTES}-byte cap`,
				'oversize'
			);
		}
		chunks.push(value);
	}
	const total = new Uint8Array(received);
	let offset = 0;
	for (const c of chunks) {
		total.set(c, offset);
		offset += c.byteLength;
	}

	const sha256Hex = createHash('sha256').update(total).digest('hex');
	return { bodyBytes: total, sha256Hex, sizeBytes: received };
}

function isDisallowedIp(addr: string, family: number): boolean {
	if (family === 4 && isIPv4(addr)) {
		const octets = addr.split('.').map(Number);
		if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
			return true; // malformed → treat as disallowed
		}
		const [a, b] = octets;
		// 10.0.0.0/8
		if (a === 10) return true;
		// 172.16.0.0/12
		if (a === 172 && b >= 16 && b <= 31) return true;
		// 192.168.0.0/16
		if (a === 192 && b === 168) return true;
		// 127.0.0.0/8 (loopback)
		if (a === 127) return true;
		// 169.254.0.0/16 (link-local + AWS metadata 169.254.169.254)
		if (a === 169 && b === 254) return true;
		// 100.64.0.0/10 (CGNAT)
		if (a === 100 && b >= 64 && b <= 127) return true;
		// 224.0.0.0/4 (multicast) + 240.0.0.0/4 (reserved)
		if (a >= 224) return true;
		// 0.0.0.0/8 (unspecified)
		if (a === 0) return true;
		return false;
	}
	if (family === 6 && isIPv6(addr)) {
		const lower = addr.toLowerCase();
		// ::1 (loopback) and :: (unspecified)
		if (lower === '::1' || lower === '::') return true;
		// ::ffff:* (IPv4-mapped) — recurse on the v4 portion
		if (lower.startsWith('::ffff:')) {
			const v4 = lower.slice('::ffff:'.length);
			if (isIPv4(v4)) return isDisallowedIp(v4, 4);
		}
		// fe80::/10 (link-local)
		if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
			return true;
		}
		// fc00::/7 (ULA, RFC 4193)
		if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
		// ff00::/8 (multicast)
		if (lower.startsWith('ff')) return true;
		// 2001:db8::/32 (documentation)
		if (lower.startsWith('2001:db8:') || lower.startsWith('2001:0db8:')) return true;
		return false;
	}
	// Unknown family / unparseable address → disallowed by default.
	return true;
}
