// Airdrop persistence + eligibility helpers. Server-only.
//
// Auth gate: every helper here assumes the caller has already verified
// `event.locals.user`. The cashaddr argument is trusted (came from the
// verified session). Address normalization: cashaddrs are stored
// canonical-form (with `bitcoincash:` prefix) in users/sessions but
// bare-form (no prefix) in token_holders + airdrop_outputs to match the
// existing convention from sync-enrich. Helpers strip the prefix on
// the way IN to comparisons against token_holders.

import type { PoolClient } from 'pg';
import { query, withTransaction } from './db';

/** Strip the `bitcoincash:` prefix if present. token_holders.address is
 *  bare-form; sessions.cashaddr is canonical. Eligibility queries need
 *  the bare form. */
export function stripCashaddrPrefix(cashaddr: string): string {
	const idx = cashaddr.indexOf(':');
	return idx === -1 ? cashaddr : cashaddr.slice(idx + 1);
}

/** True if the category appears in `token_moderation` (i.e. is hidden
 *  from the directory + 410'd from /token/[hex]). Airdrop endpoints
 *  refuse to operate on moderated categories — neither as the source
 *  (we won't help redistribute moderated tokens) nor as the recipient
 *  set (we won't airdrop to its holders). Cheap PK seek. */
export async function isCategoryModerated(category: Buffer): Promise<boolean> {
	const result = await query(
		`SELECT 1 FROM token_moderation WHERE category = $1 LIMIT 1`,
		[category]
	);
	return (result.rowCount ?? 0) > 0;
}

export interface MyTokenRow {
	categoryHex: string;
	tokenType: 'FT' | 'NFT' | 'FT+NFT';
	name: string | null;
	symbol: string | null;
	decimals: number;
	balance: string; // NUMERIC(78,0) text
	nftCount: number;
	iconUri: string | null;
	iconClearedHash: string | null;
}

/** List every non-moderated category the authenticated wallet holds
 *  (FT balance > 0 OR NFT count > 0), enriched with display fields
 *  for the airdrop wizard's source-token dropdown. Joins through
 *  token_metadata + the icon-safety pipeline so the dropdown can
 *  show real names + safe icons.
 *
 *  Hard-capped at 200 rows — even the most-active collectors hold
 *  far fewer than this; an unbounded SELECT would otherwise blow up
 *  the dropdown UI for an outlier wallet. */
export async function listMyTokens(cashaddr: string): Promise<MyTokenRow[]> {
	const bare = stripCashaddrPrefix(cashaddr);
	const result = await query<{
		category: Buffer;
		token_type: 'FT' | 'NFT' | 'FT+NFT';
		name: string | null;
		symbol: string | null;
		decimals: number | null;
		balance: string;
		nft_count: number;
		icon_uri: string | null;
		icon_cleared_hash: string | null;
	}>(
		`SELECT t.category,
		        t.token_type,
		        m.name,
		        m.symbol,
		        m.decimals,
		        th.balance::text AS balance,
		        th.nft_count,
		        m.icon_uri,
		        encode(imo.content_hash, 'hex') AS icon_cleared_hash
		   FROM token_holders th
		   JOIN tokens t ON t.category = th.category
		   LEFT JOIN token_metadata m ON m.category = t.category
		   LEFT JOIN icon_url_scan ius ON ius.icon_uri = m.icon_uri
		   LEFT JOIN icon_moderation imo
		          ON imo.content_hash = ius.content_hash
		         AND imo.state = 'cleared'
		  WHERE th.address = $1
		    AND (th.balance > 0 OR th.nft_count > 0)
		    AND NOT EXISTS (
		      SELECT 1 FROM token_moderation mod WHERE mod.category = t.category
		    )
		  ORDER BY th.balance DESC NULLS LAST, m.name ASC NULLS LAST
		  LIMIT 200`,
		[bare]
	);
	return result.rows.map((r) => {
		const hex = Buffer.from(r.category).toString('hex');
		return {
			categoryHex: hex,
			tokenType: r.token_type,
			name: r.name,
			symbol: r.symbol,
			decimals: r.decimals ?? 0,
			balance: r.balance,
			nftCount: r.nft_count,
			iconUri: r.icon_uri,
			iconClearedHash: r.icon_cleared_hash
		};
	});
}

export interface HolderSnapshotRow {
	address: string;
	balance: string; // NUMERIC(78,0) — text to preserve precision
	nft_count: number;
}

/** Eligibility check: does THIS authenticated cashaddr hold any of THIS
 *  category, by FT balance OR NFT count? Returns the row if so, null
 *  otherwise. Used both at draft time (gate the airdrop button) and at
 *  broadcast time (re-check; sender may have spent the source token
 *  between draft and signing). */
