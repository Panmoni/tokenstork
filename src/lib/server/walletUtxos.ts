// Sender-wallet UTXO fetcher. Reads confirmed UTXOs from live_token_utxo
// (self-indexed by sync-tail, source: BCHN blocks) and mempool UTXOs from
// BCHN's getrawmempool + getrawtransaction. No BlockBook dependency.
//
// Used by the airdrop builder, mint funding, BCMR publish, and consolidation
// to discover the sender's spendable inputs (confirmed + unconfirmed).
//
// Mempool inclusion is critical for airdrop chunk-chaining: chunk K's change
// output must be visible at chunk K+1's build time, before K confirms in a
// block.

import { env } from '$env/dynamic/private';
import { cashAddressToLockingBytecode } from '@bitauth/libauth';
import { query, hexFromBytes } from './db';
import {
	getRawMempool,
	getRawTransactionVerbose,
	type VerboseTxVout
} from './bchn';

export interface WalletUtxo {
	/** UI / big-endian txid hex. */
	txid: string;
	vout: number;
	/** BCH value in satoshis. */
	valueSats: bigint;
	/** Block height. -1 for mempool entries. */
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

// ---------------------------------------------------------------------------
// Mempool cache: module-scoped, rebuilt on demand with a short TTL so
// repeated requests within a batch (airdrop chunking) share one scan.
// ---------------------------------------------------------------------------

const MEMPOOL_CACHE_TTL_MS = Number(env.WALLET_MEMPOOL_CACHE_MS ?? 5000);

interface MempoolCacheEntry {
	utxos: Map<string, WalletUtxo[]>;
	builtAt: number;
}

let _mempoolCache: MempoolCacheEntry | null = null;

/** Derive the P2PKH locking script for a cashaddr. Returns hex string. */
function lockingScriptHex(cashaddr: string): string {
	const result = cashAddressToLockingBytecode(cashaddr);
	if (typeof result === 'string') return '';
	return Buffer.from(result.bytecode).toString('hex');
}

/** Map a BCHN verbose vout to a WalletUtxo tokenData subset. */
function voutTokenData(vout: VerboseTxVout): WalletUtxo['tokenData'] | undefined {
	const td = vout.tokenData;
	if (!td) return undefined;
	return {
		categoryHex: td.category,
		amount: BigInt(td.amount),
		commitmentHex: td.nft?.commitment,
		capability: td.nft?.capability
	};
}

/** Build or refresh the in-memory mempool → address → UTXO map. */
async function buildMempoolCache(): Promise<MempoolCacheEntry> {
	const utxos = new Map<string, WalletUtxo[]>();
	const txids = await getRawMempool();

	if (txids.length === 0) {
		return { utxos, builtAt: Date.now() };
	}

	// Fetch verbose txs. BCHN localhost latency ~1ms per call, so a
	// few thousand txs is tolerable. For >10k txs (rare on BCH) this
	// degrades gracefully: the request-lifetime timeout (10s on the
	// db pool statement_timeout, 15s on the rpcCall signal) catches
	// it and the caller retries.
	const txs = await Promise.all(
		txids.map(async (txid) => {
			try {
				return await getRawTransactionVerbose(txid);
			} catch {
				return null;
			}
		})
	);

	// For each tx, classify outputs by their locking script → address
	// key. We store the locking-script hex as the map key because
	// cashAddressToLockingBytecode is a one-way derivation
	// (cashaddr → script, but script → cashaddr needs a hash160
	// lookup). At query time we derive the script from the caller's
	// cashaddr and do an O(1) map lookup.
	for (const tx of txs) {
		if (!tx || !tx.vout) continue;
		for (let n = 0; n < tx.vout.length; n++) {
			const vout = tx.vout[n];
			const scriptHex = vout.scriptPubKey?.hex;
			if (!scriptHex) continue;

			let list = utxos.get(scriptHex);
			if (!list) {
				list = [];
				utxos.set(scriptHex, list);
			}

			const valueSats = BigInt(Math.round(vout.value * 1e8));
			list.push({
				txid: tx.txid,
				vout: n,
				valueSats,
				height: -1,
				tokenData: voutTokenData(vout)
			});
		}
	}

	return { utxos, builtAt: Date.now() };
}

async function getMempoolCache(): Promise<MempoolCacheEntry> {
	const now = Date.now();
	if (!_mempoolCache || now - _mempoolCache.builtAt > MEMPOOL_CACHE_TTL_MS) {
		_mempoolCache = await buildMempoolCache();
	}
	return _mempoolCache;
}

// ---------------------------------------------------------------------------
// DB types for live_token_utxo rows
// ---------------------------------------------------------------------------

interface DbUtxoRow {
	txid: Buffer;
	vout: number;
	category: Buffer;
	amount: string;       // NUMERIC → string from node-postgres
	address: string;
	nft_commitment: Buffer | null;
	nft_capability: string | null;
	created_height: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch every spendable UTXO for a cashaddr. Confirmed UTXOs come from
 * live_token_utxo (self-indexed by sync-tail). Mempool UTXOs come from
 * a periodically-refreshed BCHN mempool scan. Merged and deduplicated
 * (confirmed takes precedence over mempool for the same outpoint).
 *
 * Throws on DB error or BCHN RPC error. Caller maps to a user-friendly
 * error.
 */
export async function fetchWalletUtxos(cashaddr: string): Promise<WalletUtxo[]> {
	// Canonical cashaddr prefix is required by tokens.addresses column
	// (stored without 'bitcoincash:' prefix).
	const canonical = cashaddr.startsWith('bitcoincash:')
		? cashaddr.slice('bitcoincash:'.length)
		: cashaddr;

	const [dbRows, mempoolCache] = await Promise.all([
		// Confirmed UTXOs from live_token_utxo
		query<DbUtxoRow>(
			`SELECT txid, vout, category, amount::text, address,
			        nft_commitment, nft_capability, created_height
			   FROM live_token_utxo
			  WHERE address = $1
			  ORDER BY txid, vout`,
			[canonical]
		),
		getMempoolCache()
	]);

	// Build confirmed UTXOs, keyed by txid:vout for dedup
	const confirmed = new Map<string, WalletUtxo>();
	for (const row of dbRows.rows) {
		const key = `${hexFromBytes(row.txid)}:${row.vout}`;
		const utxo: WalletUtxo = {
			txid: hexFromBytes(row.txid)!,
			vout: row.vout,
			valueSats: 0n, // live_token_utxo doesn't track BCH value
			height: row.created_height,
			tokenData: {
				categoryHex: hexFromBytes(row.category)!,
				amount: BigInt(row.amount),
				commitmentHex: hexFromBytes(row.nft_commitment) ?? undefined,
				capability: row.nft_capability
					? (row.nft_capability as 'none' | 'mutable' | 'minting')
					: undefined
			}
		};
		confirmed.set(key, utxo);
	}

	// Mempool UTXOs: look up by locking script
	const scriptHex = lockingScriptHex(cashaddr);
	const mempoolUtxos = mempoolCache.utxos.get(scriptHex) ?? [];

	// Merge: confirmed take precedence, append unseen mempool entries
	const outpoints = new Set(confirmed.keys());
	const result = [...confirmed.values()];
	for (const mu of mempoolUtxos) {
		const key = `${mu.txid}:${mu.vout}`;
		if (!outpoints.has(key)) {
			result.push(mu);
			outpoints.add(key);
		}
	}

	return result;
}

/**
 * Cross-check each UTXO's tokenData against the authoritative source
 * and return a corrected copy.
 *
 * For confirmed UTXOs, live_token_utxo rows are BCHN-sourced (via
 * sync-tail's Pass 6) and are authoritative — no BlockBook bug to
 * work around. For mempool UTXOs, tokenData comes directly from BCHN's
 * getrawtransaction response, also authoritative.
 *
 * This function still re-checks every unique txid against BCHN
 * getrawtransaction as defense-in-depth against index lag or corruption.
 * Cost: one localhost BCHN RPC per unique txid.
 */
export async function verifyUtxoTokenData(utxos: WalletUtxo[]): Promise<WalletUtxo[]> {
	const txids = [...new Set(utxos.map((u) => u.txid))];
	const voutTokens = new Map<string, Map<number, WalletUtxo['tokenData']>>();

	await Promise.all(
		txids.map(async (txid) => {
			try {
				const tx = await getRawTransactionVerbose(txid);
				const byVout = new Map<number, WalletUtxo['tokenData']>();
				for (const v of tx.vout ?? []) {
					const td = voutTokenData(v);
					if (td) byVout.set(v.n, td);
				}
				voutTokens.set(txid, byVout);
			} catch {
				// If BCHN can't resolve the tx, keep the original tokenData.
				// This is safe: for confirmed UTXOs the live_token_utxo row
				// already contains BCHN-verified data; for mempool UTXOs
				// a fetch failure means the tx disappeared from the mempool.
			}
		})
	);

	return utxos.map((u) => {
		const authoritative = voutTokens.get(u.txid)?.get(u.vout);
		const mismatch =
			(u.tokenData == null) !== (authoritative == null) ||
			(u.tokenData != null &&
				authoritative != null &&
				(u.tokenData.categoryHex.toLowerCase() !== authoritative.categoryHex.toLowerCase() ||
					u.tokenData.amount !== authoritative.amount ||
					(u.tokenData.commitmentHex ?? '') !== (authoritative.commitmentHex ?? '') ||
					(u.tokenData.capability ?? null) !== (authoritative.capability ?? null)));
		if (mismatch) {
			console.warn('[walletUtxos] tokenData mismatch; using BCHN truth', {
				txid: u.txid,
				vout: u.vout,
				stored: u.tokenData ?? null,
				bchn: authoritative ?? null
			});
		}
		const corrected: WalletUtxo = { ...u };
		if (authoritative) corrected.tokenData = authoritative;
		else delete corrected.tokenData;
		return corrected;
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
