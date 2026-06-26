// Server-side TS port of `walk_authchain` from workers/src/bcmr_onchain.rs.
// Used by the BCMR publish wizard (#33) to:
//
//   1. Find the current authchain head for a category — `findAuthchainHead`
//      walks via the self-maintained `authchain_edge` table (populated by
//      sync-tail's Pass 7) following vout[0] spends. Cold-start path when
//      `tokens.authchain_head_txid` is null; the steady-state read path
//      uses the cached head from the column directly.
//
//   2. Check whether a wallet currently owns vout=0 of the authchain head —
//      `walletOwnsAuthNft` does a BCHN getrawtransaction + scriptPubKey
//      match against the caller's derived locking bytecode.
//
// No BlockBook dependency. All lookups use authchain_edge (self-indexed
// spend index) + BCHN RPC for head confirmation and address resolution.

import { cashAddressToLockingBytecode } from '@bitauth/libauth';
import { query, bytesFromHex } from './db';
import { getRawTransactionVerbose, getTxOut } from './bchn';

const MAX_HOPS = 15;
const HEX64_REGEX = /^[0-9a-fA-F]{64}$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive the P2PKH locking script hex for a cashaddr. */
function lockingScriptHex(cashaddr: string): string {
	const result = cashAddressToLockingBytecode(cashaddr);
	if (typeof result === 'string') return '';
	return Buffer.from(result.bytecode).toString('hex');
}

/** Look up the child tx that spent a parent's vout[0] from authchain_edge. */
async function lookupChildTxid(parentTxidHex: string): Promise<string | null> {
	const parent = bytesFromHex(parentTxidHex);
	const res = await query<{ child_txid: Buffer }>(
		'SELECT child_txid FROM authchain_edge WHERE parent_txid = $1',
		[parent]
	);
	if (res.rows.length === 0) return null;
	return Buffer.from(res.rows[0].child_txid).toString('hex');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
 * Walk the authchain forward from `genesisTxid` via the self-maintained
 * authchain_edge index + BCHN head confirmation, following vout[0] spends
 * until the head. Returns the head tx + the current owner address of vout=0.
 *
 * Throws on network error, malformed BCHN response, spend-index gap
 * (edge table missing a known spend), or if the chain exceeds MAX_HOPS.
 *
 * @param genesisTxid Lowercase hex of the category's genesis tx.
 */
export async function findAuthchainHead(genesisTxid: string): Promise<AuthchainHead> {
	if (!HEX64_REGEX.test(genesisTxid)) {
		throw new Error(`findAuthchainHead: invalid genesis txid: ${genesisTxid}`);
	}
	let cur = genesisTxid.toLowerCase();
	for (let hop = 0; hop < MAX_HOPS; hop++) {
		const child = await lookupChildTxid(cur);
		if (child === null) {
			// No child in the edge table — candidate head. Confirm with BCHN.
			const unspent = await getTxOut(cur, 0);
			if (!unspent) {
				throw new Error(
					`findAuthchainHead: spend-index gap — ${cur.slice(0, 16)} vout[0] ` +
					`is spent per BCHN gettxout but authchain_edge has no child. Index may be lagging.`
				);
			}
			// Head confirmed. Resolve vout[0] address from BCHN.
			const tx = await getRawTransactionVerbose(cur);
			const v0 = tx.vout?.find((v) => v.n === 0);
			const addresses: string[] = [];
			if (v0?.scriptPubKey?.hex) {
				// Extract P2PKH hash and encode to cashaddr.
				// We return the script hex as a fallback identifier.
				addresses.push(v0.scriptPubKey.hex);
			}
			return { headTxid: cur, headVout0Addresses: addresses, hopCount: hop };
		}
		if (!HEX64_REGEX.test(child)) {
			throw new Error(
				`findAuthchainHead: authchain_edge returned non-hex child_txid for ${cur}`
			);
		}
		cur = child.toLowerCase();
	}
	throw new Error(`findAuthchainHead: exceeded ${MAX_HOPS} hops starting from ${genesisTxid}`);
}

/**
 * Read the cached head (`tokens.authchain_head_txid`) and check whether
 * `cashaddr` currently owns vout=0 of that tx.
 *
 * Uses BCHN gettxout to confirm the head is still unspent, then checks
 * the vout[0] scriptPubKey against the caller's derived locking bytecode.
 *
 * Returns `null` if the head txid we cached has already been spent (chain
 * advanced between our walker's last visit and this call). The caller
 * should treat this as "stale cache; trigger a re-walk and retry."
 */
export async function isOwnerOfHeadVout0(
	cachedHeadTxidHex: string,
	cashaddr: string
): Promise<boolean | null> {
	if (!HEX64_REGEX.test(cachedHeadTxidHex)) {
		throw new Error(`isOwnerOfHeadVout0: invalid head txid: ${cachedHeadTxidHex}`);
	}
	const txid = cachedHeadTxidHex.toLowerCase();

	// Confirm the head is still unspent.
	const unspent = await getTxOut(txid, 0);
	if (!unspent) {
		return null; // stale cache — head has been spent
	}

	// Derive the caller's locking script and compare against vout[0].
	const callerScript = lockingScriptHex(cashaddr);
	if (!callerScript) {
		throw new Error('isOwnerOfHeadVout0: could not derive locking script from cashaddr');
	}

	const tx = await getRawTransactionVerbose(txid);
	const v0 = tx.vout?.find((v) => v.n === 0);
	if (!v0) {
		throw new Error(`isOwnerOfHeadVout0: tx ${txid} has no vout[0]`);
	}

	return v0.scriptPubKey?.hex?.toLowerCase() === callerScript.toLowerCase();
}