export async function eligibilityFor(
	cashaddr: string,
	categoryBytes: Buffer
): Promise<HolderSnapshotRow | null> {
	const bare = stripCashaddrPrefix(cashaddr);
	const result = await query<HolderSnapshotRow>(
		`SELECT address, balance::text AS balance, nft_count
		   FROM token_holders
		  WHERE category = $1 AND address = $2 AND (balance > 0 OR nft_count > 0)
		  LIMIT 1`,
		[categoryBytes, bare]
	);
	return result.rows[0] ?? null;
}

export interface RecipientSnapshot {
	address: string;
	balance: bigint;
	nftCount: number;
}

/** Pull the recipient list for a category. balance > 0 OR nft_count > 0.
 *  Returns bare-form cashaddrs (token_holders convention). Caller filters
 *  out the sender's own cashaddr after this. Returns the full set —
 *  CashTokens have at most ~1400 holders for the most popular tokens, so
 *  we don't paginate on the server side. */
export async function holderListFor(
	categoryBytes: Buffer
): Promise<RecipientSnapshot[]> {
	const result = await query<{ address: string; balance: string; nft_count: number }>(
		`SELECT address, balance::text AS balance, nft_count
		   FROM token_holders
		  WHERE category = $1 AND (balance > 0 OR nft_count > 0)
		  ORDER BY balance DESC, address ASC`,
		[categoryBytes]
	);
	return result.rows.map((r) => ({
		address: r.address,
		balance: BigInt(r.balance),
		nftCount: r.nft_count
	}));
}

/** Newest snapshot timestamp across `token_holders` rows for a category.
 *  Used as the freshness-guard reference: airdrops.holders_snapshot_at is
 *  set to this at draft, then compared at every broadcast. If the value
 *  has advanced (sync-enrich ran in between), refuse remaining txs and
 *  ask the user to redraft. */
export async function holderSnapshotFor(
	categoryBytes: Buffer
): Promise<Date | null> {
	const result = await query<{ snapshot_at: Date }>(
		`SELECT MAX(snapshot_at) AS snapshot_at
		   FROM token_holders WHERE category = $1`,
		[categoryBytes]
	);
	return result.rows[0]?.snapshot_at ?? null;
}

export interface AirdropDraftInput {
	senderCashaddr: string;
	sourceCategory: Buffer;
	recipientCategory: Buffer;
	mode: 'equal' | 'weighted';
	totalAmount: bigint;
	outputValueSats: number;
	holdersSnapshotAt: Date;
	allocations: Array<{ cashaddr: string; amount: bigint; txIndex: number }>;
	txCount: number;
}

/** Insert an `airdrops` row + N `airdrop_outputs` rows + tx_count
 *  `airdrop_txs` rows in a single transaction. Returns the airdrop UUID.
 *  The partial unique index on `(sender_cashaddr) WHERE state IN
 *  ('drafting','signing')` will fire if the sender already has a draft
 *  in flight — caller catches and surfaces.
 */
export async function createDraft(input: AirdropDraftInput): Promise<string> {
	return withTransaction(async (client: PoolClient) => {
		const airdropResult = await client.query<{ id: string }>(
			`INSERT INTO airdrops (
				sender_cashaddr, source_category, recipient_category, mode,
				total_amount, holder_count, output_value_sats,
				holders_snapshot_at, state, tx_count
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'drafting', $9)
			RETURNING id`,
			[
				input.senderCashaddr,
				input.sourceCategory,
				input.recipientCategory,
				input.mode,
				input.totalAmount.toString(),
				input.allocations.length,
				input.outputValueSats,
				input.holdersSnapshotAt,
				input.txCount
			]
		);
		const airdropId = airdropResult.rows[0].id;

		// One row per chunk — populated in advance so the wizard can walk
		// them in order; state='pending' until the wallet signs each.
		for (let i = 0; i < input.txCount; i++) {
			await client.query(
				`INSERT INTO airdrop_txs (airdrop_id, tx_index, state)
				 VALUES ($1, $2, 'pending')`,
				[airdropId, i]
			);
		}

		// One row per recipient — bulk insert via UNNEST for speed at
		// large recipient counts (~1400 max in practice).
		const cashaddrs = input.allocations.map((a) => a.cashaddr);
		const amounts = input.allocations.map((a) => a.amount.toString());
		const txIndexes = input.allocations.map((a) => a.txIndex);
		await client.query(
			`INSERT INTO airdrop_outputs (airdrop_id, recipient_cashaddr, amount, tx_index, state)
			 SELECT $1, addr, amt::numeric, idx, 'pending'
			   FROM UNNEST($2::text[], $3::text[], $4::int[]) AS t(addr, amt, idx)`,
			[airdropId, cashaddrs, amounts, txIndexes]
		);

		return airdropId;
	});
}

export interface AirdropRow {
	id: string;
	sender_cashaddr: string;
	source_category: Buffer;
	recipient_category: Buffer;
	mode: 'equal' | 'weighted';
	total_amount: string;
	holder_count: number;
	output_value_sats: number;
	holders_snapshot_at: Date;
	state: string;
	tx_count: number;
	created_at: Date;
	updated_at: Date;
}

