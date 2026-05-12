// CRUD for `bcmr_publish_sessions`. Mirrors src/lib/server/mintSessions.ts
// shape — same resume-across-refresh + forward-only state machine pattern.
//
// State machine:
//   drafting   → wizard in progress (steps 1-3: identity, icon, canonicalize)
//   signed     → user has signed but not broadcast (rare in practice)
//   broadcast  → publication tx submitted to BCHN, awaiting confirmation
//   confirmed  → sync-bcmr-onchain observed the new authchain hop +
//                upserted token_metadata; category now has bcmr_source='onchain'
//   failed     → broadcast errored, sha256-verify failed, or wallet refused
//   abandoned  → user explicitly dropped the session
//
// Each session is scoped to (cashaddr, category): a wallet may publish for
// many categories in parallel, but only one in-progress draft per (wallet,
// category) is allowed (partial unique index enforces this).

import { query, hexFromBytes, bytesFromHex } from './db';

export type BcmrPublishState =
	| 'drafting'
	| 'signed'
	| 'broadcast'
	| 'confirmed'
	| 'failed'
	| 'abandoned';

export interface BcmrPublishSession {
	id: string;
	cashaddr: string;
	categoryHex: string;
	state: BcmrPublishState;
	// Draft fields
	name: string | null;
	ticker: string | null;
	description: string | null;
	decimals: number | null;
	iconUri: string | null;
	// Canonicalized output
	bcmrJson: unknown | null;
	contentHashHex: string | null;
	publicationUri: string | null;
	publicationVerifiedAt: number | null;
	// Authchain context
	authchainHeadTxidHex: string | null;
	authchainHeadCapturedAt: number | null;
	// Tx record
	unsignedTxHex: string | null;
	signedTxHex: string | null;
	publishTxidHex: string | null;
	// Bookkeeping
	createdAt: number;
	updatedAt: number;
}

interface DbRow {
	id: string;
	cashaddr: string;
	category: Buffer;
	state: BcmrPublishState;
	name: string | null;
	ticker: string | null;
	description: string | null;
	decimals: number | null;
	icon_uri: string | null;
	bcmr_json: unknown | null;
	content_hash: Buffer | null;
	publication_uri: string | null;
	publication_verified_at: Date | null;
	authchain_head_txid_at_session: Buffer | null;
	authchain_head_captured_at: Date | null;
	unsigned_tx_hex: string | null;
	signed_tx_hex: string | null;
	publish_txid: Buffer | null;
	created_at: Date;
	updated_at: Date;
}

function rowToSession(r: DbRow): BcmrPublishSession {
	return {
		id: r.id,
		cashaddr: r.cashaddr,
		categoryHex: hexFromBytes(r.category)!,
		state: r.state,
		name: r.name,
		ticker: r.ticker,
		description: r.description,
		decimals: r.decimals,
		iconUri: r.icon_uri,
		bcmrJson: r.bcmr_json,
		contentHashHex: hexFromBytes(r.content_hash),
		publicationUri: r.publication_uri,
		publicationVerifiedAt: r.publication_verified_at
			? Math.floor(r.publication_verified_at.getTime() / 1000)
			: null,
		authchainHeadTxidHex: hexFromBytes(r.authchain_head_txid_at_session),
		authchainHeadCapturedAt: r.authchain_head_captured_at
			? Math.floor(r.authchain_head_captured_at.getTime() / 1000)
			: null,
		unsignedTxHex: r.unsigned_tx_hex,
		signedTxHex: r.signed_tx_hex,
		publishTxidHex: hexFromBytes(r.publish_txid),
		createdAt: Math.floor(r.created_at.getTime() / 1000),
		updatedAt: Math.floor(r.updated_at.getTime() / 1000)
	};
}

/** Per-user cap on in-flight `drafting` sessions across all categories.
 *  Lower than the mint cap (10) since BCMR publication is a one-shot
 *  per category and most users publish for 1-3 categories total. */
const MAX_DRAFTING_PER_USER = 5;

/** Create a new draft for (`cashaddr`, `category`). Throws with a
 *  `tooManyDrafts` discriminator if the user is over the per-user cap;
 *  caller maps that to a 429. The partial unique index on
 *  `(cashaddr, category) WHERE state='drafting'` enforces the
 *  one-draft-per-(wallet,category) invariant at the DB layer; a duplicate
 *  insert surfaces as a unique-violation that caller maps to a 409. */
