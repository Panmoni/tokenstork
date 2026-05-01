// Postgres persistence for the wallet-login flow. Server-only.
//
// Three tables come from db/schema.sql:
//   users             — one row per logged-in cashaddr
//   auth_challenges   — short-lived single-use nonces (5 min TTL)
//   sessions          — opaque random tokens (30 day TTL)
//
// All queries excluded from the directory's NOT_MODERATED_CLAUSE — auth
// data has nothing to do with token moderation.

import { query, withTransaction } from './db';
import {
	newChallenge,
	newSessionId,
	sessionExpiry,
	type ChallengeRecord,
	type SessionRecord
} from './auth';

// ---------------------------------------------------------------------------
// Challenge issuance + consumption
// ---------------------------------------------------------------------------

/** Issue a challenge for the given cashaddr and persist it. The caller
 *  passes the canonical (already-normalized) cashaddr; we don't re-validate
 *  here. The issuing IP is recorded so verify can require the same source
 *  address — defense against a phished signature being submitted from
 *  the attacker's network. */
export async function persistChallenge(
	cashaddr: string,
	issuedIp: string | null
): Promise<ChallengeRecord> {
	const c = newChallenge(cashaddr);
	await query(
		`INSERT INTO auth_challenges (nonce, cashaddr, message, issued_ip, expires_at)
		 VALUES ($1, $2, $3, $4, $5)`,
		[c.nonce, c.cashaddr, c.message, issuedIp, c.expiresAt]
	);
	return c;
}

export interface OpenChallenge extends ChallengeRecord {
	issuedIp: string | null;
}

/** Look up a challenge by nonce for verification. Filters out expired and
 *  already-consumed rows so caller doesn't need to. Surfaces `issuedIp`
 *  so the caller can refuse a verify from a different network. */
export async function findOpenChallenge(
	nonce: string
): Promise<OpenChallenge | null> {
	const res = await query<{
		nonce: string;
		cashaddr: string;
		message: string;
		expires_at: Date;
		issued_ip: string | null;
	}>(
		`SELECT nonce, cashaddr, message, expires_at, issued_ip
		   FROM auth_challenges
		  WHERE nonce = $1
		    AND consumed_at IS NULL
		    AND expires_at > now()`,
		[nonce]
	);
	const row = res.rows[0];
	if (!row) return null;
	return {
		nonce: row.nonce,
		cashaddr: row.cashaddr,
		message: row.message,
		expiresAt: row.expires_at,
		issuedIp: row.issued_ip
	};
}

/** Mark a challenge as consumed atomically. Returns true if this call won
 *  the race; subsequent attempts on the same nonce return false. */
export async function consumeChallenge(nonce: string): Promise<boolean> {
	const res = await query(
		`UPDATE auth_challenges
		    SET consumed_at = now()
		  WHERE nonce = $1
		    AND consumed_at IS NULL
		    AND expires_at > now()`,
		[nonce]
	);
	return res.rowCount === 1;
}

// ---------------------------------------------------------------------------
// User upsert + session issuance
// ---------------------------------------------------------------------------

/** Insert-or-touch a users row. Always called inside the verify flow,
 *  right after a signature is accepted. */
export async function upsertUser(cashaddr: string): Promise<void> {
	await query(
		`INSERT INTO users (cashaddr) VALUES ($1)
		 ON CONFLICT (cashaddr) DO UPDATE
		   SET last_seen_at = now()`,
		[cashaddr]
	);
}

export async function createSession(args: {
	cashaddr: string;
	userAgent: string | null;
	ip: string | null;
}): Promise<SessionRecord> {
	const id = newSessionId();
	const expiresAt = sessionExpiry();
	await query(
		`INSERT INTO sessions (id, cashaddr, expires_at, user_agent, ip)
		 VALUES ($1, $2, $3, $4, $5)`,
		[id, args.cashaddr, expiresAt, args.userAgent, args.ip]
	);
	return {
		id,
		cashaddr: args.cashaddr,
		createdAt: new Date(),
		expiresAt
	};
}

/** Atomic session rotation: invalidate every prior session for the
 *  cashaddr, then issue a fresh one. Wrapped in a transaction with a
 *  per-cashaddr advisory lock so two concurrent /verify calls for the
 *  same wallet can't race into a state where each call's cleanup
 *  deletes the OTHER call's just-issued session.
 *
 *  Without the lock the failure mode is:
 *    A: createSession_A → DELETE WHERE cashaddr=X AND id<>A
 *    B: createSession_B → DELETE WHERE cashaddr=X AND id<>B
 *    A's DELETE fires: kills B
 *    B's DELETE fires: kills A
 *    → both clients hold dead cookies.
 *
 *  With the lock the second tx waits for the first to commit, observes
 *  the freshly-issued session_A, and either deletes it (if B is the
 *  newer login — fine, that's expected rotation) or A's session
 *  survives because B's cleanup runs strictly after A's INSERT. */
