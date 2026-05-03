// Server-side libauth-direct airdrop tx builder.
//
// Generalises src/lib/mint/genesis.ts from "1 genesis output + 1 change"
// to "1 OP_RETURN audit prefix + N recipient outputs + 1 change" against
// a sender's own UTXO set. Pure TS + libauth + the local BlockBook UTXO
// fetcher; no third-party services touched.
//
// Architectural pattern (chunk-then-sign loop, OP_RETURN audit prefix,
// per-chunk independent UTXO selection) was derived from
// mainnet-pat/dropship.cash analysis — pattern only, no source copied.
//
// One call per chunk: the API endpoint produces N unsigned hex blobs
// (one per chunk of ≤600 recipients), the wizard advances through them
// signing each, and broadcast happens server-side per chunk.

import {
	cashAddressToLockingBytecode,
	encodeTransactionCommon,
	hexToBin,
	binToHex,
	type Input,
	type Output,
	type TransactionCommon
} from '@bitauth/libauth';

import type { WalletUtxo } from './walletUtxos';

// Sat-per-byte fee rate. BCH standard floor; almost always plenty.
const DEFAULT_FEE_RATE = 1;
// Default per-recipient BCH dust attached to each token UTXO. Operator
// override range 546-2000 enforced at the API boundary; clamped here too.
export const DEFAULT_AIRDROP_OUTPUT_SATS = 800;
export const MIN_AIRDROP_OUTPUT_SATS = 546;
export const MAX_AIRDROP_OUTPUT_SATS = 2000;
// Plain-BCH dust threshold — change outputs below this are folded into
// the fee instead of being created (else BCHN rejects with bad-txns-vout-
// toosmall).
const DUST_THRESHOLD_SATS = 546;
// Worst-case input size (signed P2PKH ~150 bytes).
const ESTIMATED_INPUT_BYTES = 150;
// Plain P2PKH output without token prefix.
const ESTIMATED_OUTPUT_BYTES_PLAIN = 35;
// Conservative token-prefix overhead (real prefixes 35-50 bytes).
const TOKEN_PREFIX_OVERHEAD_BYTES = 80;
// Tx overhead (version + counts + locktime).
const TX_OVERHEAD_BYTES = 12;
// Hard cap on recipients per chunk. With 3 inputs + N token outputs +
// 1 change + 1 OP_RETURN, the chunk stays well under the 100 KB
// consensus cap. Lower than dropship.cash's 1000 — leaves headroom for
// multi-input chunks when the sender has fragmented token UTXOs.
export const MAX_RECIPIENTS_PER_CHUNK = 600;
// Hard cap on encoded chunk size before we refuse. 100 KB consensus, we
// gate at 95 KB. Should never fire at MAX_RECIPIENTS_PER_CHUNK; defensive
// only.
const MAX_CHUNK_SIZE_BYTES = 95_000;
// OP_RETURN audit prefix carried on output[0] of every airdrop tx so a
// future indexer pass can detect tokenstork-originated airdrops on chain.
// Format: ASCII "TS-DROP-<8-char-airdrop-id-prefix>". Different bytes
// from dropship.cash's "DROP" so the two coexist without collision.
const AUDIT_PREFIX = 'TS-DROP-';

export interface AirdropChunkSpec {
	/** UUID of the parent airdrop record (drives the OP_RETURN audit
	 *  identifier — first 8 chars are stamped on every chunk's tx[0]). */
	airdropId: string;
	/** Sender's cashaddr (canonical form, with `bitcoincash:` prefix).
	 *  Used to derive the change output's locking script. */
	senderCashaddr: string;
	/** 64-char hex of the source category being airdropped. */
	sourceCategoryHex: string;
	/** Recipients in this chunk. Caller is responsible for filtering out
	 *  the sender's own cashaddr and applying dust guards. Each amount
	 *  is in source-token base units (NOT display units). */
	recipients: Array<{ cashaddr: string; amountBaseUnits: bigint }>;
	/** All available source-token UTXOs from the sender's wallet (NOT
	 *  pre-selected — builder picks). */
	availableTokenUtxos: WalletUtxo[];
	/** All available plain-BCH UTXOs from the sender's wallet. */
	availableBchUtxos: WalletUtxo[];
	/** Per-recipient dust attached to each token UTXO. Default 800; range
	 *  546-2000. */
	outputValueSats?: number;
	/** Sat-per-byte fee rate. Default 1. */
	feeRateSatPerByte?: number;
}

