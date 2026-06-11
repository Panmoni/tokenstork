// Transaction-readiness decision tree.
//
// Each wizard flow (mint, BCMR publish) has preconditions that must be
// met before we attempt a WalletConnect transaction. These checkers
// return a structured report that drives the diagnostic card UI:
// what's ready, what's missing, and whether it's fixable.
//
// Design principle: these are CLIENT-SIDE checks that complement the
// server-side validation in the build-tx endpoints. They give the user
// early feedback without a round-trip, and can trigger remedial flows
// (like BCH consolidation) before the user hits a server error.

import type { WalletUtxo } from '$lib/server/walletUtxos';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FixKind = 'consolidate-bch' | 'send-bch' | 'refresh' | 'cant-fix';

export interface Requirement {
	/** Short human-readable label, e.g. "Authority NFT" */
	label: string;
	/** Whether this requirement is met. */
	satisfied: boolean;
	/** Why it's not met (shown when !satisfied). */
	reason?: string;
	/** If solvable by an automated flow. */
	fixable?: FixKind;
	/** User-facing description of the fix action. */
	fixDescription?: string;
}

export interface TxReadinessReport {
	/** True when ALL requirements are met and a tx can proceed. */
	ready: boolean;
	/** Ordered list of requirements (critical first). */
	requirements: Requirement[];
	/** One-line summary for a status chip. */
	summary: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimum sats we expect the authNFT output plus fee to cost. Mirrors the
 *  server builder's MIN_AUTHNFT_OUTPUT_SATS + typical fee. */
const MIN_PUBLISH_COST_SATS = 2000n;
/** Minimum sats a genesis tx needs at minimum. */
const MIN_GENESIS_COST_SATS = 1500n;

function countPlainBchUtxos(utxos: WalletUtxo[]): WalletUtxo[] {
	return utxos.filter((u) => !u.tokenData);
}

function totalBchSats(utxos: WalletUtxo[]): bigint {
	return utxos.reduce((s, u) => s + u.valueSats, 0n);
}

// ---------------------------------------------------------------------------
// BCMR publish readiness
// ---------------------------------------------------------------------------

export interface BcmrPublishReadinessParams {
	/** All wallet UTXOs (from fetchWalletUtxos or /api/wallet/funding-utxos). */
	walletUtxos: WalletUtxo[];
	/** Whether the wallet owns the authority NFT for this category.
	 *  null = not yet checked. */
	ownsAuthNft: boolean | null;
	/** Whether the authNFT UTXO is present in the UTXO set. */
	authNftPresent: boolean;
	/** BCH value of the authNFT UTXO, if found. */
	authNftValueSats?: bigint;
}

export function checkBcmrPublishReadiness(
	params: BcmrPublishReadinessParams
): TxReadinessReport {
	const { walletUtxos, ownsAuthNft, authNftPresent, authNftValueSats } = params;
	const requirements: Requirement[] = [];

	// 1. AuthNFT ownership.
	if (ownsAuthNft === null) {
		requirements.push({
			label: 'Authority NFT',
			satisfied: false,
			reason: 'Checking your wallet for the authority NFT…'
		});
	} else if (!ownsAuthNft) {
		requirements.push({
			label: 'Authority NFT',
			satisfied: false,
			reason:
				'Your wallet does not hold the authority NFT for this category. You need the NFT at vout=0 of the authchain head to publish.',
			fixable: 'cant-fix'
		});
	} else if (!authNftPresent) {
		requirements.push({
			label: 'Authority NFT',
			satisfied: false,
			reason:
				'Authority NFT ownership confirmed but the UTXO is not in your wallet\'s spendable set. Try refreshing.',
			fixable: 'refresh'
		});
	} else {
		requirements.push({
			label: 'Authority NFT',
			satisfied: true
		});
	}

	// 2. BCH sufficiency.
	const plainBch = countPlainBchUtxos(walletUtxos);
	const nftSats = authNftValueSats ?? 0n;
	const totalBch = totalBchSats(plainBch) + nftSats;

	if (totalBch < MIN_PUBLISH_COST_SATS) {
		if (plainBch.length > 0) {
			requirements.push({
				label: 'BCH for fees',
				satisfied: false,
				reason: `Your wallet has ${totalBch} sats total but we need ~${MIN_PUBLISH_COST_SATS} sats to cover the new authNFT output + fee.`,
				fixable: 'consolidate-bch',
				fixDescription: `Consolidate ${plainBch.length} plain-BCH UTXO${plainBch.length > 1 ? 's' : ''} into one to meet the minimum.`
			});
		} else {
			requirements.push({
				label: 'BCH for fees',
				satisfied: false,
				reason: `Not enough BCH. You have ${totalBch} sats but need ~${MIN_PUBLISH_COST_SATS} sats. Send some BCH to your wallet first.`,
				fixable: 'send-bch',
				fixDescription: 'Send at least ' + String(MIN_PUBLISH_COST_SATS - totalBch) + ' sats of BCH to your wallet.'
			});
		}
	} else {
		requirements.push({
			label: 'BCH for fees',
			satisfied: true
		});
	}

	const ready = requirements.every((r) => r.satisfied);
	const summary = ready
		? 'Ready to sign — all requirements met'
		: `${requirements.filter((r) => !r.satisfied).length} issue${requirements.filter((r) => !r.satisfied).length > 1 ? 's' : ''} need attention`;

	return { ready, requirements, summary };
}

// ---------------------------------------------------------------------------
// Mint readiness
// ---------------------------------------------------------------------------

export interface MintReadinessParams {
	walletUtxos: WalletUtxo[];
	/** Number of vout=0 plain-BCH UTXOs suitable for funding the genesis. */
	fundingUtxoCount: number;
	/** Current selected outpoint txid (may be empty before user picks). */
	selectedOutpointTxid: string;
}

export function checkMintReadiness(
	params: MintReadinessParams
): TxReadinessReport {
	const { walletUtxos, fundingUtxoCount, selectedOutpointTxid } = params;
	const requirements: Requirement[] = [];

	// 1. Funding UTXO.
	if (fundingUtxoCount === 0) {
		const plainBch = countPlainBchUtxos(walletUtxos);
		if (plainBch.length > 0) {
			requirements.push({
				label: 'vout=0 UTXO',
				satisfied: false,
				reason:
					'You have plain-BCH UTXOs but none at vout=0. A genesis tx must spend a vout=0 output.',
				fixable: 'consolidate-bch',
				fixDescription: `Consolidate ${plainBch.length} plain-BCH UTXO${plainBch.length > 1 ? 's' : ''} into one — the resulting change output will be at vout=0.`
			});
		} else {
			requirements.push({
				label: 'Funding UTXO',
				satisfied: false,
				reason: 'No suitable vout=0 UTXO found. Send BCH to your wallet first.',
				fixable: 'send-bch',
				fixDescription: 'Send at least 1500 sats of BCH to your wallet in a single-transaction output (vout=0).'
			});
		}
	} else if (!selectedOutpointTxid) {
		requirements.push({
			label: 'Funding UTXO',
			satisfied: false,
			reason: `${fundingUtxoCount} suitable UTXO${fundingUtxoCount > 1 ? 's' : ''} found — pick one to continue.`
		});
	} else {
		requirements.push({
			label: 'Funding UTXO',
			satisfied: true
		});
	}

	// 2. BCH sufficiency.
	const totalBch = totalBchSats(walletUtxos);
	if (selectedOutpointTxid && totalBch < MIN_GENESIS_COST_SATS) {
		requirements.push({
			label: 'BCH for fees',
			satisfied: false,
			reason: `You have ${totalBch} sats total but need at least ~${MIN_GENESIS_COST_SATS} sats to cover the token output + fee.`,
			fixable: 'send-bch',
			fixDescription: 'Send more BCH to your wallet.'
		});
	} else if (selectedOutpointTxid) {
		requirements.push({
			label: 'BCH for fees',
			satisfied: true
		});
	}

	const ready = requirements.every((r) => r.satisfied);
	const summary = ready
		? 'Ready to build transaction'
		: `${requirements.filter((r) => !r.satisfied).length} issue${requirements.filter((r) => !r.satisfied).length > 1 ? 's' : ''} need attention`;

	return { ready, requirements, summary };
}
