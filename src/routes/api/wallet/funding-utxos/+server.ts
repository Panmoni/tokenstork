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
// Returns { utxos: FundingUtxo[] } sorted by value descending.
//   200  on success (including empty list)
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
	/** Satoshi value as a number (safe — will never exceed Number.MAX_SAFE_INTEGER
	 *  for a funding UTXO, since these are small self-send amounts). */
	valueSats: number;
	/** BlockBook confirmed height, or -1 for mempool. */
	height: number;
}

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, 'sign in required');
	}

	const allUtxos = await fetchWalletUtxos(locals.user.cashaddr);

	const fundingUtxos: FundingUtxo[] = [];
	for (const u of allUtxos) {
		// Must be vout=0 per CashTokens category-id derivation.
		if (u.vout !== 0) continue;
		// Token-bearing UTXOs carry an existing category — can't be used
		// to seed a new one (the category would collide).
		if (u.tokenData) continue;
		// Must have enough value to cover dust + fee.
		if (u.valueSats < MIN_FUNDING_SATS) continue;

		fundingUtxos.push({
			txid: u.txid,
			valueSats: Number(u.valueSats),
			height: u.height
		});
	}

	// Sort descending by value so the largest UTXO (most fee headroom) is first.
	fundingUtxos.sort((a, b) => b.valueSats - a.valueSats);

	return json({ utxos: fundingUtxos });
};
