// Server-only wrapper around `fetch` that applies an AbortSignal timeout.
// Bare fetch has no timeout — a slow upstream (BCMR, Cauldron, CryptoCompare)
// blocks a Node worker until the peer eventually gives up (minutes). Under
// concurrency that starves the event loop.

export interface TimedFetchInit extends RequestInit {
	timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

export async function timedFetch(
	url: string | URL,
	init: TimedFetchInit = {}
): Promise<Response> {
	const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...rest } = init;
	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	// If the caller passed its own signal, combine both.
	const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
	return fetch(url, { ...rest, signal: combined });
}
