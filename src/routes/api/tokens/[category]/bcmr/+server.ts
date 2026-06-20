// GET /api/tokens/<category_hex>/bcmr — BCMR identity pinning (watchdog M5).
//
// Serves the archived BCMR version that was in force for a category at a point
// in chain history, so a wallet / explorer / dapp can pin a known-good snapshot
// instead of blindly trusting the live, authority-controlled metadata pointer.
//
//   ?as_of_block=<int>  → the verified version in force at/before block N
//   ?as_of=<unix-secs>  → the verified version in force at/before that time
//   (none)              → the latest verified version
//
// Only sha256-verified versions are returned (the archive's canonical bodies);
// an unverified / pulled publication is never served as authoritative. `body`
// is the archived JSON, or null when the version's body exceeded the inline
// archive cap (`bodyOversize: true`) — `contentHash` + `publicationUri` remain
// the durable pointer in that case.

import { error, isHttpError, json } from '@sveltejs/kit';
import { bytesFromHex, hexFromBytes, query } from '$lib/server/db';
import { NOT_MODERATED_CLAUSE } from '$lib/moderation';
import type { RequestHandler } from './$types';

const HEX_REGEX = /^[0-9a-fA-F]{64}$/;

interface VersionRow {
	authchain_tx: Buffer;
	content_hash: Buffer;
	block_height: number | null;
	block_time: Date | null;
	publication_uri: string;
	body_verified: boolean;
	body: unknown;
	body_oversize: boolean;
	name: string | null;
	symbol: string | null;
	decimals: number | null;
	icon_uri: string | null;
	description: string | null;
}

function parseIntParam(raw: string | null): number | null {
	if (!raw) return null;
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
	return n;
}

export const GET: RequestHandler = async ({ params, url, setHeaders }) => {
	const category = params.category?.toLowerCase();
	if (!category || !HEX_REGEX.test(category)) {
		error(400, 'invalid category (expected 64 hex chars)');
	}

	const asOfBlock = parseIntParam(url.searchParams.get('as_of_block'));
	const asOfSecs = parseIntParam(url.searchParams.get('as_of'));

	// Public + CDN cache: the answer is cookie-independent and identical for
	// every requester at a given (category, as-of). A pinned historical version
	// is immutable, so it can cache hard; "latest" still revalidates within the
	// s-maxage window. Mirrors the price /history route's posture.
	setHeaders({
		'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600'
	});

	try {
		const categoryBytes = bytesFromHex(category);

		// Existence + moderation guard, mirroring /history + /holders. 410 on
		// missing or hidden so the response doesn't leak which case applies.
		const guardRes = await query(
			`SELECT 1 FROM tokens t WHERE t.category = $1 AND ${NOT_MODERATED_CLAUSE}`,
			[categoryBytes]
		);
		if (guardRes.rows.length === 0) {
			error(410, 'token not available');
		}

		const where = ['category = $1', 'body_verified'];
		const values: unknown[] = [categoryBytes];
		if (asOfBlock !== null) {
			values.push(asOfBlock);
			where.push(`block_height IS NOT NULL AND block_height <= $${values.length}`);
		} else if (asOfSecs !== null) {
			values.push(new Date(asOfSecs * 1000));
			where.push(`block_time IS NOT NULL AND block_time <= $${values.length}`);
		}

		const res = await query<VersionRow>(
			`SELECT authchain_tx, content_hash, block_height, block_time,
			        publication_uri, body_verified, body, body_oversize,
			        name, symbol, decimals, icon_uri, description
			   FROM token_metadata_history
			  WHERE ${where.join(' AND ')}
			  ORDER BY block_height DESC NULLS LAST, observed_at DESC
			  LIMIT 1`,
			values
		);

		const row = res.rows[0] ?? null;

		return json({
			category,
			asOfBlock,
			asOf: asOfSecs,
			version: row
				? {
						authchainTx: hexFromBytes(row.authchain_tx),
						contentHash: hexFromBytes(row.content_hash),
						blockHeight: row.block_height,
						blockTime: row.block_time ? Math.floor(row.block_time.getTime() / 1000) : null,
						publicationUri: row.publication_uri,
						bodyVerified: row.body_verified,
						bodyOversize: row.body_oversize,
						body: row.body ?? null,
						name: row.name,
						symbol: row.symbol,
						decimals: row.decimals,
						iconUri: row.icon_uri,
						description: row.description
					}
				: null
		});
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[api/tokens/[category]/bcmr] error:', err);
		error(500, 'Failed to fetch BCMR version');
	}
};