export async function rotateSession(args: {
	cashaddr: string;
	userAgent: string | null;
	ip: string | null;
}): Promise<SessionRecord> {
	return withTransaction(async (client) => {
		await client.query(
			`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
			[args.cashaddr]
		);
		const id = newSessionId();
		const expiresAt = sessionExpiry();
		await client.query(
			`INSERT INTO sessions (id, cashaddr, expires_at, user_agent, ip)
			 VALUES ($1, $2, $3, $4, $5)`,
			[id, args.cashaddr, expiresAt, args.userAgent, args.ip]
		);
		// Invalidate every prior session for this cashaddr inside the
		// same transaction. If a concurrent rotation is in flight, it's
		// blocked on the advisory lock until we COMMIT.
		await client.query(
			`DELETE FROM sessions WHERE cashaddr = $1 AND id <> $2`,
			[args.cashaddr, id]
		);
		return {
			id,
			cashaddr: args.cashaddr,
			createdAt: new Date(),
			expiresAt
		};
	});
}

/** Look up a session by token. Returns null when expired or not found.
 *
 *  Lazy `last_used_at` update: the SELECT path does not write — every
 *  authenticated request previously took a row lock on `sessions` via
 *  `UPDATE … RETURNING`, which made any cookie-replay flood a trivial
 *  DoS amplifier. We now only `UPDATE last_used_at` when the recorded
 *  value is more than `LAST_USED_REFRESH_MS` stale, so the hot path is
 *  a single index lookup. The stale-session sweep retains its meaning:
 *  `last_used_at` still moves forward periodically, just not per
 *  request.
 *
 *  Refresh dedup: a single in-memory Set tracks session-ids that
 *  currently have a refresh in flight. Without it, a flood of stale-
 *  cookie requests for the SAME session would each kick off an
 *  independent UPDATE, stacking pool slots faster than they drain
 *  under a slow DB. The Set keeps the per-session refresh count at 1.
 *  Cross-session concurrency is naturally bounded by how many distinct
 *  stale sessions are in flight at once. */
const LAST_USED_REFRESH_MS = 5 * 60 * 1000; // 5 min

const inFlightRefreshes = new Set<string>();

export async function findActiveSession(
	id: string
): Promise<{ cashaddr: string; expiresAt: Date } | null> {
	const res = await query<{ cashaddr: string; expires_at: Date; last_used_at: Date }>(
		`SELECT cashaddr, expires_at, last_used_at
		   FROM sessions
		  WHERE id = $1 AND expires_at > now()`,
		[id]
	);
	const row = res.rows[0];
	if (!row) return null;

	const ageMs = Date.now() - row.last_used_at.getTime();
	if (ageMs > LAST_USED_REFRESH_MS && !inFlightRefreshes.has(id)) {
		inFlightRefreshes.add(id);
		// Fire-and-forget refresh — don't block the request on the write.
		// A failure here is not a request failure. The dedup Set
		// guarantees only one refresh per session is in flight; the
		// finally clears the marker so the NEXT stale check (5+ min
		// later) can re-arm.
		query(`UPDATE sessions SET last_used_at = now() WHERE id = $1`, [id])
			.catch((err) => {
				console.error(
					`[auth-db] last_used refresh failed: code=${(err as { code?: string }).code ?? '?'} ${(err as Error).message}`
				);
			})
			.finally(() => {
				inFlightRefreshes.delete(id);
			});
	}

	return { cashaddr: row.cashaddr, expiresAt: row.expires_at };
}

/** Logout — invalidate the named session. Idempotent. */
export async function deleteSession(id: string): Promise<void> {
	await query(`DELETE FROM sessions WHERE id = $1`, [id]);
}

/** Invalidate every session for a given cashaddr — used at login time
 *  to revoke any prior session a stolen-cookie attacker may still hold,
 *  and as the backing call for a future "log out all devices" UI.
 *
 *  When `keepSessionId` is provided, that session is preserved (the
 *  caller has just issued it for the new login). */
export async function deleteSessionsForCashaddr(
	cashaddr: string,
	keepSessionId?: string
): Promise<number> {
	const res = keepSessionId
		? await query(
			`DELETE FROM sessions WHERE cashaddr = $1 AND id <> $2`,
			[cashaddr, keepSessionId]
		)
		: await query(`DELETE FROM sessions WHERE cashaddr = $1`, [cashaddr]);
	return res.rowCount ?? 0;
}
