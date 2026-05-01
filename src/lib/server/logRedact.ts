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
// sensitive identifiers) in logs. Falling back to a non-secret default
// is a defense-in-depth nicety — the logs still get per-deployment
// unlinkability without operator action; an operator who wants strict
// per-user unlinkability sets LOG_SALT to a random string and rotates
// it on incident.
//
// HMAC (rather than salted SHA-256) defends against precomputation
// even when the key is known: an attacker who reads the source and
// learns the default `LOG_SALT` cannot precompute a rainbow table
// keyed on cashaddr without the HMAC's per-block keying.
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
