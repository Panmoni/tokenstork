// POST /api/bcmr/sessions/[id]/build-tx
//
// Preconditions (otherwise 409):
//   - session is in 'drafting' state
//   - publication_verified_at is set (step 4 complete)
//   - content_hash is set (step 3 complete)
//
// Sequence:
//   1. Resolve the authchain head — preferring tokens.authchain_head_txid
//      (cached by sync-bcmr-onchain), falling back to a cold-start
//      authchain walk via authchain.ts if the cache is null.
//   2. Verify the wallet currently owns vout=0 of the head. If the
//      cache is stale (head already spent), trigger a fresh walk; if
//      ownership doesn't match, reject (the authchain advanced out from
//      under the user — they need to refresh and restart).
//   3. Fetch the wallet's UTXOs from BlockBook.
//   4. Find the authNFT UTXO: matches the head txid at vout=0.
//   5. Call bcmrPublishBuilder to assemble the unsigned tx.
//   6. Persist unsigned_tx_hex + authchain_head_txid_at_session.
//
// Append-only guards on the session row mean a retried build against a
// row that already has unsigned_tx_hex returns 409 — the wizard should
// proceed to step 5 instead of re-building.

import { json, error, isHttpError } from '@sveltejs/kit';
import { getSession, updateSession } from '$lib/server/bcmrPublishSessions';
import { fetchWalletUtxos } from '$lib/server/walletUtxos';
import { findAuthchainHead, isOwnerOfHeadVout0 } from '$lib/server/authchain';
import { buildBcmrPublishTx, BcmrPublishBuildError } from '$lib/server/bcmrPublishBuilder';
import { query } from '$lib/server/db';
import type { RequestHandler } from './$types';

interface TokenRow {
	genesis_txid: Buffer;
	authchain_head_txid: Buffer | null;
}

function bufToHex(b: Buffer): string {
	return b.toString('hex');
}

