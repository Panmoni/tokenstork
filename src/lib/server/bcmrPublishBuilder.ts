// Server-side libauth-direct BCMR-publish tx builder (#33).
//
// Builds the unsigned tx that:
//   1. Spends the authNFT at vout=0 of the current authchain head
//      (which the caller has confirmed the wallet owns).
//   2. Emits a NEW authNFT at vout=0 carrying the same category +
//      commitment + capability as the spent input — that's the CashTokens
//      authchain rule (one continuous identity-output line per category).
//   3. Adds an OP_RETURN BCMR locator at vout=1 carrying the
//      sha256 content_hash + the publisher's URI: `OP_RETURN <push
//      "BCMR"> <push hash> <push URI>` per the BCMR CHIP wire format.
//   4. (Optional) Emits a BCH change output at vout=2 if a BCH-funding
//      input was needed to cover fees on top of the authNFT UTXO's dust.
//
// Pure TS + libauth + our on-chain UTXO fetcher; no external
// services. Returns the unsigned hex + a sourceOutputs payload the
// wallet can use to verify each input pre-signing (WC2
// bch_signTransaction shape).
//
// Architectural pattern derived from src/lib/server/airdropBuilder.ts;
// the libauth idioms (cashAddressToLockingBytecode, encodeTransactionCommon,
// Input/Output shapes, fee estimation constants) match across the two
// builders so the wallet-side signing UX stays consistent.

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

const DEFAULT_FEE_RATE = 1;
// The new authNFT carries the same BCH dust value as the spent input
// by default, but we floor at 1000 sats so a previously-dust authNFT
// (e.g. someone sent the authNFT to a covenant that holds it at 546
// sats) can still afford the fees of a publish tx without requiring
// a separate BCH-funding input.
const MIN_AUTHNFT_OUTPUT_SATS = 1000;
const DUST_THRESHOLD_SATS = 546;

// libauth fee constants (mirror airdropBuilder.ts).
const ESTIMATED_INPUT_BYTES = 150;
const ESTIMATED_OUTPUT_BYTES_PLAIN = 35;
const TOKEN_PREFIX_OVERHEAD_BYTES = 80;
const TX_OVERHEAD_BYTES = 12;

// Max URI bytes we'll accept. The CHIP allows arbitrarily long pushes
// via OP_PUSHDATA2 (up to 65535 bytes), but a tx hosting a 1 KB URI
// would be operationally hostile. Match the icon URI cap from #28's
// validator.
const MAX_URI_LEN_BYTES = 1024;

const BCMR_MAGIC = new Uint8Array([0x42, 0x43, 0x4d, 0x52]); // "BCMR"

export interface BcmrPublishBuildSpec {
	/** Sender's cashaddr (canonical form). Used for the BCH-change
	 *  output's locking script. The authNFT output's locking script is
	 *  derived separately from the input's prior locking bytecode (we
	 *  re-use the same script so the wallet retains ownership of the
	 *  new authNFT). */
	senderCashaddr: string;
	/** The authNFT UTXO at vout=0 of the current authchain head. Caller
	 *  has already confirmed this exists in the wallet's UTXOs and the
	 *  ownership check matches. */
	authNftUtxo: WalletUtxo;
	/** All available plain-BCH UTXOs from the sender's wallet. Builder
	 *  picks if the authNFT's BCH dust doesn't cover fees + the new
	 *  authNFT output. Pass an empty array when no funding needed. */
	availableBchUtxos: WalletUtxo[];
	/** sha256 content hash of the canonical BCMR JSON, as 64-char hex.
	 *  Matches what /api/bcmr/sessions/[id]/canonicalize produced. */
	contentHashHex: string;
	/** Publisher's URI to embed in the OP_RETURN locator. Up to 1024
	 *  bytes UTF-8. Usually `ipfs://<cid>/<path>` or `https://<host>/<path>`. */
	publicationUri: string;
	/** Sat-per-byte fee rate. Default 1 (BCH standard floor). */
	feeRateSatPerByte?: number;
}

