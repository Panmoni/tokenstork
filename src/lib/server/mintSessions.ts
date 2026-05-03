// CRUD for `user_mint_sessions`. The wizard saves on each step
// transition + loads on mount, so a browser refresh resumes the user
// where they left off.
//
// State machine:
//   drafting   → wizard in progress
//   signed     → user has signed but not broadcast (rare; we usually
//                fold sign+broadcast into one step)
//   broadcast  → genesis tx submitted to BCHN, awaiting confirmation
//   confirmed  → sync-tail saw the genesis tx; category column populated
//   failed     → broadcast errored or the wallet refused to sign
//   abandoned  → user explicitly dropped the session
//
// Forward-only transitions are enforced at the SQL level via WHERE
// clauses on UPDATE — see the per-state predicates in `update`.

import { query, hexFromBytes, bytesFromHex } from './db';

export type MintState = 'drafting' | 'signed' | 'broadcast' | 'confirmed' | 'failed' | 'abandoned';
export type MintTokenType = 'FT' | 'NFT' | 'FT+NFT';
export type NftCapability = 'none' | 'mutable' | 'minting';

export interface MintSession {
	id: string;
	cashaddr: string;
	state: MintState;
	tokenType: MintTokenType | null;
	ticker: string | null;
	name: string | null;
	description: string | null;
	decimals: number | null;
	supply: string | null; // text — NUMERIC(78,0) preserved precision
	nftCapability: NftCapability | null;
	nftCommitmentHex: string | null;
	iconStagingPath: string | null;
	genesisTxidHex: string | null;
	categoryHex: string | null;
	createdAt: number; // unix seconds
	updatedAt: number;
}

interface DbRow {
	id: string;
	cashaddr: string;
	state: MintState;
	token_type: MintTokenType | null;
	ticker: string | null;
	name: string | null;
	description: string | null;
	decimals: number | null;
	supply: string | null;
	nft_capability: NftCapability | null;
	nft_commitment: Buffer | null;
	icon_staging_path: string | null;
	genesis_txid: Buffer | null;
	category: Buffer | null;
	created_at: Date;
	updated_at: Date;
}

function rowToSession(r: DbRow): MintSession {
	return {
		id: r.id,
		cashaddr: r.cashaddr,
		state: r.state,
		tokenType: r.token_type,
		ticker: r.ticker,
		name: r.name,
		description: r.description,
		decimals: r.decimals,
		supply: r.supply,
		nftCapability: r.nft_capability,
		nftCommitmentHex: hexFromBytes(r.nft_commitment),
		iconStagingPath: r.icon_staging_path,
		genesisTxidHex: hexFromBytes(r.genesis_txid),
		categoryHex: hexFromBytes(r.category),
		createdAt: Math.floor(r.created_at.getTime() / 1000),
		updatedAt: Math.floor(r.updated_at.getTime() / 1000)
	};
}

/** Per-user cap on in-flight `drafting` sessions. Friction on a runaway
 * client / abusive wallet without limiting legitimate operators (10 is
 * generous — most users mint one token at a time). */
const MAX_DRAFTING_PER_USER = 10;

/** Create a new draft session for the authenticated user. Throws if
 * the user already has `MAX_DRAFTING_PER_USER` open drafts — caller
 * should surface as a 429 to the client. */
export async function createSession(cashaddr: string): Promise<MintSession> {
	const countRes = await query<{ n: string }>(
		`SELECT COUNT(*)::bigint AS n
		   FROM user_mint_sessions
		  WHERE cashaddr = $1 AND state = 'drafting'`,
		[cashaddr]
	);
	const drafting = Number(countRes.rows[0]?.n ?? 0);
	if (drafting >= MAX_DRAFTING_PER_USER) {
		const err = new Error(
			`Too many open drafts (${drafting}/${MAX_DRAFTING_PER_USER}). Abandon or complete an existing draft before starting a new one.`
		);
		(err as Error & { tooManyDrafts: true }).tooManyDrafts = true;
		throw err;
	}
	const res = await query<DbRow>(
		`INSERT INTO user_mint_sessions (cashaddr, state)
         VALUES ($1, 'drafting')
         RETURNING *`,
		[cashaddr]
	);
	const row = res.rows[0];
	if (!row) throw new Error('Failed to create mint session');
	return rowToSession(row);
}

/** List sessions for the authenticated user, newest first. */
export async function listSessions(cashaddr: string): Promise<MintSession[]> {
	const res = await query<DbRow>(
		`SELECT * FROM user_mint_sessions
          WHERE cashaddr = $1
          ORDER BY updated_at DESC
          LIMIT 50`,
		[cashaddr]
	);
	return res.rows.map(rowToSession);
}

