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
//   200  { utxos: FundingUtxo[], plainUtxos: PlainUtxo[], diag: { total, notVout0, hasTokens, tooSmall } }
//   401  if no authenticated session

import { error, json } from '@sveltejs/kit';
import { fetchWalletUtxos } from '$lib/server/walletUtxos';
import type { RequestHandler } from './$types';

/** Minimum satoshi value for a funding UTXO to be viable. Covers:
 *  - 1000 sats token-bearing output dust floor
 *  - ~546 sats change output dust threshold
 *  - ~300 sats fee (typical genesis tx is 250-350 bytes at 1 sat/byte) */
const MIN_FUNDING_SATS = 1500n;
/** Minimum value for a plain-BCH UTXO to be worth consolidating. */
const MIN_PLAIN_SATS = 546n;

export interface FundingUtxo {
	txid: string;
	valueSats: number;
	height: number;
}

export interface PlainUtxo {
	txid: string;
	vout: number;
	valueSats: number;
	height: number;
}

export interface FundingUtxoDiag {
	total: number;
	notVout0: number;
	hasTokens: number;
	tooSmall: number;
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
	const plainUtxos: PlainUtxo[] = [];
	for (const u of allUtxos) {
		// Track non-vout-0 FIRST (before token check) so the diag is
		// mutually exclusive with the vout=0 funding list, not with the
		// token list.
		if (u.vout !== 0) { diag.notVout0++; }
		if (u.tokenData) {
			diag.hasTokens++;
			// BlockBook sometimes reports tokenData on UTXOs that have
			// zero token amount (dust from airdrops). Treat those as
			// plain BCH for consolidation purposes.
			if (u.tokenData.amount === 0n && u.valueSats >= MIN_PLAIN_SATS) {
				plainUtxos.push({
					txid: u.txid,
					vout: u.vout,
					valueSats: Number(u.valueSats),
					height: u.height
				});
			}
		} else if (u.valueSats >= MIN_PLAIN_SATS) {
			plainUtxos.push({
				txid: u.txid,
				vout: u.vout,
				valueSats: Number(u.valueSats),
				height: u.height
			});
		}

		// Funding-eligible: must be vout=0, no token data, and ≥ min
		// funding sats. (We already counted notVout0 and hasTokens above;
		// these continue statements are just for the funding list.)
		if (u.vout !== 0) continue;
		if (u.tokenData) continue;
		if (u.valueSats < MIN_FUNDING_SATS) { diag.tooSmall++; continue; }

		fundingUtxos.push({
			txid: u.txid,
			valueSats: Number(u.valueSats),
			height: u.height
		});
	}
	diag.passed = fundingUtxos.length;

	fundingUtxos.sort((a, b) => b.valueSats - a.valueSats);
	plainUtxos.sort((a, b) => b.valueSats - a.valueSats);

	return json({ utxos: fundingUtxos, plainUtxos, diag });
};
