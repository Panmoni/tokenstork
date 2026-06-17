// Log-redaction helpers. Server-only.
//
// Two principles:
//   1. Never log raw signatures, nonces, or session ids — even truncated.
//      A nonce prefix is enough to correlate a failed-auth log line back
//      to a specific row in `auth_challenges`, which gives an attacker
//      with read access to either side a step toward the other.
//   2. Cashaddrs are public on-chain identifiers, but they tie a user's
//      browser to their wallet. Tag before logging so an aggregator
//      breach can't link a user across the corpus.

import { createHmac } from 'node:crypto';
import { env } from '$env/dynamic/private';

// Server-side HMAC key used to tag cashaddrs (and other moderately-
// sensitive identifiers) in logs. The default is a known non-secret
// string — it provides per-deployment unlinkability (log entries from
// different tokenstork instances won't collide), but anyone with source
// access can compute HMAC-SHA256 with this key and reverse the 12-char
// hex prefix back to a cashaddr by trial against known on-chain addresses.
//
// For production deployments where the logs are accessible to
// untrusted readers, set LOG_SALT to a random 256-bit hex string.
// HMAC still defends against precomputation (rainbow tables don't work
// without knowing the key), so the default is a reasonable defense-in-depth
// baseline for deployments where log access implies some operator trust.
const LOG_SALT = env.LOG_SALT ?? 'tokenstork-default-log-salt';

/** Tag a cashaddr (or other moderately-sensitive identifier) for safe
 *  logging. Returns a 12-char hex prefix — enough to correlate log
 *  lines that mention the same user, narrow enough that brute-forcing
 *  back to the original requires ~all known cashaddrs anyway. Uses
 *  HMAC-SHA256 so even a leaked LOG_SALT does not enable trivial
 *  precomputation. */
export function hashForLog(value: string): string {
	return createHmac('sha256', LOG_SALT).update(value).digest('hex').slice(0, 12);
}
