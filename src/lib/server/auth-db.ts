// Postgres persistence for the wallet-login flow. Server-only.
//
// Three tables come from db/schema.sql:
//   users             — one row per logged-in cashaddr
//   auth_challenges   — short-lived single-use nonces (5 min TTL)
//   sessions          — opaque random tokens (30 day TTL)
//
// All queries excluded from the directory's NOT_MODERATED_CLAUSE — auth
// data has nothing to do with token moderation.

import { query } from './db';
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
 *  here. */
export async function persistChallenge(cashaddr: string): Promise<ChallengeRecord> {
	const c = newChallenge(cashaddr);
	await query(
		`INSERT INTO auth_challenges (nonce, cashaddr, message, expires_at)
		 VALUES ($1, $2, $3, $4)`,
		[c.nonce, c.cashaddr, c.message, c.expiresAt]
	);
	return c;
}

/** Look up a challenge by nonce for verification. Filters out expired and
 *  already-consumed rows so caller doesn't need to. */
export async function findOpenChallenge(
	nonce: string
): Promise<ChallengeRecord | null> {
	const res = await query<{
		nonce: string;
		cashaddr: string;
		message: string;
		expires_at: Date;
	}>(
		`SELECT nonce, cashaddr, message, expires_at
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
		expiresAt: row.expires_at
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

/** Look up a session by token. Returns null when expired or not found.
 *  Touches `last_used_at` on hit so a stale-session sweep can prune
 *  inactive sessions independently of expiry. */
export async function findActiveSession(
	id: string
): Promise<{ cashaddr: string; expiresAt: Date } | null> {
	const res = await query<{ cashaddr: string; expires_at: Date }>(
		`UPDATE sessions
		    SET last_used_at = now()
		  WHERE id = $1 AND expires_at > now()
		  RETURNING cashaddr, expires_at`,
		[id]
	);
	const row = res.rows[0];
	if (!row) return null;
	return { cashaddr: row.cashaddr, expiresAt: row.expires_at };
}

/** Logout — invalidate the named session. Idempotent. */
export async function deleteSession(id: string): Promise<void> {
	await query(`DELETE FROM sessions WHERE id = $1`, [id]);
}
