// CRUD for `bcmr_tokenstork_submissions` — the operator-approval queue
// for the optional tokenstork-hosted BCMR backup. Per the dual-host
// model decided 2026-05-12: the user's own IPFS is the on-chain
// primary; tokenstork is a content-addressed fallback served at
// /bcmr/<content_hash>.json gated on operator approval.
//
// Flow:
//   1. User completes step 4 of /publish-bcmr/[id] (verifies their own
//      host) and optionally opts into the backup. submitBackup() inserts
//      a row in `pending` state.
//   2. Operator views pending rows via /admin/bcmr-submissions, reviews,
//      and calls approveSubmission() or rejectSubmission().
//   3. On approve: the row's `json_body` is written to
//      /var/lib/tokenstork/bcmr/<content_hash>.json for Caddy to serve.
//      Caddy handles the actual HTTP delivery; we just put the bytes in
//      the right directory.
//
// Idempotency: PRIMARY KEY on content_hash means resubmitting the same
// JSON is a no-op. Approval/rejection is a state transition, not a new
// row.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';
import { query, bytesFromHex, hexFromBytes } from './db';

// Admin gate now lives in one shared module (./admin) so every operator
// surface — the BCMR queue here and the icon-review queue — share one
// allowlist. Re-exported so existing importers of `isAdmin` from this
// module keep working unchanged.
export { isAdmin } from './admin';

const BCMR_BACKUP_DIR = env.BCMR_BACKUP_DIR || '/var/lib/tokenstork/bcmr';

export type SubmissionState = 'pending' | 'approved' | 'rejected';

export interface BcmrSubmission {
	contentHashHex: string;
	categoryHex: string;
	cashaddr: string;
	jsonBody: unknown;
	submittedAt: number;
	reviewState: SubmissionState;
	reviewedAt: number | null;
	reviewerCashaddr: string | null;
	moderatorNote: string | null;
}

interface DbRow {
	content_hash: Buffer;
	category: Buffer;
	cashaddr: string;
	json_body: unknown;
	submitted_at: Date;
	review_state: SubmissionState;
	reviewed_at: Date | null;
	reviewer_cashaddr: string | null;
	moderator_note: string | null;
}

function rowToSubmission(r: DbRow): BcmrSubmission {
	return {
		contentHashHex: hexFromBytes(r.content_hash)!,
		categoryHex: hexFromBytes(r.category)!,
		cashaddr: r.cashaddr,
		jsonBody: r.json_body,
		submittedAt: Math.floor(r.submitted_at.getTime() / 1000),
		reviewState: r.review_state,
		reviewedAt: r.reviewed_at ? Math.floor(r.reviewed_at.getTime() / 1000) : null,
		reviewerCashaddr: r.reviewer_cashaddr,
		moderatorNote: r.moderator_note
	};
}

/**
 * Insert a pending submission. Idempotent on content_hash — re-submitting
 * the same JSON is a no-op and returns the existing row regardless of
 * its current review_state. The bytes are immutable (the hash anchors
 * them), so a duplicate submission has nothing new to evaluate.
 */
export async function submitBackup(input: {
	contentHashHex: string;
	categoryHex: string;
	cashaddr: string;
	jsonBody: unknown;
}): Promise<BcmrSubmission> {
	const res = await query<DbRow>(
		`INSERT INTO bcmr_tokenstork_submissions
		   (content_hash, category, cashaddr, json_body)
		 VALUES ($1, $2, $3, $4::jsonb)
		 ON CONFLICT (content_hash) DO UPDATE
		   SET content_hash = bcmr_tokenstork_submissions.content_hash
		 RETURNING *`,
		[
			bytesFromHex(input.contentHashHex),
			bytesFromHex(input.categoryHex),
			input.cashaddr,
			JSON.stringify(input.jsonBody)
		]
	);
	if (!res.rows[0]) throw new Error('Failed to upsert bcmr_tokenstork_submission');
	return rowToSubmission(res.rows[0]);
}

/** Read a submission by content_hash. */
export async function getSubmission(contentHashHex: string): Promise<BcmrSubmission | null> {
	const res = await query<DbRow>(
		`SELECT * FROM bcmr_tokenstork_submissions WHERE content_hash = $1`,
		[bytesFromHex(contentHashHex)]
	);
	const row = res.rows[0];
	return row ? rowToSubmission(row) : null;
}