export interface AirdropChunkBuild {
	/** Unsigned raw tx hex. The user's wallet signs; `/api/airdrops/<id>/
	 *  broadcast` forwards the signed result to BCHN. */
	unsignedTxHex: string;
	/** Source-output payload the wallet (WC2 `bch_signTransaction`) needs
	 *  to verify each input. Order matches `tx.inputs`. */
	sourceOutputs: Array<{
		outpointTransactionHash: string; // hex
		outpointIndex: number;
		valueSatoshis: string; // bigint as string for JSON safety
		lockingBytecodeHex: string;
		token?: {
			categoryHex: string;
			amount: string;
			commitmentHex?: string;
			capability?: 'none' | 'mutable' | 'minting';
		};
	}>;
	/** Estimated miner fee in satoshis. */
	feeSats: number;
	/** Change BCH satoshis returned to sender (0 if folded into fee). */
	changeSats: number;
	/** Change source-token amount returned to sender (0 if exact split). */
	changeTokenAmount: bigint;
	/** Encoded tx size in bytes. Used for the < 95 KB defensive guard. */
	encodedTxBytes: number;
}

export class AirdropBuildError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AirdropBuildError';
	}
}

/**
 * Build the unsigned tx for one chunk. Throws AirdropBuildError on
 * caller-fault conditions (insufficient UTXOs, invalid cashaddr,
 * recipient count exceeds chunk cap, etc.) so the API layer can map to
 * a 4xx response without leaking internals.
 */
