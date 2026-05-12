// /publish-bcmr/[id] — wizard SSR for one BCMR publish session.
//
// Auth-gated and cashaddr-scoped at the data layer: a session ID guess
// from another wallet returns null from getSession (same handling as
// /api/bcmr/sessions/[id]) and we redirect back to the landing page
// rather than leak existence.

import { error, redirect } from '@sveltejs/kit';
import { getSession } from '$lib/server/bcmrPublishSessions';
import { query } from '$lib/server/db';
import { bcmrFromBody } from '$lib/server/external';
import type { PageServerLoad } from './$types';

interface TokenRow {
	token_type: string;
	name: string | null;
	symbol: string | null;
	decimals: number | null;
	description: string | null;
	icon_uri: string | null;
	bcmr_source: string | null;
	bcmr_body: unknown;
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.user) {
		throw redirect(303, `/login?return=${encodeURIComponent(url.pathname)}`);
	}
	const id = params.id!;
	const session = await getSession(locals.user.cashaddr, id);
	if (!session) {
		throw redirect(303, '/publish-bcmr');
	}

	// Pull the linked tokens / token_metadata row so the wizard can:
	//  - Surface token_type (so NFT-shape fields would be relevant if we
	//    grew per-NFT publication; today not used but threaded for
	//    forward-compat)
	//  - Pre-fill identity fields when updating an existing BCMR
	//    (operator decision 2026-05-12: update-flow is in v1)
	const tokenRes = await query<TokenRow>(
		`SELECT t.token_type,
		        m.name, m.symbol, m.decimals, m.description, m.icon_uri,
		        m.bcmr_source, m.bcmr_body
		   FROM tokens t
		   LEFT JOIN token_metadata m ON m.category = t.category
		  WHERE encode(t.category, 'hex') = $1`,
		[session.categoryHex]
	);
	const row = tokenRes.rows[0];
	if (!row) {
		// The session refers to a category the indexer doesn't know about
		// — shouldn't happen in practice (the wizard only allows starting
		// for categories the wallet holds authNFTs for, which by definition
		// are in `tokens`). Treat as fatal.
		error(500, `Category ${session.categoryHex} not found in indexer`);
	}

	const isUpdate = row.bcmr_source === 'onchain';
	const cachedBcmr = isUpdate ? bcmrFromBody(row.bcmr_body, session.categoryHex) : null;

	return {
		session,
		category: {
			hex: session.categoryHex,
			tokenType: row.token_type as 'FT' | 'NFT' | 'FT+NFT',
			currentName: row.name ?? cachedBcmr?.name ?? null,
			currentSymbol: row.symbol ?? cachedBcmr?.symbol ?? null,
			currentDecimals: row.decimals ?? cachedBcmr?.decimals ?? 0,
			currentDescription: row.description ?? cachedBcmr?.description ?? null,
			currentIconUri: row.icon_uri ?? cachedBcmr?.iconUri ?? null
		},
		isUpdate
	};
};
