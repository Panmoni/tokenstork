// Sender-wallet UTXO fetcher. Reads from our local BlockBook (the same
// indexer that powers token_holders enrichment), so the cashaddr never
// leaves our box.
//
// Used by the airdrop builder to discover the sender's spendable inputs
// (BCH-side funding + source-token-bearing) at draft time. Returns a
// shape suitable for libauth `Input` + `Output` reconstruction without
// further on-chain lookups: BlockBook gives us txid + vout + value +
// optional tokenData; the locking script is derivable from the cashaddr
// itself via `cashAddressToLockingBytecode`.
//
// Env: BLOCKBOOK_URL (default http://127.0.0.1:9131).

import { env } from '$env/dynamic/private';
import { timedFetch } from './fetch';

export interface WalletUtxo {
	/** UI / big-endian txid hex. */
	txid: string;
	vout: number;
	/** BCH value in satoshis. */
	valueSats: bigint;
	/** Block height. -1 for mempool entries (not seen in practice for our
	 *  use case since BlockBook's utxo endpoint excludes mempool by
	 *  default). */
	height: number;
	/** Token data, if this UTXO carries CashTokens. Hex strings on
	 *  category + commitment; bigint on amount. Capability is one of
	 *  'none' | 'mutable' | 'minting' or undefined for FT-only outputs. */
	tokenData?: {
		categoryHex: string;
		amount: bigint;
		commitmentHex?: string;
		capability?: 'none' | 'mutable' | 'minting';
	};
}

interface BlockBookUtxoResponse {
	txid: string;
	vout: number;
	value: string;
	height: number;
	tokenData?: {
		category: string;
		amount: string;
		commitment?: string;
		capability?: 'none' | 'mutable' | 'minting';
	};
}

function blockbookUrl(): string {
	// Strip trailing slashes so a `BLOCKBOOK_URL=http://host:port/` env
	// doesn't yield `.../9131//api/v2/utxo/...`. Most servers normalise
	// double slashes but it's sloppy and an attacker-controlled env value
	// could in principle exploit the path concatenation.
	return (env.BLOCKBOOK_URL || 'http://127.0.0.1:9131').replace(/\/+$/, '');
}

/**
 * Fetch every spendable UTXO for a cashaddr from local BlockBook. Returns
 * an array — caller filters to source-token UTXOs vs BCH-funding UTXOs as
 * needed.
 *
 * Mempool inclusion: BlockBook's default behaviour is to include
 * unconfirmed UTXOs in the response. This is critical for airdrop
 * chunk-chaining — chunk K's change output must be visible at chunk
 * K+1's build time, before K confirms in a block. We verify the default
 * via integration smoke; if BlockBook ever changes the default we'd add
 * `?confirmed=false` explicitly.
 *
 * Throws on network error or non-200 response. Caller maps to a user-
 * friendly error.
 */
export async function fetchWalletUtxos(cashaddr: string): Promise<WalletUtxo[]> {
	// BlockBook accepts either bare or canonical cashaddr; canonical is
	// what we have from event.locals.user.cashaddr, so pass it through.
	const url = `${blockbookUrl()}/api/v2/utxo/${encodeURIComponent(cashaddr)}`;
	const res = await timedFetch(url, { timeoutMs: 15_000 });
	if (!res.ok) {
		throw new Error(`BlockBook utxo HTTP ${res.status}`);
	}
	const body = (await res.json()) as BlockBookUtxoResponse[] | { error: string };
	if (!Array.isArray(body)) {
		throw new Error(`BlockBook utxo error: ${body.error ?? 'unknown'}`);
	}
	return body.map((u) => {
		const utxo: WalletUtxo = {
			txid: u.txid,
			vout: u.vout,
			valueSats: BigInt(u.value),
			height: u.height
		};
		if (u.tokenData) {
			utxo.tokenData = {
				categoryHex: u.tokenData.category,
				amount: BigInt(u.tokenData.amount),
				commitmentHex: u.tokenData.commitment,
				capability: u.tokenData.capability
			};
		}
		return utxo;
	});
}

/** Filter convenience — UTXOs carrying the source-token category, FT
 *  side only (no NFT commitment / capability). Airdrops never spend NFT
 *  UTXOs because they'd lose the unique commitment data; the sender's
 *  NFT UTXOs are deliberately excluded from the input pool. */
export function filterSourceTokenUtxos(
	utxos: WalletUtxo[],
	categoryHex: string
): WalletUtxo[] {
	return utxos.filter(
		(u) =>
			u.tokenData &&
			u.tokenData.categoryHex.toLowerCase() === categoryHex.toLowerCase() &&
			u.tokenData.commitmentHex == null &&
			u.tokenData.capability == null
	);
}

/** Filter convenience — plain BCH UTXOs (no token data). Used to fund
 *  fees and the per-recipient sat-floor. */
export function filterBchUtxos(utxos: WalletUtxo[]): WalletUtxo[] {
	return utxos.filter((u) => !u.tokenData);
}