export async function getById(airdropId: string): Promise<AirdropRow | null> {
	const result = await query<AirdropRow>(
		`SELECT * FROM airdrops WHERE id = $1`,
		[airdropId]
	);
	return result.rows[0] ?? null;
}

export interface AirdropTxRow {
	tx_index: number;
	txid: Buffer | null;
	state: string;
	fail_reason: string | null;
}

export async function listTxsFor(airdropId: string): Promise<AirdropTxRow[]> {
	const result = await query<AirdropTxRow>(
		`SELECT tx_index, txid, state, fail_reason
		   FROM airdrop_txs WHERE airdrop_id = $1 ORDER BY tx_index ASC`,
		[airdropId]
	);
	return result.rows;
}

export interface AirdropOutputRow {
	recipient_cashaddr: string;
	amount: string;
	tx_index: number;
	vout_index: number | null;
	state: string;
}

export async function listOutputsFor(airdropId: string): Promise<AirdropOutputRow[]> {
	const result = await query<AirdropOutputRow>(
		`SELECT recipient_cashaddr, amount::text AS amount, tx_index, vout_index, state
		   FROM airdrop_outputs WHERE airdrop_id = $1
		  ORDER BY tx_index ASC, recipient_cashaddr ASC`,
		[airdropId]
	);
	return result.rows;
}

/** Walk a single tx index from 'pending' → 'broadcast' (or 'failed'),
 *  recording the txid on success. Updates child airdrop_outputs in lockstep
 *  via the matching tx_index. Caller is responsible for rolling the parent
 *  airdrop's state forward (drafting → signing → broadcasting → complete |
 *  partial | failed); this helper only owns the per-tx + per-output rows.
 */
export async function markTxResult(
	airdropId: string,
	txIndex: number,
	result: { txid: Buffer; voutMap: Map<string, number> } | { error: string }
): Promise<void> {
	await withTransaction(async (client: PoolClient) => {
		if ('error' in result) {
			await client.query(
				`UPDATE airdrop_txs SET state = 'failed', fail_reason = $1
				  WHERE airdrop_id = $2 AND tx_index = $3`,
				[result.error.slice(0, 1000), airdropId, txIndex]
			);
			await client.query(
				`UPDATE airdrop_outputs SET state = 'failed'
				  WHERE airdrop_id = $1 AND tx_index = $2`,
				[airdropId, txIndex]
			);
			return;
		}

		await client.query(
			`UPDATE airdrop_txs SET state = 'broadcast', txid = $1, fail_reason = NULL
			  WHERE airdrop_id = $2 AND tx_index = $3`,
			[result.txid, airdropId, txIndex]
		);
		// Bulk update each recipient's vout_index from the per-tx map. We
		// pass parallel arrays + UNNEST for one round-trip rather than N
		// individual UPDATEs.
		const recipients = Array.from(result.voutMap.keys());
		const vouts = Array.from(result.voutMap.values());
		await client.query(
			`UPDATE airdrop_outputs ao
			    SET state = 'broadcast', vout_index = m.vout
			   FROM UNNEST($1::text[], $2::int[]) AS m(addr, vout)
			  WHERE ao.airdrop_id = $3 AND ao.tx_index = $4
			    AND ao.recipient_cashaddr = m.addr`,
			[recipients, vouts, airdropId, txIndex]
		);
	});
}

/** Roll the parent airdrop state forward. Computed from `airdrop_txs`
 *  states: all broadcast → complete; any failed + any broadcast → partial;
 *  all failed → failed; otherwise stay where it is. Runs after each
 *  per-tx broadcast completes. */
export async function recomputeAirdropState(airdropId: string): Promise<string> {
	const result = await query<{ state: string }>(
		`UPDATE airdrops SET state = (
		   SELECT CASE
		     WHEN COUNT(*) FILTER (WHERE state = 'broadcast') = COUNT(*) THEN 'complete'
		     WHEN COUNT(*) FILTER (WHERE state = 'failed') = COUNT(*) THEN 'failed'
		     WHEN COUNT(*) FILTER (WHERE state = 'failed') > 0
		      AND COUNT(*) FILTER (WHERE state = 'broadcast') > 0 THEN 'partial'
		     WHEN COUNT(*) FILTER (WHERE state = 'broadcast') > 0 THEN 'broadcasting'
		     ELSE 'signing'
		   END
		   FROM airdrop_txs WHERE airdrop_id = $1
		 ),
		 updated_at = now()
		 WHERE id = $1
		 RETURNING state`,
		[airdropId]
	);
	return result.rows[0]?.state ?? 'unknown';
}

/** History page query — sender's airdrops, newest first, paginated. */
export async function listForUser(
	cashaddr: string,
	limit: number,
	offset: number
): Promise<AirdropRow[]> {
	const result = await query<AirdropRow>(
		`SELECT * FROM airdrops WHERE sender_cashaddr = $1
		  ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
		[cashaddr, limit, offset]
	);
	return result.rows;
}
