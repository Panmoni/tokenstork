// Server-side BlockBook pacing + cross-process advisory-lock semaphore.
//
// Two layers of protection:
// 1. Min-gap pacing (in-process) — mirrors the Rust BlockbookClient::pace().
//    Smooths bursts from concurrent page loads so a few detail-page visits
//    don't stampede BlockBook at the same instant.
// 2. Postgres advisory lock 987654321 (cross-process) — serialises BlockBook
//    access across ALL processes: Rust workers, SvelteKit, and ad-hoc scripts.
//    Uses pg_try_advisory_lock with 100ms spin-wait on a dedicated pool client;
//    a crash closes the socket → Postgres auto-releases. Same key as the Rust
//    pg::acquire_blockbook_slot().
//
// Default 200ms gap = 5 req/s, matching the lowered BLOCKBOOK_MAX_RPS default.
// Override with BLOCKBOOK_PACER_GAP_MS env var.

import { getPool } from './db';
import { timedFetch, type TimedFetchInit } from './fetch';

// ── Min-gap pacing (in-process) ──

let lastRequest = Date.now() - 2000; // start with headroom

function gapMs(): number {
	const raw = process.env.BLOCKBOOK_PACER_GAP_MS;
	if (!raw) return 200;
	const n = parseInt(raw, 10);
	return Number.isFinite(n) && n > 0 ? n : 200;
}

async function paceBlockBook(): Promise<void> {
	const minGapMs = gapMs();
	const now = Date.now();
	const target = lastRequest + minGapMs;
	lastRequest = Math.max(now, target);
	const wait = target - now;
	if (wait <= 0) return;
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, wait);
	return promise;
}

// ── Advisory-lock slot (cross-process) ──

const SLOT_KEY = 987654321;

/** Acquire the global BlockBook advisory lock. Returns a thunk that MUST be
 *  called (and awaited) to release. Spin-waits with 100ms sleeps; the lock
 *  is held on a dedicated pool client so a process crash auto-releases. */
async function acquireBlockbookSlot(): Promise<() => Promise<void>> {
	const pool = getPool();
	const deadline = Date.now() + 30_000; // match BlockBook request timeout
	// eslint-disable-next-line no-constant-condition
	while (true) {
		if (Date.now() > deadline) {
			throw new Error('BlockBook advisory lock acquisition timed out after 30s');
		}
		const client = await pool.connect();
		const res = await client.query('SELECT pg_try_advisory_lock($1) AS got', [SLOT_KEY]);
		if (res.rows[0].got) {
			return async () => {
				try {
					await client.query('SELECT pg_advisory_unlock($1)', [SLOT_KEY]);
				} catch (err) {
					console.warn('BlockBook advisory lock release failed:', err);
				}
				client.release();
			};
		}
		client.release();
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, 100);
		await promise;
	}
}

// ── Combined: pace → acquire slot → fetch → release ──

/** Fetch from BlockBook with both in-process pacing and cross-process slot
 *  serialisation. Use this for every BlockBook HTTP call in the SvelteKit
 *  server instead of raw `timedFetch`. */
export async function pacedBlockbookFetch(
	url: string,
	init: TimedFetchInit = {}
): Promise<Response> {
	await paceBlockBook();
	const release = await acquireBlockbookSlot();
	try {
		return await timedFetch(url, init);
	} finally {
		await release();
	}
}
