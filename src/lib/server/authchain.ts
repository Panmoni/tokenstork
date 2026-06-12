// Server-side TS port of `walk_authchain` from workers/src/bcmr_onchain.rs.
// Used by the BCMR publish wizard (#33) to:
//
//   1. Find the current authchain head for a category — `findAuthchainHead`
//      walks via BlockBook's `/api/v2/tx/<txid>` following `vout[0].spentTxId`
//      until None. Cold-start path when `tokens.authchain_head_txid` is null
//      (the worker hasn't cached it yet); the steady-state read path uses the
//      cached head from the column directly.
//
//   2. Check whether a wallet currently owns vout=0 of the authchain head —
//      `walletOwnsAuthNft` does a single BlockBook `/api/v2/tx/<headTxid>`
//      call and matches the head's vout[0].addresses against the caller's
//      cashaddr. Per the CashTokens CHIP, the holder of vout=0 of the
//      latest authchain tx is the only address authorised to publish a new
//      BCMR locator.
//
// All BlockBook calls go through `timedFetch` with explicit timeouts —
// matching the worker-side hardening. Local-network latency is fine
// (~50ms per hop on carson); we cap at 50 hops as a safety bound matching
// the Rust walker's default.
//
// Env: BLOCKBOOK_URL (default http://127.0.0.1:9131).

import { env } from '$env/dynamic/private';
import { timedFetch } from './fetch';

const MAX_HOPS = 50;
const HEX64_REGEX = /^[0-9a-fA-F]{64}$/;

function blockbookUrl(): string {
	return (env.BLOCKBOOK_URL || 'http://127.0.0.1:9131').replace(/\/+$/, '');
}

interface BlockBookVout {
	n: number;
	/** Present when the output is still unspent. Null/absent means the
	 *  output has been consumed by the tx referenced here. */
	spentTxId?: string;
	addresses?: string[];
}

interface BlockBookTx {
	txid: string;
	vout: BlockBookVout[];
}

async function getTx(txid: string): Promise<BlockBookTx> {
	if (!HEX64_REGEX.test(txid)) {
		throw new Error(`invalid txid hex: ${txid}`);
	}
	// ?spending=true is required for BlockBook to populate vout[].spentTxId
	// (observed 2026-06-12: a freshly spent vout=0 returned spent=true with
	// NO spentTxId without the param, so the walk dead-ended at a stale
	// head and walletOwnsAuthNft treated the spent head as live).
	const url = `${blockbookUrl()}/api/v2/tx/${txid}?spending=true`;
	const res = await timedFetch(url, { timeoutMs: 10_000 });
	if (!res.ok) {
		throw new Error(`BlockBook tx HTTP ${res.status} for ${txid}`);
	}
	return (await res.json()) as BlockBookTx;
}

export interface AuthchainHead {
	/** Lowercase hex of the head tx's txid. The on-chain spend that the
	 *  publish wizard must reference as input[0] of the publication tx. */
	headTxid: string;
	/** Addresses currently holding vout=0 of the head tx. Usually a single
	 *  cashaddr (P2PKH); covenants may produce multi-address entries. */
	headVout0Addresses: string[];
	/** Number of hops traversed from genesis to head. Useful for diagnostics. */
	hopCount: number;
}

/**
 * Walk the authchain forward from `genesisTxid` via BlockBook, following
 * `vout[0].spentTxId` until None. Returns the head tx + the current owner
 * addresses of vout=0.
 *
 * Throws on network error, malformed BlockBook response, or if the chain
 * exceeds MAX_HOPS (safety bound — legitimate authchains are 1-5 hops).
 * The walker writes nothing to the DB; callers (the publish wizard) may
 * cache the head via `pg::update_token_authchain_head`.
 *
 * @param genesisTxid Lowercase hex of the category's genesis tx (== the
 *                    txid of the parent UTXO whose vout=0 was spent to
 *                    create the category; equals `tokens.genesis_txid`).
 */
export async function findAuthchainHead(genesisTxid: string): Promise<AuthchainHead> {
	if (!HEX64_REGEX.test(genesisTxid)) {
		throw new Error(`findAuthchainHead: invalid genesis txid: ${genesisTxid}`);
	}
	let cur = genesisTxid.toLowerCase();
	for (let hop = 0; hop < MAX_HOPS; hop++) {
		const tx = await getTx(cur);
		const v0 = tx.vout.find((v) => v.n === 0);
		if (!v0) {
			throw new Error(`authchain walk: tx ${cur} has no vout[0]`);
		}
		if (v0.spentTxId == null) {
			// Head reached.
			return {
				headTxid: cur,
				headVout0Addresses: v0.addresses ?? [],
				hopCount: hop
			};
		}
		if (!HEX64_REGEX.test(v0.spentTxId)) {
			throw new Error(
				`authchain walk: BlockBook returned non-hex spentTxId "${v0.spentTxId}" for ${cur}`
			);
		}
		cur = v0.spentTxId.toLowerCase();
	}
	throw new Error(`authchain walk: exceeded ${MAX_HOPS} hops starting from ${genesisTxid}`);
}

/**
 * Read the cached head (`tokens.authchain_head_txid`) and check whether
 * `cashaddr` currently owns vout=0 of that tx. Single BlockBook RPC per
 * call when the cache hit fires; otherwise falls back to a cold-start
 * authchain walk and persists the result.
 *
 * Returns `null` if the head txid we cached has already been spent (chain
 * advanced between our walker's last visit and this call). The caller
 * should treat this as "stale cache; trigger a re-walk and retry."
 *
 * The address check is string-equality against the cashaddr the caller
 * authenticated with — BlockBook returns `bitcoincash:q...` form for
 * P2PKH outputs, matching the canonical form we store in
 * `users.cashaddr`. Comparison is case-sensitive per the CashAddr spec
 * (canonical form is lowercase).
 */
export async function isOwnerOfHeadVout0(
	cachedHeadTxidHex: string,
	cashaddr: string
): Promise<boolean | null> {
	if (!HEX64_REGEX.test(cachedHeadTxidHex)) {
		throw new Error(`isOwnerOfHeadVout0: invalid head txid: ${cachedHeadTxidHex}`);
	}
	const tx = await getTx(cachedHeadTxidHex.toLowerCase());
	const v0 = tx.vout.find((v) => v.n === 0);
	if (!v0) {
		throw new Error(`isOwnerOfHeadVout0: tx ${cachedHeadTxidHex} has no vout[0]`);
	}
	// Stale cache: the head we cached has already been spent. Caller
	// should re-walk and retry against the new head.
	if (v0.spentTxId != null) {
		return null;
	}
	return (v0.addresses ?? []).includes(cashaddr);
}