export interface BcmrPublishBuildResult {
	/** Unsigned raw tx hex. */
	unsignedTxHex: string;
	/** Source-output payload for WC2 `bch_signTransaction`. Order
	 *  matches `tx.inputs`. */
	sourceOutputs: Array<{
		outpointTransactionHash: string;
		outpointIndex: number;
		valueSatoshis: string;
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
	/** BCH change satoshis returned to sender (0 if folded into fee). */
	changeSats: number;
	/** BCH value attached to the new authNFT output (vout=0). */
	authNftOutputSats: number;
	/** Encoded tx size in bytes. */
	encodedTxBytes: number;
}

export class BcmrPublishBuildError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BcmrPublishBuildError';
	}
}

const HEX64_REGEX = /^[0-9a-fA-F]{64}$/;

/**
 * Build the unsigned tx for one BCMR publication. Throws
 * BcmrPublishBuildError on caller-fault conditions so the API layer
 * maps to a 4xx without leaking internals.
 */
export function buildBcmrPublishTx(spec: BcmrPublishBuildSpec): BcmrPublishBuildResult {
	if (!HEX64_REGEX.test(spec.contentHashHex)) {
		throw new BcmrPublishBuildError('contentHashHex must be 64-char hex');
	}
	if (!spec.publicationUri || typeof spec.publicationUri !== 'string') {
		throw new BcmrPublishBuildError('publicationUri must be a non-empty string');
	}
	const uriBytes = new TextEncoder().encode(spec.publicationUri);
	if (uriBytes.length > MAX_URI_LEN_BYTES) {
		throw new BcmrPublishBuildError(
			`publicationUri exceeds ${MAX_URI_LEN_BYTES} bytes (got ${uriBytes.length})`
		);
	}
	if (!spec.authNftUtxo.tokenData) {
		throw new BcmrPublishBuildError('authNftUtxo must carry token_data');
	}
	if (spec.authNftUtxo.vout !== 0) {
		// CashTokens spec: the authchain's identity output is always at
		// vout=0. Refuse to build against a non-vout=0 UTXO so a wallet-
		// holding-multiple-token-UTXOs-of-same-category doesn't spend the
		// wrong one and break the authchain.
		throw new BcmrPublishBuildError(
			`authNftUtxo must be at vout=0 (got vout=${spec.authNftUtxo.vout})`
		);
	}
	const feeRate = spec.feeRateSatPerByte ?? DEFAULT_FEE_RATE;
	if (feeRate <= 0) {
		throw new BcmrPublishBuildError('feeRateSatPerByte must be positive');
	}

	const senderLock = decodeLock(spec.senderCashaddr, 'senderCashaddr');

	// Build the BCMR locator OP_RETURN script first — we need its byte
	// length for the fee estimate.
	const bcmrLocatorScript = buildBcmrLocatorScript(
		hexToBin(spec.contentHashHex),
		uriBytes
	);

	// New authNFT BCH value: at least MIN_AUTHNFT_OUTPUT_SATS, or the
	// spent input's value if it's already higher. Carrying forward the
	// input value keeps the chain "self-funded" — the wallet doesn't have
	// to keep injecting BCH dust to preserve the authchain.
	const authNftOutputSats = Math.max(
		MIN_AUTHNFT_OUTPUT_SATS,
		Number(spec.authNftUtxo.valueSats)
	);

	// Estimate fee. Start with just the authNFT input + 2 outputs (new
	// authNFT + OP_RETURN locator). Add BCH inputs / change output if
	// needed below.
	const initialInputCount = 1;
	const numTokenOutputs = 1; // new authNFT
	const numPlainOutputs = 0; // change added conditionally below
	const opReturnSize = bcmrLocatorScript.length + 9; // 8-byte value + 1-byte len-prefix on the script
	let estimatedSize =
		TX_OVERHEAD_BYTES +
		initialInputCount * ESTIMATED_INPUT_BYTES +
		opReturnSize +
		numTokenOutputs * (ESTIMATED_OUTPUT_BYTES_PLAIN + TOKEN_PREFIX_OVERHEAD_BYTES) +
		numPlainOutputs * ESTIMATED_OUTPUT_BYTES_PLAIN;
	let feeSats = Math.ceil(estimatedSize * feeRate);

	// Funding-pool policy: plain-BCH UTXOs are preferred. Same-category
	// pure-FT UTXOs (no NFT side) are a fallback — their token amount is
	// merged into the new authNFT output at vout=0, so they add no extra
	// token output. (The previous passthrough approach emitted a 546-sat
	// token output, which is below BCHN's token-output dust threshold of
	// ~650 sats and got the whole tx rejected as dust — and the output
	// wasn't in the fee math, silently underpaying the fee.) Foreign-
	// category or NFT-bearing UTXOs are never auto-spent for fees.
	const authCategoryHex = spec.authNftUtxo.tokenData!.categoryHex.toLowerCase();
	const isMergeableFtUtxo = (u: WalletUtxo): boolean =>
		u.tokenData != null &&
		u.tokenData.categoryHex.toLowerCase() === authCategoryHex &&
		u.tokenData.capability == null &&
		!u.tokenData.commitmentHex;
	const plainFundingPool = spec.availableBchUtxos.filter((u) => !u.tokenData);
	const mergeableFundingPool = spec.availableBchUtxos.filter(isMergeableFtUtxo);

	const satsNeededWithoutChange = BigInt(authNftOutputSats) + BigInt(feeSats);
	let satsCovered = spec.authNftUtxo.valueSats;
	let bchInputs: WalletUtxo[] = [];
	if (satsCovered < satsNeededWithoutChange) {
		// Pull BCH funding inputs.
		const need = satsNeededWithoutChange - satsCovered;
		bchInputs = pickFundingUtxos(plainFundingPool, mergeableFundingPool, need);
		const bchSum = bchInputs.reduce((s, u) => s + u.valueSats, 0n);
		satsCovered = spec.authNftUtxo.valueSats + bchSum;
		// Re-estimate fee with the new input count + a plain change output
		// (since we're pulling extra BCH).
		const finalInputCount = 1 + bchInputs.length;
		estimatedSize =
			TX_OVERHEAD_BYTES +
			finalInputCount * ESTIMATED_INPUT_BYTES +
			opReturnSize +
			numTokenOutputs * (ESTIMATED_OUTPUT_BYTES_PLAIN + TOKEN_PREFIX_OVERHEAD_BYTES) +
			1 * ESTIMATED_OUTPUT_BYTES_PLAIN; // change output
		feeSats = Math.ceil(estimatedSize * feeRate);
		const satsNeededWithChange = BigInt(authNftOutputSats) + BigInt(feeSats);
		if (satsCovered < satsNeededWithChange) {
			throw new BcmrPublishBuildError(
				`wallet BCH insufficient to cover fees (need ${satsNeededWithChange}, have ${satsCovered})`
			);
		}
	}

	// BCH change calculation. If we used only the authNFT input, the
	// change is `authNftUtxo.valueSats - authNftOutputSats - feeSats`.
	// If we pulled extra BCH, it's `satsCovered - authNftOutputSats - feeSats`.
	let changeSats = satsCovered - BigInt(authNftOutputSats) - BigInt(feeSats);
	if (changeSats < 0n) {
		// Defensive — covered-vs-needed check above should have caught this.
		throw new BcmrPublishBuildError(
			`internal: negative change after fee (covered ${satsCovered}, fee ${feeSats}, output ${authNftOutputSats})`
		);
	}
	let createChangeOutput = changeSats >= BigInt(DUST_THRESHOLD_SATS);
	if (!createChangeOutput && changeSats > 0n) {
		// Sub-dust residue: fold into fee instead of creating a sub-dust
		// output (BCHN rejects with bad-txns-vout-toosmall).
		feeSats += Number(changeSats);
		changeSats = 0n;
	}

	// Assemble libauth Inputs.
	const allInputs: WalletUtxo[] = [spec.authNftUtxo, ...bchInputs];
	const inputs: Input[] = allInputs.map((u) => ({
		outpointTransactionHash: hexToBin(u.txid),
		outpointIndex: u.vout,
		sequenceNumber: 0xfffffffe,
		unlockingBytecode: new Uint8Array(0)
	}));

	// Assemble Outputs.
	const outputs: Output[] = [];
	// vout[0]: new authNFT — preserve category + commitment + capability.
	// Same-category pure-FT funding inputs merge their amount in here, so
	// no separate token output (and no token-dust pitfall) is needed.
	const td = spec.authNftUtxo.tokenData!;
	const mergedFtAmount = bchInputs.reduce((s, u) => s + (u.tokenData?.amount ?? 0n), 0n);
	const authTokenField = buildAuthNftTokenField(td);
	authTokenField.amount += mergedFtAmount;
	outputs.push({
		lockingBytecode: senderLock,
		valueSatoshis: BigInt(authNftOutputSats),
		token: authTokenField
	});
	// vout[1]: BCMR locator OP_RETURN. Zero-value (data carrier).
	outputs.push({ lockingBytecode: bcmrLocatorScript, valueSatoshis: 0n });
	for (const u of bchInputs) {
		if (u.tokenData && !isMergeableFtUtxo(u)) {
			// Unreachable given the funding-pool filter above — but a
			// non-mergeable token input with no matching output would be
			// BURNED by this tx, so refuse to build rather than risk it.
			throw new BcmrPublishBuildError(
				'internal: non-mergeable token UTXO selected for fee funding'
			);
		}
	}
	if (createChangeOutput) {
		outputs.push({ lockingBytecode: senderLock, valueSatoshis: changeSats });
	}
	const tx: TransactionCommon = { version: 2, locktime: 0, inputs, outputs };
	const unsignedBin = encodeTransactionCommon(tx);

	// sourceOutputs payload (WC2 `bch_signTransaction`). Same shape as
	// airdropBuilder so wallet UX is consistent across our publish flows.
	const sourceOutputs = allInputs.map((u) => {
		const lock = cashAddressToLockingBytecode(spec.senderCashaddr);
		if (typeof lock === 'string') {
			throw new BcmrPublishBuildError(`senderCashaddr decode failed: ${lock}`);
		}
		const so: BcmrPublishBuildResult['sourceOutputs'][number] = {
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
		changeSats: Number(changeSats),
		authNftOutputSats,
		encodedTxBytes: unsignedBin.length
	};
}

/**
 * Build the libauth `Output.token` field for the new authNFT,
 * preserving the spent input's category + commitment + capability.
 *
 * Per CashTokens spec, an authchain's identity output may be either
 * a pure NFT (no FT amount) OR an NFT carrying an FT amount. We
 * faithfully reproduce whichever shape the input had.
 */
function buildAuthNftTokenField(td: NonNullable<WalletUtxo['tokenData']>): {
	amount: bigint;
	category: Uint8Array;
	nft?: {
		capability: 'none' | 'mutable' | 'minting';
		commitment: Uint8Array;
	};
} {
	const category = hexToBin(td.categoryHex);
	// libauth requires `amount` for any token-bearing output; 0n is the
	// canonical "no fungible amount, NFT only" encoding (the wire format
	// emits the amount as varint, and an absent FT side is amount=0).
	// We preserve the input's amount verbatim (0n if the input was a
	// pure NFT, or carry over the FT side for an FT+NFT hybrid).
	const result: {
		amount: bigint;
		category: Uint8Array;
		nft?: {
			capability: 'none' | 'mutable' | 'minting';
			commitment: Uint8Array;
		};
	} = { amount: td.amount > 0n ? td.amount : 0n, category };
	// The input has commitment or capability data → it's an NFT (or
	// FT+NFT hybrid). Preserve both in the output. A purely-FT input
	// at vout=0 would NOT be an authchain head per spec — the genesis
	// publication requires an NFT-shape output — so this branch should
	// always fire in practice. Defensive only.
	if (td.commitmentHex != null || td.capability != null) {
		result.nft = {
			capability: td.capability ?? 'none',
			commitment: td.commitmentHex ? hexToBin(td.commitmentHex) : new Uint8Array(0)
		};
	}
	return result;
}

/**
 * Build the BCMR locator script: `OP_RETURN <push "BCMR"> <push hash>
 * <push uri>`. Per the BCMR CHIP wire format. The two non-magic pushes
 * use the smallest valid push opcode (direct push for ≤75 bytes,
 * OP_PUSHDATA1 for 76-255, OP_PUSHDATA2 for 256-65535).
 *
 * Realistic sizes:
 *   - magic: 4 bytes → direct push (0x04 prefix)
 *   - hash:  32 bytes → direct push (0x20 prefix)
 *   - uri:   typically 50-200 bytes (ipfs:// + cid + optional path) →
 *            either direct push or OP_PUSHDATA1.
 */
function buildBcmrLocatorScript(contentHash: Uint8Array, uri: Uint8Array): Uint8Array {
	if (contentHash.length !== 32) {
		throw new BcmrPublishBuildError(
			`contentHash must be 32 bytes (got ${contentHash.length})`
		);
	}
	const parts: Uint8Array[] = [];
	parts.push(new Uint8Array([0x6a])); // OP_RETURN
	parts.push(pushBytes(BCMR_MAGIC));
	parts.push(pushBytes(contentHash));
	parts.push(pushBytes(uri));
	return concatUint8(parts);
}

/** Build a Script push for `bytes`, choosing the smallest valid opcode:
 *  direct push (1-75 bytes), OP_PUSHDATA1 (76-255), OP_PUSHDATA2 (256-65535). */
function pushBytes(bytes: Uint8Array): Uint8Array {
	const len = bytes.length;
	if (len === 0) {
		// OP_0 — pushes empty byte string. Valid but unusual; the BCMR
		// CHIP doesn't anticipate empty pushes, so caller should have
		// rejected upstream.
		return new Uint8Array([0x00]);
	}
	if (len <= 75) {
		const out = new Uint8Array(1 + len);
		out[0] = len;
		out.set(bytes, 1);
		return out;
	}
	if (len <= 255) {
		const out = new Uint8Array(2 + len);
		out[0] = 0x4c; // OP_PUSHDATA1
		out[1] = len;
		out.set(bytes, 2);
		return out;
	}
	if (len <= 65535) {
		const out = new Uint8Array(3 + len);
		out[0] = 0x4d; // OP_PUSHDATA2
		out[1] = len & 0xff;
		out[2] = (len >>> 8) & 0xff;
		out.set(bytes, 3);
		return out;
	}
	throw new BcmrPublishBuildError(
		`push too large for OP_PUSHDATA2 (${len} bytes; max 65535)`
	);
}

function concatUint8(parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((s, p) => s + p.length, 0);
	const out = new Uint8Array(total);
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

function pickFundingUtxos(
	plainPool: WalletUtxo[],
	mergeablePool: WalletUtxo[],
	target: bigint
): WalletUtxo[] {
	// Smallest-first within each pool: consolidates dust as a side
	// benefit (same policy as airdropBuilder). Plain BCH is exhausted
	// before any same-category-FT UTXO is touched.
	const smallestFirst = (pool: WalletUtxo[]) =>
		[...pool].sort((a, b) => (a.valueSats < b.valueSats ? -1 : a.valueSats > b.valueSats ? 1 : 0));
	const picked: WalletUtxo[] = [];
	let sum = 0n;
	for (const u of [...smallestFirst(plainPool), ...smallestFirst(mergeablePool)]) {
		if (sum >= target) break;
		picked.push(u);
		sum += u.valueSats;
	}
	if (sum < target) {
		throw new BcmrPublishBuildError(
			`BCH funding UTXO pool insufficient (need ${target}, have ${sum}; ` +
				'note: token-bearing UTXOs are only spendable for fees when they hold ' +
				'same-category fungible tokens with no NFT)'
		);
	}
	return picked;
}

function decodeLock(cashaddr: string, fieldName: string): Uint8Array {
	const result = cashAddressToLockingBytecode(cashaddr);
	if (typeof result === 'string') {
		throw new BcmrPublishBuildError(`${fieldName} decode failed: ${result}`);
	}
	return result.bytecode;
}