export async function createSession(
	cashaddr: string,
	categoryHex: string
): Promise<BcmrPublishSession> {
	const countRes = await query<{ n: string }>(
		`SELECT COUNT(*)::bigint AS n
		   FROM bcmr_publish_sessions
		  WHERE cashaddr = $1 AND state = 'drafting'`,
		[cashaddr]
	);
	const drafting = Number(countRes.rows[0]?.n ?? 0);
	if (drafting >= MAX_DRAFTING_PER_USER) {
		const err = new Error(
			`Too many open BCMR publish drafts (${drafting}/${MAX_DRAFTING_PER_USER}). Abandon or complete an existing draft before starting a new one.`
		);
		(err as Error & { tooManyDrafts: true }).tooManyDrafts = true;
		throw err;
	}
	const res = await query<DbRow>(
		`INSERT INTO bcmr_publish_sessions (cashaddr, category, state)
         VALUES ($1, $2, 'drafting')
         RETURNING *`,
		[cashaddr, bytesFromHex(categoryHex)]
	);
	const row = res.rows[0];
	if (!row) throw new Error('Failed to create BCMR publish session');
	return rowToSession(row);
}

/** List the caller's sessions, newest first, paginated. */
export async function listSessions(
	cashaddr: string,
	limit: number,
	offset: number
): Promise<BcmrPublishSession[]> {
	const res = await query<DbRow>(
		`SELECT * FROM bcmr_publish_sessions
          WHERE cashaddr = $1
          ORDER BY created_at DESC
          LIMIT $2 OFFSET $3`,
		[cashaddr, limit, offset]
	);
	return res.rows.map(rowToSession);
}

/** Load one session, scoped to the authenticated user. Returns null if
 * not found OR not owned by the caller — same outcome from the API
 * caller's perspective so we don't leak existence. */
export async function getSession(
	cashaddr: string,
	id: string
): Promise<BcmrPublishSession | null> {
	const res = await query<DbRow>(
		`SELECT * FROM bcmr_publish_sessions
          WHERE id = $1 AND cashaddr = $2`,
		[id, cashaddr]
	);
	const row = res.rows[0];
	return row ? rowToSession(row) : null;
}

export interface BcmrPublishSessionPatch {
	state?: BcmrPublishState;
	name?: string | null;
	ticker?: string | null;
	description?: string | null;
	decimals?: number | null;
	iconUri?: string | null;
	bcmrJson?: unknown | null;
	contentHashHex?: string | null;
	publicationUri?: string | null;
	publicationVerifiedAt?: 'now' | null;
	authchainHeadTxidHex?: string | null;
	authchainHeadCapturedAt?: 'now' | null;
	unsignedTxHex?: string | null;
	signedTxHex?: string | null;
	publishTxidHex?: string | null;
}

/**
 * Patch any subset of session fields. Caller-scoped to `cashaddr` so a
 * malicious session ID guess can't write into someone else's draft.
 *
 * State-machine guard: forward-only. The DB rejects backwards moves via
 * the `current_state IN (...)` predicate, same pattern as mintSessions.
 *
 * Append-only guard for publish_txid + content_hash + authchain_head_txid:
 * once recorded these are derived from the chain (or from canonicalized
 * input) and must not be overwritten by a retried PATCH.
 */