/** List submissions, newest-first. `state` filter is optional. */
export async function listSubmissions(
	state: SubmissionState | 'all',
	limit: number,
	offset: number
): Promise<BcmrSubmission[]> {
	const where = state === 'all' ? '' : 'WHERE review_state = $3';
	const params: unknown[] = [limit, offset];
	if (state !== 'all') params.push(state);
	const res = await query<DbRow>(
		`SELECT * FROM bcmr_tokenstork_submissions
          ${where}
          ORDER BY submitted_at DESC
          LIMIT $1 OFFSET $2`,
		params
	);
	return res.rows.map(rowToSubmission);
}

/**
 * Approve a submission: write the JSON to /var/lib/tokenstork/bcmr/
 * <content_hash>.json (so Caddy can serve it at /bcmr/<hash>.json) and
 * flip the row to `review_state='approved'`. Idempotent — re-approving
 * an already-approved row rewrites the file (defensive against fs
 * eviction / accidental deletion).
 *
 * `reviewerCashaddr` is the operator's wallet; persisted for audit.
 * `note` is optional moderator commentary, also persisted.
 */
export async function approveSubmission(
	contentHashHex: string,
	reviewerCashaddr: string,
	note: string | null
): Promise<BcmrSubmission> {
	const existing = await getSubmission(contentHashHex);
	if (!existing) {
		throw new Error(`No submission for content_hash ${contentHashHex}`);
	}

	// Write JSON to filesystem. We write the canonical JSON form (which
	// is what gets sha256-hashed); re-deriving it here from the stored
	// jsonb keeps the on-disk bytes deterministic regardless of pgsql's
	// jsonb whitespace handling.
	//
	// IMPORTANT: the on-disk bytes MUST match the content_hash. We do
	// NOT trust pgsql's jsonb roundtrip to preserve key order or
	// whitespace exactly, so we re-canonicalize before write.
	const { canonicalizeBcmr, contentHashHex: deriveHash } = await import(
		'$lib/bcmrPublish/canonical'
	);
	const canonical = canonicalizeBcmr(existing.jsonBody);
	const observedHash = deriveHash(canonical);
	if (observedHash !== contentHashHex.toLowerCase()) {
		// This would indicate either (a) jsonb roundtrip mangled the body
		// (e.g. key reorder + we have a bug in canonicalize) or (b) the
		// submitter sent us a different json_body than they hashed. Either
		// way refuse to write.
		throw new Error(
			`Refusing to write: derived hash ${observedHash} != stored ${contentHashHex}`
		);
	}

	await fs.mkdir(BCMR_BACKUP_DIR, { recursive: true });
	const filePath = join(BCMR_BACKUP_DIR, `${contentHashHex.toLowerCase()}.json`);
	await fs.writeFile(filePath, canonical, { encoding: 'utf-8' });

	const res = await query<DbRow>(
		`UPDATE bcmr_tokenstork_submissions
		    SET review_state = 'approved',
		        reviewed_at = now(),
		        reviewer_cashaddr = $2,
		        moderator_note = $3
		  WHERE content_hash = $1
		  RETURNING *`,
		[bytesFromHex(contentHashHex), reviewerCashaddr, note]
	);
	if (!res.rows[0]) throw new Error(`Approve failed; row missing for ${contentHashHex}`);
	return rowToSubmission(res.rows[0]);
}

/** Reject a submission with a moderator note. Does NOT touch the
 *  filesystem (a previously-approved-then-rejected submission could
 *  theoretically have an orphan file; deleteApprovedFile() handles
 *  that explicitly when needed). */
export async function rejectSubmission(
	contentHashHex: string,
	reviewerCashaddr: string,
	note: string
): Promise<BcmrSubmission> {
	const res = await query<DbRow>(
		`UPDATE bcmr_tokenstork_submissions
		    SET review_state = 'rejected',
		        reviewed_at = now(),
		        reviewer_cashaddr = $2,
		        moderator_note = $3
		  WHERE content_hash = $1
		  RETURNING *`,
		[bytesFromHex(contentHashHex), reviewerCashaddr, note]
	);
	if (!res.rows[0]) throw new Error(`Reject failed; row missing for ${contentHashHex}`);
	return rowToSubmission(res.rows[0]);
}
