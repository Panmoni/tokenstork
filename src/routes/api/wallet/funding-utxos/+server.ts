// GET /api/wallet/funding-utxos — auth-gated. Returns the caller's
// spendable UTXOs at vout=0 that are suitable for funding a CashTokens
// genesis transaction. The category ID is the outpoint's txid, so the
// funding UTXO MUST be at vout=0 per the CashTokens spec.
//
// Filters:
//   - vout=0 only
//   - plain BCH (no token data — token-bearing UTXOs can't fund a new category)
//   - value >= 1500 sats (covers token dust + change dust + fee)
//
// Returns:
//   200  { utxos: FundingUtxo[], diag: { total, notVout0, hasTokens, tooSmall } }
//   401  if no authenticated session

import { error, json } from '@sveltejs/kit';
import { fetchWalletUtxos } from '$lib/server/walletUtxos';
import type { RequestHandler } from './$types';

/** Minimum satoshi value for a funding UTXO to be viable. Covers:
 *  - 1000 sats token-bearing output dust floor
 *  - ~546 sats change output dust threshold
 *  - ~300 sats fee (typical genesis tx is 250-350 bytes at 1 sat/byte) */
const MIN_FUNDING_SATS = 1500n;

export interface FundingUtxo {
	txid: string;
	valueSats: number;
	height: number;
}

export interface FundingUtxoDiag {
	/** Total spendable UTXOs BlockBook returned for this address. */
	total: number;
	/** UTXOs filtered because vout != 0. */
	notVout0: number;
	/** UTXOs filtered because they carry a token (can't seed a new category). */
	hasTokens: number;
	/** UTXOs filtered because value < MIN_FUNDING_SATS. */
	tooSmall: number;
	/** UTXOs that passed all filters (length of utxos array). */
	passed: number;
}

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, 'sign in required');
	}

	const allUtxos = await fetchWalletUtxos(locals.user.cashaddr);

	const diag: FundingUtxoDiag = {
		total: allUtxos.length,
		notVout0: 0,
		hasTokens: 0,
		tooSmall: 0,
		passed: 0
	};

	const fundingUtxos: FundingUtxo[] = [];
	for (const u of allUtxos) {
		if (u.vout !== 0) { diag.notVout0++; continue; }
		if (u.tokenData)   { diag.hasTokens++; continue; }
		if (u.valueSats < MIN_FUNDING_SATS) { diag.tooSmall++; continue; }

		fundingUtxos.push({
			txid: u.txid,
			valueSats: Number(u.valueSats),
			height: u.height
		});
	}
	diag.passed = fundingUtxos.length;

	fundingUtxos.sort((a, b) => b.valueSats - a.valueSats);

	return json({ utxos: fundingUtxos, diag });
};
