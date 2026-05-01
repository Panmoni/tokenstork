// Trusted client-IP extraction.
//
// The plain `cf-connecting-ip` / `x-forwarded-for` headers are
// attacker-controllable on any direct connection to the origin. We
// only honor them when:
//
//   1. An operator has set TRUST_PROXY_HEADERS=true (the deployment is
//      genuinely behind Cloudflare / a reverse proxy that strips these
//      headers from inbound traffic and re-inserts them itself), AND
//
//   2. Optionally, the immediate connection peer is in a configured
//      allowlist of CIDRs (TRUSTED_PROXY_CIDRS — defaults to Cloudflare's
//      published edge ranges). When the allowlist is empty the
//      TRUST_PROXY_HEADERS flag alone is sufficient (e.g., dev / a
//      single-tenant box where the firewall already enforces
//      "CF-only").
//
// Rate limiters and audit logs use this; authentication never trusts
// headers (the cookie is the only auth carrier).

import { env } from '$env/dynamic/private';

// Cloudflare's published IPv4 + IPv6 egress ranges. Refresh from
// https://www.cloudflare.com/ips/ when the list changes; CF is generally
// stable but additions do happen.
const CF_DEFAULT_CIDRS = [
	'173.245.48.0/20',
	'103.21.244.0/22',
	'103.22.200.0/22',
	'103.31.4.0/22',
	'141.101.64.0/18',
	'108.162.192.0/18',
	'190.93.240.0/20',
	'188.114.96.0/20',
	'197.234.240.0/22',
	'198.41.128.0/17',
	'162.158.0.0/15',
	'104.16.0.0/13',
	'104.24.0.0/14',
	'172.64.0.0/13',
	'131.0.72.0/22',
	'2400:cb00::/32',
	'2606:4700::/32',
	'2803:f800::/32',
	'2405:b500::/32',
	'2405:8100::/32',
	'2a06:98c0::/29',
	'2c0f:f248::/32'
];

const TRUST_PROXY = (env.TRUST_PROXY_HEADERS ?? '').toLowerCase() === 'true';

const TRUSTED_CIDRS = (() => {
	if (!TRUST_PROXY) return [];
	const fromEnv = (env.TRUSTED_PROXY_CIDRS ?? '').trim();
	if (fromEnv === '') return CF_DEFAULT_CIDRS.map(parseCidr).filter(notNull);
	// Explicit `*` means "trust every peer" — only valid when the
	// operator deliberately wants to disable peer-IP CIDR filtering
	// (typically a single-tenant box where the firewall already
	// enforces "proxy-only").
	if (fromEnv === '*') return [];
	const entries = fromEnv.split(',').map((c) => c.trim()).filter((c) => c.length > 0);
	const parsed = entries.map(parseCidr);
	const survivors = parsed.filter(notNull);
	// Distinguish "user provided malformed input" from "user provided
	// empty/star". If even one entry failed to parse, fail closed at
	// module load — silently degrading to "trust all" (which the
	// `survivors.length === 0` path in isTrustedPeer would otherwise
	// do) is the worst possible UX for a security control.
	if (survivors.length !== entries.length) {
		const bad = entries.filter((_, i) => parsed[i] === null);
		throw new Error(
			`TRUSTED_PROXY_CIDRS contains malformed entries: [${bad.join(', ')}]. ` +
				`Fix the env var, or set it to '*' to explicitly disable CIDR filtering.`
		);
	}
	return survivors;
})();

interface ParsedCidr {
	ip: bigint;
	prefix: number;
	v6: boolean;
}

function notNull<T>(x: T | null): x is T {
	return x !== null;
}

function parseCidr(cidr: string): ParsedCidr | null {
	const slash = cidr.lastIndexOf('/');
	if (slash < 0) return null;
	const addr = cidr.slice(0, slash);
	const prefix = Number(cidr.slice(slash + 1));
	if (!Number.isInteger(prefix) || prefix < 0) return null;
	const ip = ipToBigint(addr);
	if (ip === null) return null;
	const v6 = addr.includes(':');
	return { ip, prefix, v6 };
}

function ipToBigint(addr: string): bigint | null {
	if (addr.includes(':')) return ipv6ToBigint(addr);
	const parts = addr.split('.');
	if (parts.length !== 4) return null;
	let n = 0n;
	for (const p of parts) {
		const o = Number(p);
		if (!Number.isInteger(o) || o < 0 || o > 255) return null;
		n = (n << 8n) | BigInt(o);
	}
	return n;
}

function ipv6ToBigint(addr: string): bigint | null {
	// Strip zone id (`fe80::1%eth0`).
	const noZone = addr.split('%')[0];
	const halves = noZone.split('::');
	if (halves.length > 2) return null;
	const left = halves[0] === '' ? [] : halves[0].split(':');
	const right = halves.length === 2 && halves[1] !== '' ? halves[1].split(':') : [];
	const total = left.length + right.length;
	if (total > 8) return null;
	const fill = halves.length === 2 ? new Array(8 - total).fill('0') : [];
	const groups = halves.length === 2 ? [...left, ...fill, ...right] : left;
	if (groups.length !== 8) return null;
	let n = 0n;
	for (const g of groups) {
		if (g.length === 0 || g.length > 4 || !/^[0-9a-fA-F]+$/.test(g)) return null;
		n = (n << 16n) | BigInt(parseInt(g, 16));
	}
	return n;
}

function ipInCidr(ip: bigint, cidr: ParsedCidr, ipIsV6: boolean): boolean {
	if (cidr.v6 !== ipIsV6) return false;
	const totalBits = ipIsV6 ? 128 : 32;
	if (cidr.prefix > totalBits) return false;
	const shift = BigInt(totalBits - cidr.prefix);
	return (ip >> shift) === (cidr.ip >> shift);
}

function isTrustedPeer(peer: string): boolean {
	if (!TRUST_PROXY) return false;
	if (TRUSTED_CIDRS.length === 0) return true;
	const v6 = peer.includes(':');
	const ip = ipToBigint(peer);
	if (ip === null) return false;
	return TRUSTED_CIDRS.some((c) => ipInCidr(ip, c, v6));
}

export interface ClientIpInput {
	request: Request;
	getClientAddress: () => string;
}

/** Returns the best-trusted client IP, or `'unknown'` when none is
 *  available. The string is suitable for use as a rate-limit bucket key
 *  but **must not** be used for authentication: the cookie is the only
 *  auth carrier.
 *
 *  Trust order:
 *    1. cf-connecting-ip / x-forwarded-for — only when both
 *       TRUST_PROXY_HEADERS=true AND the immediate peer is in the
 *       trusted-proxy CIDR allowlist.
 *    2. SvelteKit's getClientAddress() — the resolved socket address.
 *    3. 'unknown' sentinel — keeps un-attributable traffic in a single
 *       global bucket rather than letting them bypass limits entirely. */
export function clientIp({ request, getClientAddress }: ClientIpInput): string {
	let peer: string;
	try {
		peer = getClientAddress();
	} catch {
		peer = '';
	}

	if (peer && isTrustedPeer(peer)) {
		const cf = request.headers.get('cf-connecting-ip');
		if (cf && cf.trim() !== '') return cf.trim();
		const xff = request.headers.get('x-forwarded-for');
		if (xff) {
			// XFF chains are appended on each hop; the leftmost entry is
			// the original client. When TRUST_PROXY_HEADERS=true we trust
			// the proxy to have stripped any pre-existing chain.
			const first = xff.split(',')[0]?.trim();
			if (first) return first;
		}
	}

	return peer || 'unknown';
}