export function buildAirdropChunk(spec: AirdropChunkSpec): AirdropChunkBuild {
	if (spec.recipients.length === 0) {
		throw new AirdropBuildError('chunk has no recipients');
	}
	if (spec.recipients.length > MAX_RECIPIENTS_PER_CHUNK) {
		throw new AirdropBuildError(
			`chunk exceeds MAX_RECIPIENTS_PER_CHUNK (${MAX_RECIPIENTS_PER_CHUNK})`
		);
	}
	if (!/^[0-9a-fA-F]{64}$/.test(spec.sourceCategoryHex)) {
		throw new AirdropBuildError('sourceCategoryHex must be 64-char hex');
	}
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			spec.airdropId
		)
	) {
		throw new AirdropBuildError('airdropId must be a UUID');
	}

	const outputValueSats = clampOutputValue(
		spec.outputValueSats ?? DEFAULT_AIRDROP_OUTPUT_SATS
	);
	const feeRate = spec.feeRateSatPerByte ?? DEFAULT_FEE_RATE;
	if (feeRate <= 0) {
		throw new AirdropBuildError('feeRateSatPerByte must be positive');
	}

	// Resolve sender + recipient locking scripts up front.
	const senderLock = decodeLock(spec.senderCashaddr, 'senderCashaddr');
	const recipientLocks = spec.recipients.map((r, i) =>
		decodeLock(r.cashaddr, `recipients[${i}].cashaddr`)
	);

	// Total token amount to distribute in this chunk.
	let totalTokenOut = 0n;
	for (const r of spec.recipients) {
		if (r.amountBaseUnits <= 0n) {
			throw new AirdropBuildError('recipient amount must be > 0');
		}
		totalTokenOut += r.amountBaseUnits;
	}

	// Select source-token inputs (largest-first to minimise input count).
	const tokenInputs = pickTokenUtxos(
		spec.availableTokenUtxos,
		spec.sourceCategoryHex,
		totalTokenOut
	);
	const tokenInputSum = tokenInputs.reduce(
		(s, u) => s + (u.tokenData?.amount ?? 0n),
		0n
	);
	const tokenSatsSum = tokenInputs.reduce((s, u) => s + u.valueSats, 0n);
	const changeTokenAmount = tokenInputSum - totalTokenOut;
	// Defensive: pickTokenUtxos guarantees `tokenInputSum >= totalTokenOut`
	// (it throws otherwise), so this should be unreachable. Belt-and-braces
	// against a future refactor of pickTokenUtxos that loosens the guard.
	if (changeTokenAmount < 0n) {
		throw new AirdropBuildError('internal: negative token-change amount');
	}

	// Estimate fee + total sats needed for outputs.
	const totalRecipientSats = BigInt(outputValueSats) * BigInt(spec.recipients.length);
	// Worst-case tx size with all token UTXOs as inputs (we'll add BCH
	// inputs below if needed; recompute fee after we know the final input
	// count).
	const initialInputCount = tokenInputs.length;
	const numTokenOutputs = spec.recipients.length + (changeTokenAmount > 0n ? 1 : 0);
	const numPlainOutputs = changeTokenAmount > 0n ? 0 : 1;
	let estimatedSize =
		TX_OVERHEAD_BYTES +
		initialInputCount * ESTIMATED_INPUT_BYTES +
		// OP_RETURN output: ~25 bytes (8 value + 1 len + ~16 pushdata)
		25 +
		numTokenOutputs * (ESTIMATED_OUTPUT_BYTES_PLAIN + TOKEN_PREFIX_OVERHEAD_BYTES) +
		numPlainOutputs * ESTIMATED_OUTPUT_BYTES_PLAIN;
	let feeSats = Math.ceil(estimatedSize * feeRate);

	// How many sats does the tx need to fund?
	//   - Sum of recipient outputs (each = outputValueSats)
	//   - Token-change output's BCH value (= outputValueSats if we're
	//     creating one)
	//   - Or a plain BCH change (if no token residue, we still need a
	//     change output to soak up extra BCH from BCH-side inputs)
	//   - Fee
	const tokenChangeBchValue = changeTokenAmount > 0n ? BigInt(outputValueSats) : 0n;
	const sumOfNonChangeOutputs = totalRecipientSats; // recipients only
	let satsNeeded = sumOfNonChangeOutputs + tokenChangeBchValue + BigInt(feeSats);

	// Sats already available from token inputs (each token UTXO carries
	// a small amount of BCH dust on top of its token data — typically
	// 1000 sats). Subtract from the required total.
	let satsCovered = tokenSatsSum;
	let bchInputs: WalletUtxo[] = [];
	if (satsCovered < satsNeeded) {
		// Pull BCH inputs (smallest-first to consolidate dust) until covered.
		const need = satsNeeded - satsCovered;
		bchInputs = pickBchUtxos(spec.availableBchUtxos, need);
		const bchInputSum = bchInputs.reduce((s, u) => s + u.valueSats, 0n);
		satsCovered = tokenSatsSum + bchInputSum;
		// Re-estimate fee with the now-known input count.
		const finalInputCount = initialInputCount + bchInputs.length;
		estimatedSize =
			TX_OVERHEAD_BYTES +
			finalInputCount * ESTIMATED_INPUT_BYTES +
			25 +
			numTokenOutputs *
				(ESTIMATED_OUTPUT_BYTES_PLAIN + TOKEN_PREFIX_OVERHEAD_BYTES) +
			numPlainOutputs * ESTIMATED_OUTPUT_BYTES_PLAIN;
		feeSats = Math.ceil(estimatedSize * feeRate);
		satsNeeded = sumOfNonChangeOutputs + tokenChangeBchValue + BigInt(feeSats);
		if (satsCovered < satsNeeded) {
			throw new AirdropBuildError(
				`sender BCH balance insufficient (need ${satsNeeded}, have ${satsCovered})`
			);
		}
	}

	// BCH change. If we created a token-change output, that already has
	// outputValueSats of BCH; the remainder goes to a plain change output.
	// If no token-change, all the BCH residue goes to the plain change.
	let bchChangeSats = satsCovered - satsNeeded;
	if (bchChangeSats > 0n && bchChangeSats < BigInt(DUST_THRESHOLD_SATS)) {
		// Dust band — fold into fee instead of creating a sub-dust output.
		feeSats += Number(bchChangeSats);
		bchChangeSats = 0n;
	}

	// Assemble libauth Inputs.
	const allInputs = [...tokenInputs, ...bchInputs];
	const inputs: Input[] = allInputs.map((u) => ({
		outpointTransactionHash: hexToBin(u.txid),
		outpointIndex: u.vout,
		sequenceNumber: 0xfffffffe,
		unlockingBytecode: new Uint8Array(0)
	}));

	// Assemble Outputs.
	const outputs: Output[] = [];
	// OP_RETURN audit prefix.
	const auditMessage = `${AUDIT_PREFIX}${spec.airdropId.slice(0, 8)}`;
	outputs.push(buildOpReturnOutput(auditMessage));
	// Recipient token outputs.
	const categoryBytes = hexToBin(spec.sourceCategoryHex);
	for (let i = 0; i < spec.recipients.length; i++) {
		outputs.push({
			lockingBytecode: recipientLocks[i],
			valueSatoshis: BigInt(outputValueSats),
			token: {
				amount: spec.recipients[i].amountBaseUnits,
				category: categoryBytes
			}
		});
	}
	// Token change (if any source-token residue) — back to sender.
	if (changeTokenAmount > 0n) {
		outputs.push({
			lockingBytecode: senderLock,
			valueSatoshis: BigInt(outputValueSats),
			token: { amount: changeTokenAmount, category: categoryBytes }
		});
	}
	// Plain BCH change (if any residue beyond what the token-change
	// output already swept up).
	if (bchChangeSats > 0n) {
		outputs.push({
			lockingBytecode: senderLock,
			valueSatoshis: bchChangeSats
		});
	}

	const tx: TransactionCommon = {
		version: 2,
		locktime: 0,
		inputs,
		outputs
	};

	const unsignedBin = encodeTransactionCommon(tx);
	if (unsignedBin.length > MAX_CHUNK_SIZE_BYTES) {
		throw new AirdropBuildError(
			`encoded chunk size ${unsignedBin.length}B exceeds 95KB consensus margin; reduce recipients per chunk`
		);
	}

	// Source-output payload for WC2 `bch_signTransaction`. Hex-everything
	// so the JSON survives WC2 relay encoding.
	const sourceOutputs = allInputs.map((u) => {
		const lock = cashAddressToLockingBytecode(spec.senderCashaddr);
		if (typeof lock === 'string') {
			throw new AirdropBuildError(`senderCashaddr decode failed: ${lock}`);
		}
		const so: AirdropChunkBuild['sourceOutputs'][number] = {
			outpointTransactionHash: u.txid,
			outpointIndex: u.vout,
			valueSatoshis: u.valueSats.toString(),
			lockingBytecodeHex: binToHex(lock.bytecode)
		};
		if (u.tokenData) {
			so.token = {
				categoryHex: u.tokenData.categoryHex,
				amount: u.tokenData.amount.toString(),
				commitmentHex: u.tokenData.commitmentHex,
				capability: u.tokenData.capability
			};
		}
		return so;
	});

	return {
		unsignedTxHex: binToHex(unsignedBin),
		sourceOutputs,
		feeSats,
		changeSats: Number(bchChangeSats),
		changeTokenAmount,
		encodedTxBytes: unsignedBin.length
	};
}

