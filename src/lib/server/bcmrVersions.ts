// BCMR version-history timeline (watchdog M5). Reads every archived version of a
// category from token_metadata_history (newest first) and annotates each with
// the fields that changed relative to the previous (older) version, for the
// timeline rendered on the token detail page.
//
// Includes UNVERIFIED versions (hash mismatch / unfetchable) so the timeline can
// surface a rug attempt — the body never trusted, just shown as "did not
// verify". `bodyVerified` distinguishes them in the UI.

import { query, hexFromBytes } from '$lib/server/db';

export interface BcmrVersionEntry {
	authchainTx: string;
	contentHash: string;
	blockHeight: number | null;
	/** Unix seconds; null for an unconfirmed (mempool) carrying tx. */
	blockTime: number | null;
	bodyVerified: boolean;
	/** Verified body existed but exceeded the inline archive cap (body is null). */
	bodyOversize: boolean;
	bodySizeBytes: number | null;
	name: string | null;
	symbol: string | null;
	decimals: number | null;
	iconUri: string | null;
	publicationUri: string;
	/** Authority controller address at this hop, if decodable. */
	controllerAddr: string | null;
	/** Identity fields that differ from the previous (older) version. */
	changedFields: string[];
}

interface Row {
	authchain_tx: Buffer;
	content_hash: Buffer;
	block_height: number | null;
	block_time: Date | null;
	body_verified: boolean;
	body_oversize: boolean;
	body_size_bytes: number | null;
	name: string | null;
	symbol: string | null;
	decimals: number | null;
	icon_uri: string | null;
	description: string | null;
	publication_uri: string;
	head_controller_addr: string | null;
}

export async function getBcmrVersions(categoryBytes: Buffer): Promise<BcmrVersionEntry[]> {
	const res = await query<Row>(
		`SELECT authchain_tx, content_hash, block_height, block_time,
		        body_verified, body_oversize, body_size_bytes,
		        name, symbol, decimals, icon_uri, description,
		        publication_uri, head_controller_addr
		   FROM token_metadata_history
		  WHERE category = $1
		  ORDER BY block_height DESC NULLS LAST, observed_at DESC`,
		[categoryBytes]
	);

	const rows = res.rows;
	return rows.map((r, i) => {
		// The previous (older) version is the next row, since rows are newest-first.
		const prior = rows[i + 1];
		const changed: string[] = [];
		if (prior) {
			if (prior.name !== r.name) changed.push('name');
			if (prior.symbol !== r.symbol) changed.push('symbol');
			if ((prior.decimals ?? null) !== (r.decimals ?? null)) changed.push('decimals');
			if (prior.icon_uri !== r.icon_uri) changed.push('icon');
			if (prior.description !== r.description) changed.push('description');
		}
		return {
			authchainTx: hexFromBytes(r.authchain_tx)!,
			contentHash: hexFromBytes(r.content_hash)!,
			blockHeight: r.block_height,
			blockTime: r.block_time ? Math.floor(r.block_time.getTime() / 1000) : null,
			bodyVerified: r.body_verified,
			bodyOversize: r.body_oversize,
			bodySizeBytes: r.body_size_bytes,
			name: r.name,
			symbol: r.symbol,
			decimals: r.decimals,
			iconUri: r.icon_uri,
			publicationUri: r.publication_uri,
			controllerAddr: r.head_controller_addr,
			changedFields: changed
		};
	});
}