export const POST: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Wallet sign-in required');
	const sessionId = params.id!;
	const cashaddr = locals.user.cashaddr;

	const session = await getSession(cashaddr, sessionId);
	if (!session) error(404, 'Session not found');
	if (session.state !== 'drafting') {
		error(409, `Session is in state '${session.state}'; only drafting sessions can build tx`);
	}
	if (!session.contentHashHex) error(409, 'Canonicalize first (step 3)');
	if (!session.publicationVerifiedAt) error(409, 'Verify your host first (step 4)');
	if (!session.publicationUri) error(409, 'No verified publication URI on session');
	if (session.unsignedTxHex) {
		// Already built. Don't rebuild — return the existing hex so the
		// wizard advances. Idempotency keeps repeated POSTs cheap.
		return json({
			unsignedTxHex: session.unsignedTxHex,
			alreadyBuilt: true,
			session
		});
	}

	// Resolve the authchain head. Prefer the cached value; cold-walk if
	// missing.
	const tokenRes = await query<TokenRow>(
		`SELECT genesis_txid, authchain_head_txid
		   FROM tokens
		  WHERE encode(category, 'hex') = $1`,
		[session.categoryHex]
	);
	const tokenRow = tokenRes.rows[0];
	if (!tokenRow) error(404, `Category ${session.categoryHex} not found in tokens table`);

	let headTxidHex: string;
	if (tokenRow.authchain_head_txid) {
		headTxidHex = bufToHex(tokenRow.authchain_head_txid);
		// Verify the cache is still valid (head hasn't been spent by
		// someone else mid-flight). If stale, cold-walk.
		try {
			const owns = await isOwnerOfHeadVout0(headTxidHex, cashaddr);
			if (owns === null) {
				// Cache stale — fall back to cold walk.
				const cold = await findAuthchainHead(bufToHex(tokenRow.genesis_txid));
				headTxidHex = cold.headTxid;
				if (!cold.headVout0Addresses.includes(cashaddr)) {
					error(
						403,
						`The authority NFT for this category has moved to a different wallet (current owner: ${
							cold.headVout0Addresses[0] ?? 'unknown'
						}). Refresh /publish-bcmr to see your current eligibility.`
					);
				}
			} else if (!owns) {
				error(403, 'Your wallet no longer holds the authority NFT for this category.');
			}
		} catch (err) {
			if (isHttpError(err)) throw err;
			console.error('[api/bcmr/build-tx] ownership-check error:', err);
			error(502, `authchain ownership check failed: ${(err as Error).message}`);
		}
	} else {
		// Cold-start walk — the BCMR onchain walker hasn't visited this
		// category yet.
		try {
			const cold = await findAuthchainHead(bufToHex(tokenRow.genesis_txid));
			headTxidHex = cold.headTxid;
			if (!cold.headVout0Addresses.includes(cashaddr)) {
				error(
					403,
					`The authority NFT for this category is held by a different wallet (current owner: ${
						cold.headVout0Addresses[0] ?? 'unknown'
					}).`
				);
			}
		} catch (err) {
			if (isHttpError(err)) throw err;
			console.error('[api/bcmr/build-tx] cold-walk error:', err);
			error(502, `authchain walk failed: ${(err as Error).message}`);
		}
	}

	// Fetch wallet UTXOs. The authNFT UTXO must be among these — if not,
	// the wallet doesn't actually hold the authority NFT (despite the
	// ownership check above saying it does), which would mean a TOCTOU
	// race between BlockBook's address lookup and its UTXO endpoint.
	// Surface as 409 so the user can retry.
	let walletUtxos: Awaited<ReturnType<typeof fetchWalletUtxos>>;
	try {
		walletUtxos = await fetchWalletUtxos(cashaddr);
	} catch (err) {
		console.error('[api/bcmr/build-tx] fetchWalletUtxos error:', err);
		error(502, `BlockBook UTXO fetch failed: ${(err as Error).message}`);
	}

	const authNftUtxo = walletUtxos.find(
		(u) => u.vout === 0 && u.txid.toLowerCase() === headTxidHex.toLowerCase()
	);
	if (!authNftUtxo) {
		error(
			409,
			'authNFT UTXO not found in wallet (TOCTOU between ownership check and UTXO fetch?); refresh and retry'
		);
	}
	if (!authNftUtxo.tokenData) {
		// Shouldn't happen — vout=0 of an authchain head is always token-
		// bearing by spec. Defensive check.
		error(500, 'authNFT UTXO has no token_data; authchain inconsistent');
	}

	// All non-authNFT UTXOs are available for BCH funding (filter out
	// the authNFT itself from the pool; the builder will pick from this
	// list only if needed).
	const availableBchUtxos = walletUtxos.filter(
		(u) => !(u.vout === 0 && u.txid.toLowerCase() === headTxidHex.toLowerCase())
	);

	// Build.
	let build: ReturnType<typeof buildBcmrPublishTx>;
	try {
		build = buildBcmrPublishTx({
			senderCashaddr: cashaddr,
			authNftUtxo,
			availableBchUtxos,
			contentHashHex: session.contentHashHex,
			publicationUri: session.publicationUri
		});
	} catch (err) {
		if (err instanceof BcmrPublishBuildError) {
			error(400, `Tx build failed: ${err.message}`);
		}
		console.error('[api/bcmr/build-tx] builder error:', err);
		error(500, 'Tx build failed (unexpected)');
	}

	// Persist. Append-only guard on authchain_head_txid_at_session
	// (column is checked via `IS NULL` in updateSession's immutability
	// guard) means a retried build against an already-recorded head
	// returns null → 409.
	const updated = await updateSession(cashaddr, sessionId, {
		unsignedTxHex: build.unsignedTxHex,
		authchainHeadTxidHex: headTxidHex
	});
	if (!updated) {
		error(409, 'Session changed during build (retry will return the existing unsigned hex)');
	}

	return json({
		unsignedTxHex: build.unsignedTxHex,
		sourceOutputs: build.sourceOutputs,
		feeSats: build.feeSats,
		changeSats: build.changeSats,
		authNftOutputSats: build.authNftOutputSats,
		encodedTxBytes: build.encodedTxBytes,
		authchainHeadTxidHex: headTxidHex,
		alreadyBuilt: false,
		session: updated
	});
};
