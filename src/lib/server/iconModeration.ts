// Operator review + decisions for the icon-safety pipeline (item #22 /
// docs/icon-safety-plan.md). Backs the hidden /admin/icons queue.
//
// THE ON-DISK INVARIANT THIS MODULE GUARDS
// ----------------------------------------
// Caddy serves the ENTIRE /var/lib/tokenstork/icons/ directory as a flat
// file_server — any <hash>.webp present on disk is fetchable at
// /icons/<hash>.webp regardless of its DB state. The worker writes the
// transcoded WebP for BOTH `cleared` AND `review` states (so an operator
// can preview a review-state image), but writes NOTHING for `blocked`
// (adult/CSAM bytes never hit disk).
//
// Consequence: flipping a `review` row to `blocked` in the DB alone does
// NOT stop Caddy serving the file. So `blockIcon` MUST delete the on-disk
// WebP — that file deletion is the load-bearing security action, the DB
// write is just bookkeeping. Conversely `clearIcon` requires the file to
// already be on disk (it is, for a review-state row) — clearing a row
// whose file is gone would make `iconHrefFor` emit /icons/<hash>.webp for
// a 404, painting broken icons across the public directory.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';
import { query, bytesFromHex, hexFromBytes } from './db';
import type { IconState, OperatorBlockReason } from '$lib/iconModeration';

// Re-export the client-safe constants so server-side importers (the
// /api/admin/icons endpoints) can pull everything from one place.
export {
	OPERATOR_BLOCK_REASONS,
	isOperatorBlockReason
} from '$lib/iconModeration';
export type { IconState, OperatorBlockReason } from '$lib/iconModeration';

// Must match the icon worker's ICON_OUTPUT_DIR / DEFAULT_OUTPUT_DIR
// (workers/src/bin/sync-icons-backfill.rs). Same env var so the app and
// the worker can never disagree on where the bytes live.
const ICON_OUTPUT_DIR = env.ICON_OUTPUT_DIR || '/var/lib/tokenstork/icons';

export interface IconModerationRow {
	contentHashHex: string;
	sourceUrl: string;
	state: IconState;
	scannedAt: number; // unix seconds
	nsfwScore: number | null;
	blockReason: string | null;
	bytesSize: number | null;
	decidedBy: string | null;
	decidedAt: number | null; // unix seconds
	moderatorNote: string | null;
	/// How many BCMR icon URLs resolve to this content hash.
	urlCount: number;
	/// One example icon_uri, so the operator can see where it came from.
	sampleUri: string | null;
	/// Distinct `tokens` that would render this icon once cleared.
	tokenCount: number;
	/// True iff the transcoded WebP is present on disk (and thus
	/// previewable at /icons/<hash>.webp). Always true for review/cleared
	/// in the happy path; surfaced so the UI can show "no preview".
	hasFile: boolean;
}

interface DbRow {
	content_hash: Buffer;
	source_url: string;
	state: IconState;
	scanned_at: Date;
	nsfw_score: number | null;
	block_reason: string | null;
	bytes_size: number | null;
	decided_by: string | null;
	decided_at: Date | null;
	moderator_note: string | null;
	url_count: number;
	sample_uri: string | null;
	token_count: number;
}

function iconFilePath(contentHashHex: string): string {
	return join(ICON_OUTPUT_DIR, `${contentHashHex.toLowerCase()}.webp`);
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await fs.access(path);
		return true;
	} catch {
		return false;
	}
}

async function rowToModeration(r: DbRow): Promise<IconModerationRow> {
	const contentHashHex = hexFromBytes(r.content_hash)!;
	return {
		contentHashHex,
		sourceUrl: r.source_url,
		state: r.state,
		scannedAt: Math.floor(r.scanned_at.getTime() / 1000),
		nsfwScore: r.nsfw_score,
		blockReason: r.block_reason,
		bytesSize: r.bytes_size,
		decidedBy: r.decided_by,
		decidedAt: r.decided_at ? Math.floor(r.decided_at.getTime() / 1000) : null,
		moderatorNote: r.moderator_note,
		urlCount: r.url_count,
		sampleUri: r.sample_uri,
		tokenCount: r.token_count,
		hasFile: await fileExists(iconFilePath(contentHashHex))
	};
}

