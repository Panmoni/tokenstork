// Browser-side CashTokens genesis-tx builder.
//
// Pure function: given a funding outpoint, a token spec, a recipient
// cashaddr, and a fee target, return an unsigned-tx hex string + the
// derived category id. Uses libauth's transaction primitives — no
// network IO here.
//
// Why browser-side: the user's wallet signs the tx. The wallet doesn't
// trust our server (and shouldn't); the server doesn't see the user's
// keys. The tx is built client-side, the wallet signs, and we only see
// the signed hex on its way to broadcast (`/api/mint/broadcast`).
//
// CashTokens spec reminders:
// - The category ID is derived from the consumed input's outpoint
//   transaction hash (the txid of the prevout). For v1 we require the
//   funding UTXO to be at vout=0 of its parent tx, per spec.
// - The genesis output's `valueSatoshis` is the standard "token-bearing
//   dust" floor — 1000 sats is conservative + safe.
// - Fee is computed by tx-byte-length × sat/byte rate. We default to
//   1 sat/byte (standard floor on BCH; almost always plenty).

import {
	cashAddressToLockingBytecode,
	encodeTransactionCommon,
	hexToBin,
	binToHex,
	type Input,
	type Output,
	type TransactionCommon
} from '@bitauth/libauth';

/**
 * Token type as the wizard knows it. Maps onto the libauth Output.token
 * shape — FT means amount > 0, no nft; NFT means amount = 0n with nft
 * present; FT+NFT means amount > 0 with nft present (a hybrid).
 */
export type TokenType = 'FT' | 'NFT' | 'FT+NFT';
export type NftCapability = 'none' | 'mutable' | 'minting';

export interface GenesisSpec {
	/** Outpoint to consume — must be at vout=0 of its parent tx per
	 * CashTokens spec. The outpoint's txid IS the resulting category id. */
	outpointTxid: string; // 64-char hex
	outpointSatoshis: number; // value of the consumed UTXO (we need this for fee math)
	tokenType: TokenType;
	/** FT supply (smallest unit). Required for FT and FT+NFT. Ignored for pure NFT. */
	supply?: bigint;
	/** NFT commitment hex. Optional for NFT and FT+NFT. */
	nftCommitmentHex?: string;
	/** NFT capability. Required for NFT and FT+NFT; ignored for pure FT. */
	nftCapability?: NftCapability;
	/** Recipient address — the token-bearing output is locked to this address. */
	recipientCashaddr: string;
	/** Sat-per-byte fee rate. Defaults to 1 (BCH standard floor). */
	feeRateSatPerByte?: number;
	/** Token-output dust floor in satoshis. CashTokens convention is 1000+. */
	tokenOutputSats?: number;
}

export interface GenesisTxBuild {
	/** Unsigned raw tx hex. The user's wallet signs this. */
	unsignedTxHex: string;
	/** Derived category id (lower-case hex). Equal to the outpoint txid. */
	categoryHex: string;
	/** Sats consumed from the input minus the genesis output's
	 *  `tokenOutputSats` and the change output, ≈ the miner fee. */
	feeSats: number;
	/** Sats sent back to the funder as change. Pre-determined; the
	 *  wallet doesn't need to recompute. */
	changeSats: number;
	/** Estimated tx size in bytes (signature placeholders included). */
	estimatedTxBytes: number;
}

const DEFAULT_FEE_RATE = 1; // sat/byte — BCH standard floor
const DEFAULT_TOKEN_OUTPUT_SATS = 1000; // dust floor for token-bearing UTXO
/**
 * BCH standard dust threshold for plain-BCH outputs. BCHN's `min-relay-fee`
 * + standardness rules reject outputs below this; if our change output
 * lands in the (0, DUST_THRESHOLD) band it'd fail to broadcast with a
 * confusing `bad-txns-vout-toosmall` error. We instead fold the dust
 * into the fee — the user pays a tad more in fee for that UTXO than
 * they would otherwise.
 */
