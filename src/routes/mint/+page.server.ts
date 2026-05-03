// /mint — wallet-gated CashTokens minting wizard (item #28).
//
// Auth-gated at the data level: unauthenticated visitors get an empty
// payload + an `unauthenticated: true` flag the UI uses to render the
// "log in to mint" splash instead of the wizard. We deliberately don't
// hard-redirect — the page can sell its own value first.
//
// Wizard state is persisted via /api/mint/sessions/[id] — saveSession
// fires on each step transition, and onMount resumes either the
// `?session=<id>` row (when linked from /mints) or otherwise the latest
// `drafting` row. The server-side schema lives in db/schema.sql
// (`user_mint_sessions`).

import { getSession } from '$lib/server/mintSessions';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		return { unauthenticated: true as const };
	}

	// Optional `?session=<id>` deep-link from /mints. We resolve the
	// session here (cashaddr-scoped via getSession) so the wizard can
	// hydrate from it directly instead of hitting /api/mint/sessions and
	// guessing which draft to resume. Only drafting/signed sessions are
	// resumable — broadcast/confirmed/failed/abandoned have no remaining
	// wizard work, so we silently ignore the param for those.
	const requestedId = url.searchParams.get('session');
	let resumeSession: {
		id: string;
		tokenType: string | null;
		ticker: string | null;
		name: string | null;
		description: string | null;
		decimals: number | null;
		supply: string | null;
		nftCapability: string | null;
		nftCommitmentHex: string | null;
	} | null = null;
	if (requestedId) {
		const s = await getSession(locals.user.cashaddr, requestedId);
		if (s && (s.state === 'drafting' || s.state === 'signed')) {
			resumeSession = {
				id: s.id,
				tokenType: s.tokenType,
				ticker: s.ticker,
				name: s.name,
				description: s.description,
				decimals: s.decimals,
				supply: s.supply,
				nftCapability: s.nftCapability,
				nftCommitmentHex: s.nftCommitmentHex
			};
		}
	}

	return {
		unauthenticated: false as const,
		cashaddr: locals.user.cashaddr,
		resumeSession
	};
};