export async function updateSession(
	cashaddr: string,
	id: string,
	patch: BcmrPublishSessionPatch
): Promise<BcmrPublishSession | null> {
	const sets: string[] = ['updated_at = now()'];
	const values: unknown[] = [];
	const push = (column: string, value: unknown) => {
		values.push(value);
		sets.push(`${column} = $${values.length}`);
	};

	if (patch.state !== undefined) push('state', patch.state);
	if (patch.name !== undefined) push('name', patch.name);
	if (patch.ticker !== undefined) push('ticker', patch.ticker);
	if (patch.description !== undefined) push('description', patch.description);
	if (patch.decimals !== undefined) push('decimals', patch.decimals);
	if (patch.iconUri !== undefined) push('icon_uri', patch.iconUri);
	if (patch.bcmrJson !== undefined) {
		// Bind via the JSONB cast so pg-node's default Object→jsonb routing
		// kicks in; null is encoded as the SQL NULL not the JSONB null
		// literal, matching column-clearing semantics elsewhere.
		push('bcmr_json', patch.bcmrJson === null ? null : JSON.stringify(patch.bcmrJson));
		// The placeholder was added as the last slot; rewrite to ::jsonb cast.
		const last = sets[sets.length - 1];
		sets[sets.length - 1] = last.replace(
			/= \$(\d+)$/,
			(_, n: string) => `= $${n}::jsonb`
		);
	}
	if (patch.contentHashHex !== undefined) {
		push('content_hash', patch.contentHashHex ? bytesFromHex(patch.contentHashHex) : null);
	}
	if (patch.publicationUri !== undefined) push('publication_uri', patch.publicationUri);
	if (patch.publicationVerifiedAt !== undefined) {
		if (patch.publicationVerifiedAt === 'now') {
			sets.push('publication_verified_at = now()');
		} else {
			sets.push('publication_verified_at = NULL');
		}
	}
	if (patch.authchainHeadTxidHex !== undefined) {
		push(
			'authchain_head_txid_at_session',
			patch.authchainHeadTxidHex ? bytesFromHex(patch.authchainHeadTxidHex) : null
		);
	}
	if (patch.authchainHeadCapturedAt !== undefined) {
		if (patch.authchainHeadCapturedAt === 'now') {
			sets.push('authchain_head_captured_at = now()');
		} else {
			sets.push('authchain_head_captured_at = NULL');
		}
	}
	if (patch.unsignedTxHex !== undefined) push('unsigned_tx_hex', patch.unsignedTxHex);
	if (patch.signedTxHex !== undefined) push('signed_tx_hex', patch.signedTxHex);
	if (patch.publishTxidHex !== undefined) {
		push('publish_txid', patch.publishTxidHex ? bytesFromHex(patch.publishTxidHex) : null);
	}

	values.push(id, cashaddr);
	const idIdx = values.length - 1;
	const cashaddrIdx = values.length;

	// Forward-only state guard (same shape as mintSessions).
	let stateGuard = '';
	if (patch.state) {
		const allowed: Record<BcmrPublishState, BcmrPublishState[]> = {
			drafting: ['drafting'],
			signed: ['drafting', 'signed'],
			broadcast: ['drafting', 'signed'],
			confirmed: ['broadcast', 'confirmed'],
			failed: ['drafting', 'signed', 'broadcast', 'failed'],
			abandoned: ['drafting', 'signed', 'failed', 'abandoned']
		};
		const acceptable = allowed[patch.state].map((s) => `'${s}'`).join(',');
		stateGuard = `AND state IN (${acceptable})`;
	}

	// Append-only guards. Once set these are derived from the chain
	// (publish_txid) or from canonicalized input (content_hash) or from the
	// authchain walker (authchain_head_txid). A retried PATCH that tries to
	// write a different value must fail rather than silently corrupt the
	// row.
	const immutableGuards: string[] = [];
	if (patch.publishTxidHex !== undefined && patch.publishTxidHex !== null) {
		immutableGuards.push('publish_txid IS NULL');
	}
	if (patch.contentHashHex !== undefined && patch.contentHashHex !== null) {
		immutableGuards.push('content_hash IS NULL');
	}
	if (patch.authchainHeadTxidHex !== undefined && patch.authchainHeadTxidHex !== null) {
		immutableGuards.push('authchain_head_txid_at_session IS NULL');
	}
	const immutableGuard = immutableGuards.length > 0 ? `AND ${immutableGuards.join(' AND ')}` : '';

	const sql = `UPDATE bcmr_publish_sessions
                 SET ${sets.join(', ')}
                 WHERE id = $${idIdx} AND cashaddr = $${cashaddrIdx}
                 ${stateGuard}
                 ${immutableGuard}
                 RETURNING *`;
	const res = await query<DbRow>(sql, values);
	const row = res.rows[0];
	return row ? rowToSession(row) : null;
}

/** Hard-delete a session. Use sparingly — `state='abandoned'` via
 *  updateSession is usually the right call. */
export async function deleteSession(cashaddr: string, id: string): Promise<boolean> {
	const res = await query<{ id: string }>(
		`DELETE FROM bcmr_publish_sessions
          WHERE id = $1 AND cashaddr = $2
          RETURNING id`,
		[id, cashaddr]
	);
	return res.rows.length > 0;
}
