// /mint — wallet-gated CashTokens minting wizard (item #28).
//
// Auth-gated at the data level: unauthenticated visitors get an empty
// payload + an `unauthenticated: true` flag the UI uses to render the
// "log in to mint" splash instead of the wizard. We deliberately don't
// hard-redirect — the page can sell its own value first.
//
// Wizard state is persisted via /api/mint/sessions/[id] — saveSession
// fires on each step transition, and onMount resumes the latest
// `drafting` row. The server-side schema lives in db/schema.sql
// (`user_mint_sessions`). This loader stays minimal: it's just the
// auth gate + the cashaddr the wizard targets as the recipient.

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