/** Greedy largest-first selection of source-token UTXOs to cover a target
 *  amount. Returns the subset of inputs needed; throws if available pool
 *  is insufficient. */
function pickTokenUtxos(
	available: WalletUtxo[],
	categoryHex: string,
	target: bigint
): WalletUtxo[] {
	const allOfCategory = available.filter(
		(u) =>
			u.tokenData &&
			u.tokenData.categoryHex.toLowerCase() === categoryHex.toLowerCase()
	);
	const matching = allOfCategory
		.filter(
			(u) =>
				u.tokenData!.commitmentHex == null && u.tokenData!.capability == null
		)
		.sort((a, b) => {
			const da = a.tokenData!.amount;
			const db = b.tokenData!.amount;
			return db > da ? 1 : db < da ? -1 : 0;
		});
	const picked: WalletUtxo[] = [];
	let sum = 0n;
	for (const u of matching) {
		if (sum >= target) break;
		picked.push(u);
		sum += u.tokenData!.amount;
	}
	if (sum < target) {
		// Diagnostic: if the sender holds source-token UTXOs but they're
		// all NFT-bearing (commitment / capability set), the wallet shows
		// a balance > 0 yet pickTokenUtxos returns 0. The default error
		// "pool insufficient" is technically accurate but confusing.
		// Distinguish to give the user actionable advice.
		if (allOfCategory.length > 0 && matching.length === 0) {
			throw new AirdropBuildError(
				`Your source-token UTXOs all carry NFT data (commitment or capability bits). ` +
					`Airdrops only spend pure-FT UTXOs to avoid losing the unique NFT commitment. ` +
					`Move some FT amount to a fresh UTXO (a self-send for the FT amount only) and retry.`
			);
		}
		throw new AirdropBuildError(
			`source-token UTXO pool insufficient (need ${target}, have ${sum})`
		);
	}
	return picked;
}

