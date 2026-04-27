// /mint — wallet-gated CashTokens minting wizard (item #28).
//
// Auth-gated at the data level: unauthenticated visitors get an empty
// payload + an `unauthenticated: true` flag the UI uses to render the
// "log in to mint" splash instead of the wizard. We deliberately don't
// hard-redirect — the page can sell its own value first.
//
// This is batch 1 of the mint feature: foundation only. The wizard's
// step state lives in browser memory for now; batch 2 adds the
// `user_mint_sessions` round-trip so progress persists across browser
// refreshes. Schema is already in place (db/schema.sql).

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		return { unauthenticated: true as const };
	}
	return {
		unauthenticated: false as const,
		cashaddr: locals.user.cashaddr
	};
};