/** Per-state row counts for the filter tabs. Missing states default to 0. */
export async function getIconStateCounts(): Promise<Record<IconState, number>> {
	const counts: Record<IconState, number> = {
		pending: 0,
		cleared: 0,
		blocked: 0,
		review: 0
	};
	const res = await query<{ state: IconState; n: number }>(
		`SELECT state, COUNT(*)::int AS n FROM icon_moderation GROUP BY state`
	);
	for (const r of res.rows) {
		if (r.state in counts) counts[r.state] = r.n;
	}
	return counts;
}

/**
 * List moderation rows for `state` ('all' = every state), newest-scanned
 * first, with per-hash URL + token rollups. `limit`/`offset` paginate.
 */
export async function listIconModeration(
	state: IconState | 'all',
	limit: number,
	offset: number
): Promise<IconModerationRow[]> {
	// Page the moderation rows FIRST (cheap, indexed on state+scanned_at),
	// then fan out the URL / token rollups only for the page's rows. The
	// token rollup walks icon_url_scan → token_metadata → tokens; keeping
	// it scoped to LIMIT rows keeps the query bounded.
	const res = await query<DbRow>(
		`WITH page AS (
		     SELECT content_hash, source_url, state, scanned_at, nsfw_score,
		            block_reason, bytes_size, decided_by, decided_at, moderator_note
		       FROM icon_moderation
		      WHERE ($3::text IS NULL OR state = $3)
		      ORDER BY scanned_at DESC
		      LIMIT $1 OFFSET $2
		 )
		 SELECT p.*,
		        (SELECT COUNT(*)::int
		           FROM icon_url_scan s
		          WHERE s.content_hash = p.content_hash) AS url_count,
		        (SELECT s.icon_uri
		           FROM icon_url_scan s
		          WHERE s.content_hash = p.content_hash
		          ORDER BY s.icon_uri
		          LIMIT 1) AS sample_uri,
		        (SELECT COUNT(DISTINCT t.category)::int
		           FROM icon_url_scan s
		           JOIN token_metadata m ON m.icon_uri = s.icon_uri
		           JOIN tokens t          ON t.category = m.category
		          WHERE s.content_hash = p.content_hash) AS token_count
		   FROM page p
		  ORDER BY p.scanned_at DESC`,
		[limit, offset, state === 'all' ? null : state]
	);
	return Promise.all(res.rows.map(rowToModeration));
}

/**
 * Clear an icon: flip its row to `state='cleared'` so `iconHrefFor` will
 * serve /icons/<hash>.webp to the public. REFUSES if the WebP isn't on
 * disk — clearing a row with no file would emit a broken icon URL across
 * the directory. (Re-blocked-then-cleared is the only way to hit that;
 * such a hash must be re-fetched by the worker first.)
 */
export async function clearIcon(
	contentHashHex: string,
	operatorCashaddr: string,
	note: string | null
): Promise<IconModerationRow> {
	if (!(await fileExists(iconFilePath(contentHashHex)))) {
		throw new Error(
			'No transcoded image on disk for this hash — cannot clear (the worker must re-fetch it first).'
		);
	}
	const res = await query<DbRow>(
		`UPDATE icon_moderation
		    SET state = 'cleared',
		        block_reason = NULL,
		        decided_by = $2,
		        decided_at = now(),
		        moderator_note = $3
		  WHERE content_hash = $1
		RETURNING content_hash, source_url, state, scanned_at, nsfw_score,
		          block_reason, bytes_size, decided_by, decided_at, moderator_note,
		          0 AS url_count, NULL::text AS sample_uri, 0 AS token_count`,
		[bytesFromHex(contentHashHex), operatorCashaddr, note]
	);
	if (!res.rows[0]) throw new Error(`No icon_moderation row for ${contentHashHex}`);
	return rowToModeration(res.rows[0]);
}

export interface BulkClearResult {
	/// Hashes successfully flipped to `cleared`.
	cleared: string[];
	/// Hashes we did NOT clear, each with the reason (no file on disk, or
	/// no matching moderation row).
	skipped: { hash: string; reason: string }[];
}

