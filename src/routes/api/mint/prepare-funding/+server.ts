// POST /api/mint/prepare-funding — auth-gated.
// Builds a consolidation transaction that spends all of the caller's
// plain-BCH UTXOs into a single P2PKH output to their own address.
// The single output at vout=0 becomes the funding UTXO for step 4.
//
// Returns:
//   200  { unsignedTxHex, sourceOutputs, totalInputSats, feeSats, outputSats }
//   400  if no suitable UTXOs found
//   401  if no authenticated session

import { error, json } from '@sveltejs/kit';
import {
	cashAddressToLockingBytecode,
	encodeTransaction,
	hexToBin,
	binToHex
} from '@bitauth/libauth';
import type { TransactionCommon, Input, Output } from '@bitauth/libauth';
import { fetchWalletUtxos } from '$lib/server/walletUtxos';
import type { RequestHandler } from './$types';

/** Minimum input value to include in the consolidation. Below this the
 *  UTXO costs more in tx bytes (fee) than it contributes. */
const MIN_INPUT_SATS = 546n;
const FEE_RATE = 1; // sat/byte
const TX_OVERHEAD = 10; // version(4) + inCount(1) + outCount(1) + locktime(4)
const INPUT_BYTES = 41; // txid(32) + vout(4) + scriptLen(1) + sequence(4), no scriptSig
const OUTPUT_BYTES = 34; // value(8) + scriptLen(1) + P2PKH(25)

export interface PrepareFundingResponse {
	unsignedTxHex: string;
	sourceOutputs: Array<{
		outpointTransactionHash: string;
		outpointIndex: number;
		lockingBytecode: string;
		valueSatoshis: number;
	}>;
	totalInputSats: number;
	feeSats: number;
	outputSats: number;
}

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, 'sign in required');
	}

	const allUtxos = await fetchWalletUtxos(locals.user.cashaddr);
	console.log('[prepare-funding] total UTXOs:', allUtxos.length, 'cashaddr:', locals.user.cashaddr);

	// Filter: plain BCH only (no token data), any vout, enough value
	// to be worth including in the consolidation.
	const spendable: typeof allUtxos = [];
	for (const u of allUtxos) {
		if (u.tokenData) continue;
		if (u.valueSats < MIN_INPUT_SATS) continue;
		spendable.push(u);
	}
	console.log('[prepare-funding] spendable:', spendable.length);

	if (spendable.length === 0) {
		throw error(400, 'No spendable plain-BCH UTXOs found in your wallet. Fund it first.');
	}

	const lockResult = cashAddressToLockingBytecode(locals.user.cashaddr);
	if (typeof lockResult === 'string') {
		throw error(500, `Could not derive locking script: ${lockResult}`);
	}
	const selfLock = lockResult.bytecode;
	const inputs: Input[] = [];
	const sourceOutputs: PrepareFundingResponse['sourceOutputs'] = [];
	let totalInputSats = 0n;

	for (const u of spendable) {
		inputs.push({
			outpointTransactionHash: hexToBin(u.txid),
			outpointIndex: u.vout,
			sequenceNumber: 0xfffffffe,
			unlockingBytecode: new Uint8Array(0) // wallet fills during signing
		});
		sourceOutputs.push({
			outpointTransactionHash: u.txid,
			outpointIndex: u.vout,
			lockingBytecode: binToHex(selfLock),
			valueSatoshis: Number(u.valueSats)
		});
		totalInputSats += u.valueSats;
	}

	// Single output: all value (minus fee) back to the user's address.
	// This output is at vout=0 (only output), which is what we need
	// for the genesis funding UTXO.
	const estimatedBytes = TX_OVERHEAD + inputs.length * INPUT_BYTES + OUTPUT_BYTES;
	let feeSats = BigInt(estimatedBytes * FEE_RATE);
	let outputSats = totalInputSats - feeSats;

	if (outputSats < 546n) {
		throw error(
			400,
			`Not enough BCH to cover fee. Total inputs: ${totalInputSats} sats, estimated fee: ${feeSats} sats.`
		);
	}

	const output: Output = {
		lockingBytecode: selfLock,
		valueSatoshis: outputSats
	};

	const tx: TransactionCommon = {
		version: 2,
		locktime: 0,
		inputs,
		outputs: [output]
	};

	const unsignedTxBin = encodeTransaction(tx);

	return json({
		unsignedTxHex: binToHex(unsignedTxBin),
		sourceOutputs,
		totalInputSats: Number(totalInputSats),
		feeSats: Number(feeSats),
		outputSats: Number(outputSats)
	});
};