const DUST_THRESHOLD_SATS = 546;
/**
 * Conservative size estimate for a single P2PKH input including signature
 * placeholder. Real signed inputs are 147-148 bytes; we round up to be
 * safe on fee calculation.
 */
const ESTIMATED_INPUT_BYTES = 150;
/**
 * Conservative estimate for a P2PKH output WITHOUT a token prefix.
 * Output bytes = 8 (value) + 1 (script length varint) + script bytes.
 * P2PKH script is 25 bytes → 8+1+25 = 34. Round up to 35 for safety.
 */
const ESTIMATED_OUTPUT_BYTES_PLAIN = 35;
/**
 * The token prefix on an output adds: 1 (PREFIX_TOKEN byte) + 32
 * (category) + 1 (bitfield) + variable (amount + commitment). We
 * estimate worst-case 80 bytes for the prefix overhead. Real prefixes
 * are 35-50 typical; 80 is over-budget for safety.
 */
const TOKEN_PREFIX_OVERHEAD_BYTES = 80;
/**
 * Fixed tx overhead: 4 (version) + 1 (input count) + 1 (output count)
 * + 4 (locktime) = 10 bytes. Round up to 12 for safety.
 */
const TX_OVERHEAD_BYTES = 12;

/**
 * Build the unsigned genesis transaction.
 *
 * @throws if any spec field is invalid (bad hex, wrong size, etc.).
 *  All errors are caller-visible — the wizard surfaces them in the UI.
 */