/** Greedy smallest-first selection of plain BCH UTXOs to cover a target
 *  amount. Smallest-first consolidates dust as a side benefit. */
function pickBchUtxos(available: WalletUtxo[], target: bigint): WalletUtxo[] {
	const sorted = [...available]
		.filter((u) => !u.tokenData)
		.sort((a, b) => (a.valueSats < b.valueSats ? -1 : a.valueSats > b.valueSats ? 1 : 0));
	const picked: WalletUtxo[] = [];
	let sum = 0n;
	for (const u of sorted) {
		if (sum >= target) break;
		picked.push(u);
		sum += u.valueSats;
	}
	if (sum < target) {
		throw new AirdropBuildError(
			`BCH funding UTXO pool insufficient (need ${target}, have ${sum})`
		);
	}
	return picked;
}

/** Build an OP_RETURN output carrying a UTF-8 ASCII payload. Layout:
 *  `OP_RETURN <pushdata>` where `<pushdata>` is the audit string. */
function buildOpReturnOutput(payload: string): Output {
	const bytes = new TextEncoder().encode(payload);
	if (bytes.length > 75) {
		throw new AirdropBuildError(
			`OP_RETURN payload too long (${bytes.length}B; max 75 for single push)`
		);
	}
	// 0x6a = OP_RETURN; followed by direct-push (length byte) + payload.
	const script = new Uint8Array(2 + bytes.length);
	script[0] = 0x6a;
	script[1] = bytes.length;
	script.set(bytes, 2);
	return {
		lockingBytecode: script,
		valueSatoshis: 0n
	};
}

function decodeLock(cashaddr: string, fieldName: string): Uint8Array {
	const result = cashAddressToLockingBytecode(cashaddr);
	if (typeof result === 'string') {
		throw new AirdropBuildError(`${fieldName} decode failed: ${result}`);
	}
	return result.bytecode;
}

function clampOutputValue(value: number): number {
	if (!Number.isInteger(value)) {
		throw new AirdropBuildError('outputValueSats must be an integer');
	}
	if (value < MIN_AIRDROP_OUTPUT_SATS || value > MAX_AIRDROP_OUTPUT_SATS) {
		throw new AirdropBuildError(
			`outputValueSats ${value} out of range [${MIN_AIRDROP_OUTPUT_SATS}, ${MAX_AIRDROP_OUTPUT_SATS}]`
		);
	}
	return value;
}
