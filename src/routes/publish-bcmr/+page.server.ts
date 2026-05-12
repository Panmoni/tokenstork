// /publish-bcmr — wallet-gated landing route for the BCMR publish wizard (#33).
//
// Lists every category where the authenticated wallet holds the authNFT:
//   1. Fetch all UTXOs the wallet currently owns via BlockBook.
//   2. Filter to (vout = 0 AND tokenData != null) — those are authNFT-shape
//      outputs. (A wallet might also hold non-authority token outputs at
//      vout=0 — e.g. someone sent them an NFT — but only authNFT-shape
//      outputs at the authchain head can be spent to publish BCMR.)
//   3. Match those UTXOs against `tokens.authchain_head_txid` (cached by
//      sync-bcmr-onchain) OR `tokens.genesis_txid` (covers brand-new
//      categories the walker hasn't visited yet). The matched tokens are
//      the eligible categories.
//
// Single BlockBook call + single DB query, regardless of how many tokens
// exist in the directory. Performance scales with the wallet's UTXO count,
// not the directory size.

import { redirect } from '@sveltejs/kit';
import { query, bytesFromHex, hexFromBytes } from '$lib/server/db';
import { fetchWalletUtxos } from '$lib/server/walletUtxos';
import { NOT_MODERATED_CLAUSE } from '$lib/moderation';
import { listSessions } from '$lib/server/bcmrPublishSessions';
import type { PageServerLoad } from './$types';

interface EligibilityRow {
	category: Buffer;
	name: string | null;
	symbol: string | null;
	decimals: number | null;
	description: string | null;
	icon_uri: string | null;
	icon_cleared_hash: string | null;
	bcmr_source: string | null;
	token_type: string;
	authchain_head_txid: Buffer | null;
}

export interface EligibleCategory {
	categoryHex: string;
	name: string | null;
	symbol: string | null;
	decimals: number;
	description: string | null;
	iconUri: string | null;
	iconClearedHash: string | null;
	tokenType: 'FT' | 'NFT' | 'FT+NFT';
	hasBcmr: boolean; // determines "Publish BCMR" vs "Update BCMR" CTA wording
}

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		throw redirect(303, `/login?return=${encodeURIComponent(url.pathname)}`);
	}
	const cashaddr = locals.user.cashaddr;

	// 1. Pull wallet UTXOs. Token-bearing outputs at vout=0 are the
	//    candidate authNFTs. If BlockBook is unreachable we surface an
	//    empty list with a flag rather than 500-ing — the user sees a
	//    "couldn't reach the indexer; retry shortly" message.
	let walletUtxos: Awaited<ReturnType<typeof fetchWalletUtxos>> | null = null;
	let utxoFetchError: string | null = null;
	try {
		walletUtxos = await fetchWalletUtxos(cashaddr);
	} catch (err) {
		utxoFetchError = (err as Error).message ?? 'failed to reach indexer';
	}

	const candidateTxids: string[] = walletUtxos
		? walletUtxos.filter((u) => u.vout === 0 && u.tokenData != null).map((u) => u.txid)
		: [];

	// 2. Match candidate UTXO txids against tokens.authchain_head_txid
	//    (walker-cached) OR tokens.genesis_txid (covers categories the
	//    walker hasn't visited yet — common for freshly-minted tokens
	//    the user wants to register BCMR for immediately). Moderation
	//    filter applied so hidden tokens never surface in the wizard.
	let eligible: EligibleCategory[] = [];
	if (candidateTxids.length > 0) {
		const txidBytea = candidateTxids.map((hex) => bytesFromHex(hex));
		const res = await query<EligibilityRow>(
			`SELECT t.category,
			        m.name,
			        m.symbol,
			        m.decimals,
			        m.description,
			        m.icon_uri,
			        encode(imo.content_hash, 'hex') AS icon_cleared_hash,
			        m.bcmr_source,
			        t.token_type,
			        t.authchain_head_txid
			   FROM tokens t
			   LEFT JOIN token_metadata m ON m.category = t.category
			   LEFT JOIN icon_url_scan ius ON ius.icon_uri = m.icon_uri
			   LEFT JOIN icon_moderation imo
			          ON imo.content_hash = ius.content_hash AND imo.state = 'cleared'
			  WHERE (t.authchain_head_txid = ANY($1::bytea[])
			         OR (t.authchain_head_txid IS NULL AND t.genesis_txid = ANY($1::bytea[])))
			    AND ${NOT_MODERATED_CLAUSE}
			  ORDER BY m.name ASC NULLS LAST, t.first_seen_at DESC`,
			[txidBytea]
		);
		eligible = res.rows.map((r) => ({
			categoryHex: hexFromBytes(r.category)!,
			name: r.name,
			symbol: r.symbol,
			decimals: r.decimals ?? 0,
			description: r.description,
			iconUri: r.icon_uri,
			iconClearedHash: r.icon_cleared_hash,
			tokenType: r.token_type as 'FT' | 'NFT' | 'FT+NFT',
			hasBcmr: r.bcmr_source === 'onchain'
		}));
	}

	// 3. In-progress draft sessions for the user. Surfaces a "resume" CTA
	//    when the user previously started but didn't finish.
	const drafts = (await listSessions(cashaddr, 20, 0)).filter(
		(s) => s.state === 'drafting' || s.state === 'signed'
	);

	return {
		cashaddr,
		eligible,
		drafts: drafts.map((d) => ({
			id: d.id,
			categoryHex: d.categoryHex,
			state: d.state,
			name: d.name,
			updatedAt: d.updatedAt
		})),
		utxoFetchError
	};
};
