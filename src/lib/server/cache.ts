// Process-local stale-while-revalidate memo for slow-changing GLOBAL
// aggregates (ecosystem counts, movers, vote leaderboards, the default
// directory page). One Pool, one process (adapter-node) — so a plain
// module-level Map is a perfectly good shared cache; no Redis needed.
//
// Why SWR and not a plain TTL: the goal is that a page render almost
// never blocks on these recomputations. Within `freshMs` a value is
// served as-is. Between `freshMs` and `freshMs + staleMs` the cached
// value is returned IMMEDIATELY while a single background refresh runs,
// so the slow query never sits on the request's critical path again
// after the first miss. Only a fully-expired (or never-computed) key
// blocks, and even then concurrent callers coalesce onto one promise so
// a traffic spike can't stampede the DB with N identical queries.
//
// IMPORTANT: only memo values that are identical for every requester.
// Per-user data (watchlist, votes-by-wallet) must NOT pass through here.
// Errors are never cached: `fn` rejecting leaves the store untouched so
// the next caller retries.

interface Entry<T> {
	value: T;
	/** ms timestamp: serve as fresh until now passes this. */
	soft: number;
	/** ms timestamp: serve stale (w/ bg refresh) until now passes this. */
	hard: number;
	/** true while a background revalidation is already in flight. */
	refreshing: boolean;
}

export interface CacheOptions {
	/** ms a value is served without any refresh. */
	freshMs: number;
	/** extra ms (after freshMs) the stale value is served while a
	 *  background refresh runs. 0 ⇒ hard expiry == freshMs. */
	staleMs?: number;
}

const store = new Map<string, Entry<unknown>>();
// Coalesces concurrent misses (and concurrent background refreshes) for a
// key onto a single in-flight computation.
const inflight = new Map<string, Promise<unknown>>();

/**
 * Memoize a global async computation under `key` with stale-while-
 * revalidate semantics. See file header for the contract.
 */
export function cached<T>(key: string, opts: CacheOptions, fn: () => Promise<T>): Promise<T> {
	const now = Date.now();
	const entry = store.get(key) as Entry<T> | undefined;

	if (entry) {
		if (now < entry.soft) {
			// Fresh — serve immediately, no refresh.
			return Promise.resolve(entry.value);
		}
		if (now < entry.hard) {
			// Stale but usable — serve now, revalidate in the background
			// (at most one refresh per key in flight at a time).
			if (!entry.refreshing) {
				entry.refreshing = true;
				void refresh(key, opts, fn).catch(() => {
					// Background refresh failed: keep serving the stale
					// value until hard-expiry, then a caller will retry.
					entry.refreshing = false;
				});
			}
			return Promise.resolve(entry.value);
		}
	}

	// Miss or fully expired — must block on a (coalesced) computation.
	return refresh(key, opts, fn);
}

function refresh<T>(key: string, opts: CacheOptions, fn: () => Promise<T>): Promise<T> {
	const existing = inflight.get(key) as Promise<T> | undefined;
	if (existing) return existing;

	const { freshMs, staleMs = 0 } = opts;
	const p = (async () => {
		try {
			const value = await fn();
			const at = Date.now();
			store.set(key, {
				value,
				soft: at + freshMs,
				hard: at + freshMs + staleMs,
				refreshing: false
			});
			return value;
		} finally {
			inflight.delete(key);
		}
	})();
	inflight.set(key, p);
	return p;
}

/** Operational / test hook: drop a single key, or the whole memo. */
export function invalidateCache(key?: string): void {
	if (key === undefined) {
		store.clear();
		inflight.clear();
	} else {
		store.delete(key);
		inflight.delete(key);
	}
}
