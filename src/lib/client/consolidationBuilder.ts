// Client-side BCH consolidation tx builder.
//
// When a wallet has multiple small BCH UTXOs but none at vout=0 with
// enough value, we build a single-input or multi-input consolidation
// tx that sweeps plain-BCH UTXOs into one output (which will be at
// vout=0, satisfying the CashTokens vout=0 requirement for genesis and
// providing enough BCH for the authNFT output + fee for BCMR publish).
//
// Extracted from src/routes/mint/+page.svelte's `prepareFunding()`. The
// mint page still orchestrates the full flow; this module provides the
// building blocks so the BCMR publish wizard can use them too.

import {
	cashAddressToLockingBytecode,
	encodeTransactionCommon,
	hexToBin,
	binToHex,
	type TransactionCommon
} from '@bitauth/libauth';

export interface ConsolidationInput {
	txid: string;
	vout: number;
	valueSats: number;
}

export interface ConsolidationBuild {
	/** Unsigned raw tx hex. */
	unsignedTxHex: string;
	/** Source-output payload for WC2 bch_signTransaction. */
	sourceOutputs: Array<{
		outpointTransactionHash: string;
		outpointIndex: number;
		sequenceNumber: number;
		lockingBytecode: string;
		unlockingBytecode: string;
		valueSatoshis: string;
	}>;
	/** Total output value in sats (input sum minus fee). */
	outputSats: number;
	/** Estimated fee in sats. */
	feeSats: number;
}

const TX_OVERHEAD = 10;
const INPUT_BYTES = 41;
const SIG_BYTES_PER_INPUT = 106; // DER sig(~71) + pubkey(33) + push ops(2)
const OUTPUT_BYTES = 34;
const DUST_THRESHOLD = 546;
const DEFAULT_FEE_RATE = 1; // sat/byte

/**
 * Build an unsigned consolidation transaction that spends ALL provided
 * plain-BCH UTXOs into a single self-output (at vout=0).
 *
 * @param utxos The plain-BCH UTXOs to consolidate. At least one.
 * @param senderCashaddr The recipient cashaddr (same as the sender — we're
 *   consolidating to ourselves).
 * @param feeRate Sat-per-byte fee rate (default 1).
 * @returns The unsigned tx hex + source outputs for WC signing.
 * @throws If the inputs don't cover the fee, or the cashaddr is invalid.
 */
export function buildConsolidationTx(
	utxos: ConsolidationInput[],
	senderCashaddr: string,
	feeRate: number = DEFAULT_FEE_RATE
): ConsolidationBuild {
	if (utxos.length === 0) {
		throw new Error('At least one UTXO is required to build a consolidation tx');
	}

	const lockResult = cashAddressToLockingBytecode(senderCashaddr);
	if (typeof lockResult === 'string') {
		throw new Error(`senderCashaddr decode failed: ${lockResult}`);
	}
	const selfLock = lockResult.bytecode;
	const selfLockHex = binToHex(selfLock);

	const inputs: Array<{
		outpointTransactionHash: Uint8Array;
		outpointIndex: number;
		sequenceNumber: number;
		unlockingBytecode: Uint8Array;
	}> = [];
	const sourceOutputs: Array<{
		outpointTransactionHash: string;
		outpointIndex: number;
		sequenceNumber: number;
		lockingBytecode: string;
		unlockingBytecode: string;
		valueSatoshis: string;
	}> = [];
	let totalInputSats = 0;

	for (const u of utxos) {
		inputs.push({
			outpointTransactionHash: hexToBin(u.txid),
			outpointIndex: u.vout,
			sequenceNumber: 0xfffffffe,
			unlockingBytecode: new Uint8Array(0)
		});
		sourceOutputs.push({
			outpointTransactionHash: `<Uint8Array: 0x${u.txid}>`,
			outpointIndex: u.vout,
			sequenceNumber: 0xfffffffe,
			lockingBytecode: `<Uint8Array: 0x${selfLockHex}>`,
			unlockingBytecode: '<Uint8Array: 0x>',
			valueSatoshis: `<bigint: ${u.valueSats}n>`
		});
		totalInputSats += u.valueSats;
	}

	const estimatedBytes =
		TX_OVERHEAD +
		inputs.length * (INPUT_BYTES + SIG_BYTES_PER_INPUT) +
		OUTPUT_BYTES;
	const feeSats = Math.ceil(estimatedBytes * feeRate);
	const outputSats = totalInputSats - feeSats;

	if (outputSats < DUST_THRESHOLD) {
		throw new Error(
			`Not enough BCH to cover fee. Total: ${totalInputSats} sats, fee: ${feeSats} sats, output would be below dust threshold.`
		);
	}

	const tx: TransactionCommon = {
		version: 2,
		locktime: 0,
		inputs,
		outputs: [
			{
				lockingBytecode: selfLock,
				valueSatoshis: BigInt(outputSats)
			}
		]
	};

	const unsignedTxBin = encodeTransactionCommon(tx);

	return {
		unsignedTxHex: binToHex(unsignedTxBin),
		sourceOutputs,
		outputSats,
		feeSats
	};
}

/**
 * Build the WL ConsolidationInput array from the server's WalletUtxo shape,
 * filtering to plain-BCH UTXOs only.
 */
export function plainUtxosToConsolidationInputs(
	utxos: Array<{ txid: string; vout: number; valueSats: number }>
): ConsolidationInput[] {
	return utxos.map((u) => ({
		txid: u.txid,
		vout: u.vout,
		valueSats: u.valueSats
	}));
}
