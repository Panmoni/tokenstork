// Operator (admin) allowlist — single source of truth for every admin
// surface on the site (/admin/bcmr-submissions, /admin/icons, and their
// action endpoints).
//
// Two sources, unioned:
//   1. HARDCODED_ADMIN_CASHADDRS — baked-in operator wallets that are
//      ALWAYS admin, independent of any env config. Lets the primary
//      operator review queues on a fresh box before BCMR_ADMIN_CASHADDRS
//      is even set.
//   2. BCMR_ADMIN_CASHADDRS — comma-separated cashaddr allowlist from the
//      environment (kept for backwards compatibility + per-deploy extras).
//
// The comparison is exact-string against `locals.user.cashaddr`, which
// hooks.server.ts populates from the session — and that value is the
// canonical libauth form produced by `encodeCashAddress(...).address`,
// i.e. it ALWAYS carries the `bitcoincash:` prefix. Entries here MUST be
// in that same full prefixed form or they will never match.

import { env } from '$env/dynamic/private';

// Primary operator wallet. Full `bitcoincash:` form to match
// locals.user.cashaddr exactly.
const HARDCODED_ADMIN_CASHADDRS: readonly string[] = [
	'bitcoincash:qr033df3ym99dqru8a6gtwfus8t8g9w5lsve42m0df'
];

/** True iff `cashaddr` is an operator. Use in route loaders + action
 *  endpoints before exposing any admin surface. Null/empty is never
 *  admin (defensive — an unauthenticated request has no cashaddr). */
export function isAdmin(cashaddr: string | null | undefined): boolean {
	if (!cashaddr) return false;
	if (HARDCODED_ADMIN_CASHADDRS.includes(cashaddr)) return true;
	const raw = env.BCMR_ADMIN_CASHADDRS || '';
	return raw
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
		.includes(cashaddr);
}