export function buildGenesisTx(spec: GenesisSpec): GenesisTxBuild {
	if (!/^[0-9a-fA-F]{64}$/.test(spec.outpointTxid)) {
		throw new Error('outpointTxid must be 64-char hex');
	}
	if (spec.outpointSatoshis <= 0) {
		throw new Error('outpointSatoshis must be positive');
	}
	const feeRate = spec.feeRateSatPerByte ?? DEFAULT_FEE_RATE;
	if (feeRate <= 0) throw new Error('feeRateSatPerByte must be positive');
	const tokenOutputSats = spec.tokenOutputSats ?? DEFAULT_TOKEN_OUTPUT_SATS;

	// Validate token-shape fields per type.
	const wantsFt = spec.tokenType === 'FT' || spec.tokenType === 'FT+NFT';
	const wantsNft = spec.tokenType === 'NFT' || spec.tokenType === 'FT+NFT';
	if (wantsFt) {
		if (spec.supply === undefined || spec.supply <= 0n) {
			throw new Error('FT supply must be a positive BigInt');
		}
		// CashTokens spec: max supply per category = 2^63 - 1.
		if (spec.supply > 9223372036854775807n) {
			throw new Error('FT supply exceeds CashTokens max (2^63 - 1)');
		}
	}
	let nftCommitment: Uint8Array | undefined;
	if (wantsNft) {
		const cap = spec.nftCapability ?? 'none';
		if (cap !== 'none' && cap !== 'mutable' && cap !== 'minting') {
			throw new Error(`unknown nftCapability: ${cap}`);
		}
		if (spec.nftCommitmentHex && spec.nftCommitmentHex.length > 0) {
			if (!/^[0-9a-fA-F]+$/.test(spec.nftCommitmentHex)) {
				throw new Error('nftCommitmentHex must be hex');
			}
			if (spec.nftCommitmentHex.length > 80) {
				throw new Error('nftCommitmentHex max 40 bytes (80 hex chars)');
			}
			nftCommitment = hexToBin(spec.nftCommitmentHex);
		} else {
			nftCommitment = new Uint8Array(0);
		}
	}

	// Resolve the recipient cashaddr to its locking bytecode (P2PKH).
	const lockResult = cashAddressToLockingBytecode(spec.recipientCashaddr);
	if (typeof lockResult === 'string') {
		throw new Error(`recipientCashaddr decode failed: ${lockResult}`);
	}
	const recipientLock = lockResult.bytecode;

	// Category id = outpoint txid (the prevout we're consuming).
	// CashTokens spec requires the prevout to be at vout=0 of its parent
	// for a genesis to be valid; we hard-require outpointIndex=0.
	const categoryHex = spec.outpointTxid.toLowerCase();
	const category = hexToBin(categoryHex);

	// Build the token-bearing output. libauth's encoder writes the
	// CashTokens prefix automatically when `token` is present.
	const tokenOutput: Output = {
		lockingBytecode: recipientLock,
		valueSatoshis: BigInt(tokenOutputSats),
		token: {
			amount: wantsFt ? (spec.supply as bigint) : 0n,
			category,
			...(wantsNft
				? {
						nft: {
							capability: spec.nftCapability ?? 'none',
							commitment: nftCommitment ?? new Uint8Array(0)
						}
					}
				: {})
		}
	};

	// Estimate tx size BEFORE finalizing change-output value, because the
	// change-output value depends on the fee, which depends on the size.
	// One input + two outputs (token + change). Token output gets the
	// prefix overhead; change is plain P2PKH.
	const estimatedTxBytes =
		TX_OVERHEAD_BYTES +
		ESTIMATED_INPUT_BYTES +
		(ESTIMATED_OUTPUT_BYTES_PLAIN + TOKEN_PREFIX_OVERHEAD_BYTES) +
		ESTIMATED_OUTPUT_BYTES_PLAIN;
	let feeSats = Math.ceil(estimatedTxBytes * feeRate);

	let rawChangeSats = spec.outpointSatoshis - tokenOutputSats - feeSats;
	if (rawChangeSats < 0) {
		throw new Error(
			`outpointSatoshis (${spec.outpointSatoshis}) too small to cover token output (${tokenOutputSats}) + fee (${feeSats})`
		);
	}

	// Dust-band handling: if change would be 1..545 sats, BCHN rejects
	// the tx with `bad-txns-vout-toosmall`. Fold the dust into the fee
	// and drop the change output entirely. User pays a small premium on
	// that one UTXO rather than seeing a baffling broadcast failure.
	let changeOutput: Output | null;
	let changeSats: number;
	if (rawChangeSats === 0 || rawChangeSats >= DUST_THRESHOLD_SATS) {
		changeSats = rawChangeSats;
		changeOutput =
			rawChangeSats > 0
				? {
						lockingBytecode: recipientLock,
						valueSatoshis: BigInt(rawChangeSats)
					}
				: null;
	} else {
		// 1..545 → fold into fee, no change output.
		feeSats += rawChangeSats;
		changeSats = 0;
		changeOutput = null;
	}

	// Single input — the funding outpoint. unlockingBytecode is left
	// EMPTY (zero-length) because the wallet will fill it during signing.
	// `outpointTransactionHash` uses big-endian (UI) byte order per the
	// libauth Input.outpointTransactionHash docstring.
	const input: Input = {
		outpointTransactionHash: hexToBin(spec.outpointTxid),
		outpointIndex: 0,
		sequenceNumber: 0xfffffffe, // CSV-allowed, locktime-allowed
		unlockingBytecode: new Uint8Array(0)
	};

	const tx: TransactionCommon = {
		version: 2,
		locktime: 0,
		inputs: [input],
		// Token output FIRST so it's at vout=0 — wallets and explorers
		// expect the genesis token at output[0]. Change output omitted
		// in the dust-band case (see above).
		outputs: changeOutput ? [tokenOutput, changeOutput] : [tokenOutput]
	};

	const unsignedTxBin = encodeTransactionCommon(tx);
	return {
		unsignedTxHex: binToHex(unsignedTxBin),
		categoryHex,
		feeSats,
		changeSats,
		estimatedTxBytes
	};
}