/**
 * Bulk variant of {@link clearIcon}: approve many hashes in one round trip
 * so the operator can clear a reviewed batch at once. The same on-disk
 * invariant holds PER HASH — a hash whose transcoded WebP is missing is
 * SKIPPED (never cleared), so a batch approve can never paint a broken icon
 * across the public directory. The DB flip is a single UPDATE over the
 * survivors. Returns which hashes cleared and which were skipped (and why)
 * so the UI can report partial success.
 */
export async function bulkClearIcons(
	contentHashesHex: string[],
	operatorCashaddr: string,
	note: string | null
): Promise<BulkClearResult> {
	// De-dupe + normalise; an empty set is a no-op.
	const hashes = [...new Set(contentHashesHex.map((h) => h.toLowerCase()))];
	const skipped: { hash: string; reason: string }[] = [];
	const clearable: string[] = [];

	// File-existence checks fan out in parallel — same gate as clearIcon,
	// just batched. A missing WebP means there are no bytes to serve, so
	// the hash is skipped rather than cleared.
	await Promise.all(
		hashes.map(async (h) => {
			if (await fileExists(iconFilePath(h))) clearable.push(h);
			else skipped.push({ hash: h, reason: 'no image on disk' });
		})
	);
	if (clearable.length === 0) return { cleared: [], skipped };

	// Pass hashes as a text[] and decode() inside the query — unambiguous
	// to serialise and still index-friendly (the IN-subquery yields the
	// same bytea values content_hash is indexed on).
	const res = await query<{ content_hash: Buffer }>(
		`UPDATE icon_moderation
		    SET state = 'cleared',
		        block_reason = NULL,
		        decided_by = $2,
		        decided_at = now(),
		        moderator_note = $3
		  WHERE content_hash IN (SELECT decode(h, 'hex') FROM unnest($1::text[]) AS t(h))
		RETURNING content_hash`,
		[clearable, operatorCashaddr, note]
	);
	const clearedSet = new Set(res.rows.map((r) => hexFromBytes(r.content_hash)!));
	// A clearable hash with no matching row (e.g. deleted between page load
	// and submit) won't come back from RETURNING — report it as skipped.
	for (const h of clearable) {
		if (!clearedSet.has(h)) skipped.push({ hash: h, reason: 'no moderation row' });
	}
	return { cleared: [...clearedSet], skipped };
}

/**
 * Block an icon: delete the on-disk WebP (the load-bearing step — stops
 * Caddy serving it) THEN flip the row to `state='blocked'` with a reason.
 *
 * Order matters: delete first. If the unlink fails for a real reason
 * (permissions), we throw BEFORE writing the DB, so we never record a
 * "blocked" decision while the bytes are still being served — a silent
 * security hole. A missing file (ENOENT) is fine: the goal (no bytes on
 * disk) is already met, so we proceed to the DB write.
 */
export async function blockIcon(
	contentHashHex: string,
	operatorCashaddr: string,
	reason: OperatorBlockReason,
	note: string | null
): Promise<IconModerationRow> {
	const path = iconFilePath(contentHashHex);
	try {
		await fs.unlink(path);
	} catch (err) {
		const e = err as NodeJS.ErrnoException;
		if (e.code !== 'ENOENT') {
			// Could not remove the bytes — refuse to claim the icon is
			// blocked while Caddy is still serving it.
			throw new Error(
				`Failed to delete ${path} (${e.code ?? e.message}); block aborted so the image is not falsely marked blocked while still served.`
			);
		}
	}
	const res = await query<DbRow>(
		`UPDATE icon_moderation
		    SET state = 'blocked',
		        block_reason = $2,
		        decided_by = $3,
		        decided_at = now(),
		        moderator_note = $4
		  WHERE content_hash = $1
		RETURNING content_hash, source_url, state, scanned_at, nsfw_score,
		          block_reason, bytes_size, decided_by, decided_at, moderator_note,
		          0 AS url_count, NULL::text AS sample_uri, 0 AS token_count`,
		[bytesFromHex(contentHashHex), reason, operatorCashaddr, note]
	);
	if (!res.rows[0]) throw new Error(`No icon_moderation row for ${contentHashHex}`);
	return rowToModeration(res.rows[0]);
}
