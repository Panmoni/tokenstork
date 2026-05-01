// Lightweight in-memory IP rate limiter. Server-only, single-process by
// design — we run one SvelteKit Node process per host, so a Map keyed by
// IP is sufficient and beats a Postgres-backed counter on every request.
//
// Behavior: fixed-size sliding window. Each call to `consume(key)` checks
// whether the caller has used fewer than `maxPerWindow` slots in the
// last `windowMs`. If yes, increments the count and returns
// `{ allowed: true }`. If no, returns `{ allowed: false, retryAfterMs }`.
//
// Process restart resets every counter — acceptable for our threat
// model (anti-bot-spam on /api/auth/challenge); intentional flooding
// across restarts is not the attack we're defending against. Cluster
// mode would need a shared store (Redis), which we don't have.
//
// Memory footprint is bounded via a periodic sweep of stale entries:
// when `consume` runs and there are >2000 entries in the map, sweep
// out anything whose oldest event has aged past `2 * windowMs`. At our
// scale this should never trigger.

interface Bucket {
	/** Unix-ms timestamps of recent successful consumes, oldest first. */
	hits: number[];
}

interface Limiter {
	consume(key: string): { allowed: boolean; retryAfterMs?: number };
}

const MAX_BUCKETS_BEFORE_SWEEP = 2000;

export function createRateLimiter(opts: {
	maxPerWindow: number;
	windowMs: number;
}): Limiter {
	const { maxPerWindow, windowMs } = opts;
	const buckets = new Map<string, Bucket>();

	function maybeSweep(now: number): void {
		if (buckets.size <= MAX_BUCKETS_BEFORE_SWEEP) return;
		const cutoff = now - 2 * windowMs;
		for (const [key, b] of buckets) {
			if (b.hits.length === 0 || b.hits[b.hits.length - 1] < cutoff) {
				buckets.delete(key);
			}
		}
	}

	return {
		consume(key: string) {
			const now = Date.now();
			maybeSweep(now);

			const cutoff = now - windowMs;
			let bucket = buckets.get(key);
			if (!bucket) {
				bucket = { hits: [] };
				buckets.set(key, bucket);
			}
			// Drop hits that have aged out of the window.
			while (bucket.hits.length > 0 && bucket.hits[0] < cutoff) {
				bucket.hits.shift();
			}
			if (bucket.hits.length >= maxPerWindow) {
				const oldestInWindow = bucket.hits[0];
				return {
					allowed: false,
					retryAfterMs: Math.max(0, oldestInWindow + windowMs - now)
				};
			}
			bucket.hits.push(now);
			return { allowed: true };
		}
	};
}

// /api/auth/challenge limiter: 10 challenges per minute per IP.
// Generous enough that a real human can retry several times after typos
// without hitting the wall; tight enough that a bot script can't fill
// the auth_challenges table with millions of unused rows.
export const challengeRateLimiter = createRateLimiter({
	maxPerWindow: 10,
	windowMs: 60_000
});

// /api/tokens?format=csv limiter: 30 CSV requests per minute per IP.
// JSON GETs already have CDN caching + a 1000-row cap, but CSV is much
// fatter per row + much more attractive to scrapers. Tighter ceiling
// keeps a hostile scraper from chewing through bandwidth without
// affecting normal "click export, save file" usage.
export const csvExportRateLimiter = createRateLimiter({
	maxPerWindow: 30,
	windowMs: 60_000
});
