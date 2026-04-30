// Server-side CRC-20 helpers. Pure DB reads; no external calls.

import { query } from '$lib/server/db';

export interface Crc20Contender {
	categoryHex: string;
	isCanonical: boolean;
	fairGenesisHeight: number;
}

export interface Crc20Detail {
	symbol: string;
	symbolIsHex: boolean;
	symbolBytesHex: string;
	decimals: number;
	name: string | null;
	nameBytesHex: string;
	recipientPubkeyHex: string;
	commitTxidHex: string;
	commitBlock: number;
	revealBlock: number;
	revealInputIndex: number;
	fairGenesisHeight: number;
	isCanonical: boolean;
	/// All categories sharing this `symbol_bytes`, ordered by fair genesis
	/// height. The canonical winner sits at index 0.
	contenders: Crc20Contender[];
}

interface DetailRow {
	symbol: string;
	symbol_is_hex: boolean;
	symbol_bytes_hex: string;
	decimals: number;
	name: string | null;
	name_bytes_hex: string;
	recipient_pubkey_hex: string;
	commit_txid_hex: string;
	commit_block: number;
	reveal_block: number;
	reveal_input_index: number;
	fair_genesis_height: number;
	is_canonical: boolean;
	symbol_bytes: Buffer;
}

interface ContenderRow {
	category_hex: string;
	is_canonical: boolean;
	fair_genesis_height: number;
}

/// Fetch the CRC-20 detail row for a category, plus the full list of
/// contenders sharing the same symbol bucket. Returns null when this
/// category is not a CRC-20 token. Two queries — one keyed lookup +
/// one symbol-bucket scan; both indexed.
export async function fetchCrc20Detail(category: Buffer): Promise<Crc20Detail | null> {
	const detailRes = await query<DetailRow>(
		`SELECT
			symbol,
			symbol_is_hex,
			encode(symbol_bytes, 'hex')      AS symbol_bytes_hex,
			decimals,
			name,
			encode(name_bytes, 'hex')        AS name_bytes_hex,
			encode(recipient_pubkey, 'hex')  AS recipient_pubkey_hex,
			encode(commit_txid, 'hex')       AS commit_txid_hex,
			commit_block,
			reveal_block,
			reveal_input_index,
			fair_genesis_height,
			is_canonical,
			symbol_bytes
		   FROM token_crc20
		  WHERE category = $1`,
		[category]
	);
	if (detailRes.rows.length === 0) return null;
	const row = detailRes.rows[0];

	const contendersRes = await query<ContenderRow>(
		`SELECT
			encode(category, 'hex') AS category_hex,
			is_canonical,
			fair_genesis_height
		   FROM token_crc20
		  WHERE symbol_bytes = $1
		  ORDER BY fair_genesis_height ASC, category ASC, reveal_input_index ASC`,
		[row.symbol_bytes]
	);

	return {
		symbol: row.symbol,
		symbolIsHex: row.symbol_is_hex,
		symbolBytesHex: row.symbol_bytes_hex,
		decimals: row.decimals,
		name: row.name,
		nameBytesHex: row.name_bytes_hex,
		recipientPubkeyHex: row.recipient_pubkey_hex,
		commitTxidHex: row.commit_txid_hex,
		commitBlock: row.commit_block,
		revealBlock: row.reveal_block,
		revealInputIndex: row.reveal_input_index,
		fairGenesisHeight: row.fair_genesis_height,
		isCanonical: row.is_canonical,
		contenders: contendersRes.rows.map((r) => ({
			categoryHex: r.category_hex,
			isCanonical: r.is_canonical,
			fairGenesisHeight: r.fair_genesis_height
		}))
	};
}

export interface Crc20SymbolBucket {
	symbol: string;
	symbolIsHex: boolean;
	contenderCount: number;
	canonicalCategory: string | null;
}

/// One row per distinct symbol bucket, with a contender count and the
/// hex of the canonical winner's category. Powers the /crc20 page header
/// and the disputed-symbols table.
export async function fetchCrc20Symbols(): Promise<Crc20SymbolBucket[]> {
	const res = await query<{
		symbol: string;
		symbol_is_hex: boolean;
		contender_count: string;
		canonical_category_hex: string | null;
	}>(
		`SELECT
			symbol,
			symbol_is_hex,
			COUNT(*)::bigint AS contender_count,
			MAX(CASE WHEN is_canonical THEN encode(category, 'hex') END) AS canonical_category_hex
		   FROM token_crc20
		  GROUP BY symbol, symbol_is_hex
		  ORDER BY COUNT(*) DESC, LOWER(symbol) ASC`
	);
	return res.rows.map((r) => ({
		symbol: r.symbol,
		symbolIsHex: r.symbol_is_hex,
		contenderCount: Number(r.contender_count),
		canonicalCategory: r.canonical_category_hex
	}));
}