/** Load one session, scoped to the authenticated user. Returns null if
 * not found OR not owned by the caller — same outcome from the API
 * caller's perspective so we don't leak existence. */
export async function getSession(cashaddr: string, id: string): Promise<MintSession | null> {
	const res = await query<DbRow>(
		`SELECT * FROM user_mint_sessions
          WHERE id = $1 AND cashaddr = $2`,
		[id, cashaddr]
	);
	const row = res.rows[0];
	return row ? rowToSession(row) : null;
}

export interface MintSessionPatch {
	state?: MintState;
	tokenType?: MintTokenType | null;
	ticker?: string | null;
	name?: string | null;
	description?: string | null;
	decimals?: number | null;
	supply?: string | null;
	nftCapability?: NftCapability | null;
	nftCommitmentHex?: string | null;
	iconStagingPath?: string | null;
	genesisTxidHex?: string | null;
	categoryHex?: string | null;
}

/**
 * Patch any subset of session fields. Caller-scoped to `cashaddr` so a
 * malicious session ID guess can't write into someone else's draft.
 *
 * State-machine guard: forward-only. The DB rejects backwards moves
 * via the `current_state IN (...)` predicate.
 */
export async function updateSession(
	cashaddr: string,
	id: string,
	patch: MintSessionPatch
): Promise<MintSession | null> {
	const sets: string[] = ['updated_at = now()'];
	const values: unknown[] = [];
	const push = (column: string, value: unknown) => {
		values.push(value);
		sets.push(`${column} = $${values.length}`);
	};

	if (patch.state !== undefined) push('state', patch.state);
	if (patch.tokenType !== undefined) push('token_type', patch.tokenType);
	if (patch.ticker !== undefined) push('ticker', patch.ticker);
	if (patch.name !== undefined) push('name', patch.name);
	if (patch.description !== undefined) push('description', patch.description);
	if (patch.decimals !== undefined) push('decimals', patch.decimals);
	if (patch.supply !== undefined) push('supply', patch.supply);
	if (patch.nftCapability !== undefined) push('nft_capability', patch.nftCapability);
	if (patch.nftCommitmentHex !== undefined) {
		push('nft_commitment', patch.nftCommitmentHex ? bytesFromHex(patch.nftCommitmentHex) : null);
	}
	if (patch.iconStagingPath !== undefined) push('icon_staging_path', patch.iconStagingPath);
	if (patch.genesisTxidHex !== undefined) {
		push('genesis_txid', patch.genesisTxidHex ? bytesFromHex(patch.genesisTxidHex) : null);
	}
	if (patch.categoryHex !== undefined) {
		push('category', patch.categoryHex ? bytesFromHex(patch.categoryHex) : null);
	}

	values.push(id, cashaddr);
	const idIdx = values.length - 1;
	const cashaddrIdx = values.length;

	// Forward-only state guard: only allow moving to a state that's
	// "later" than the current one. The state machine is a DAG; this
	// SQL fragment captures the allowed predecessors of each state.
	//
	// `broadcast` is intentionally NOT in its own predecessor list: once
	// a session is broadcast, the genesis_txid + category are recorded
	// and must not be overwritten by a duplicated PATCH (e.g. retry
	// races, double-tab). The wizard only PATCHes broadcast-state on a
	// successful broadcast call, but the session row itself is the
	// system of record — we'd rather reject the second PATCH than let
	// it silently overwrite an authoritative txid.
	let stateGuard = '';
	if (patch.state) {
		const allowed: Record<MintState, MintState[]> = {
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

	// Append-only guard for genesis_txid / category. Once recorded these
	// are immutable — they're derived from the chain. A retried PATCH
	// that tries to write a different value to a non-NULL column must
	// fail rather than silently corrupt the row.
	const immutableGuards: string[] = [];
	if (patch.genesisTxidHex !== undefined && patch.genesisTxidHex !== null) {
		immutableGuards.push('genesis_txid IS NULL');
	}
	if (patch.categoryHex !== undefined && patch.categoryHex !== null) {
		immutableGuards.push('category IS NULL');
	}
	const immutableGuard = immutableGuards.length > 0 ? `AND ${immutableGuards.join(' AND ')}` : '';

	const sql = `UPDATE user_mint_sessions
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
 * updateSession is usually the right call. */
export async function deleteSession(cashaddr: string, id: string): Promise<boolean> {
	const res = await query<{ id: string }>(
		`DELETE FROM user_mint_sessions
          WHERE id = $1 AND cashaddr = $2
          RETURNING id`,
		[id, cashaddr]
	);
	return res.rows.length > 0;
}
