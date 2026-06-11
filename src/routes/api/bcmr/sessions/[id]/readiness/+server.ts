// GET /api/bcmr/sessions/[id]/readiness
//
// Returns a transaction-readiness report for the BCMR publish wizard's
// step 5 diagnostic card. Server-side — walks the authchain and fetches
// the wallet's full UTXO set so the client can render ✅/❌ requirements
// without needing to interpret raw BlockBook data.
//
// This is a read-only endpoint (no writes, no tx building). Designed to
// be called on every mount of step 5 and on every "Check wallet" click.
//
// Auth-gated. Returns 404 for unknown sessions / non-owner.

import { json, error } from '@sveltejs/kit';
import { getSession } from '$lib/server/bcmrPublishSessions';
import { fetchWalletUtxos } from '$lib/server/walletUtxos';
import { findAuthchainHead, isOwnerOfHeadVout0 } from '$lib/server/authchain';
import { query } from '$lib/server/db';
import type { RequestHandler } from './$types';

interface TokenRow {
	genesis_txid: Buffer;
	authchain_head_txid: Buffer | null;
}

function bufToHex(b: Buffer): string {
	return b.toString('hex');
}

interface ReadinessResponse {
	ownsAuthNft: boolean | null;
	authNftPresent: boolean;
	authNftValueSats: number | null;
	authchainHeadTxidHex: string | null;
	totalBchSats: string;
	plainUtxoCount: number;
	error?: string;
}

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Wallet sign-in required');
	const sessionId = params.id!;
	const cashaddr = locals.user.cashaddr;

	const session = await getSession(cashaddr, sessionId);
	if (!session) error(404, 'Session not found');

	const result: ReadinessResponse = {
		ownsAuthNft: null,
		authNftPresent: false,
		authNftValueSats: null,
		authchainHeadTxidHex: null,
		totalBchSats: '0',
		plainUtxoCount: 0
	};

	// Fetch full wallet UTXOs (including token-bearing — the funding-utxos
	// endpoint filters those out, but we need them to find the authNFT).
	let walletUtxos: Awaited<ReturnType<typeof fetchWalletUtxos>>;
	try {
		walletUtxos = await fetchWalletUtxos(cashaddr);
	} catch (err) {
		result.error = `UTXO fetch failed: ${(err as Error).message}`;
		return json(result);
	}

	// Plain BCH stats.
	const plainBch = walletUtxos.filter((u) => !u.tokenData);
	result.plainUtxoCount = plainBch.length;
	result.totalBchSats = String(plainBch.reduce((s, u) => s + u.valueSats, 0n));

	// Resolve the authchain head. Prefer cached; cold-walk if missing.
	const tokenRes = await query<TokenRow>(
		`SELECT genesis_txid, authchain_head_txid
		   FROM tokens
		  WHERE encode(category, 'hex') = $1`,
		[session.categoryHex]
	);
	const tokenRow = tokenRes.rows[0];
	if (!tokenRow) {
		result.error = `Category ${session.categoryHex} not found in indexer`;
		return json(result);
	}

	let headTxidHex: string | null = null;
	try {
		if (tokenRow.authchain_head_txid) {
			headTxidHex = bufToHex(tokenRow.authchain_head_txid);
			const owns = await isOwnerOfHeadVout0(headTxidHex, cashaddr);
			if (owns === null) {
				// Cache stale — cold walk.
				const cold = await findAuthchainHead(bufToHex(tokenRow.genesis_txid));
				headTxidHex = cold.headTxid;
				result.ownsAuthNft = cold.headVout0Addresses.includes(cashaddr);
			} else {
				result.ownsAuthNft = owns;
			}
		} else {
			// Cold start.
			const cold = await findAuthchainHead(bufToHex(tokenRow.genesis_txid));
			headTxidHex = cold.headTxid;
			result.ownsAuthNft = cold.headVout0Addresses.includes(cashaddr);
		}
	} catch (err) {
		result.error = `Authchain check failed: ${(err as Error).message}`;
		return json(result);
	}

	result.authchainHeadTxidHex = headTxidHex;

	// Check whether the authNFT UTXO is in the wallet.
	if (headTxidHex) {
		const authUtxo = walletUtxos.find(
			(u) => u.vout === 0 && u.txid.toLowerCase() === headTxidHex.toLowerCase()
		);
		result.authNftPresent = !!authUtxo;
		result.authNftValueSats = authUtxo ? Number(authUtxo.valueSats) : null;
	}

	return json(result);
};
