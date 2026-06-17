// Shared server-side BCH/USD price fetcher. Calls the internal
// /api/bchPrice endpoint with a 4s timeout, returns the USD price
// or 0 on any failure (the page degrades gracefully without USD).
//
// Used by multiple page loaders that need BCH price for market-cap
// / TVL USD conversion without waiting for a client-side fetch.

export async function fetchBchPrice(
	fetch: typeof globalThis.fetch
): Promise<number> {
	try {
		const res = await fetch('/api/bchPrice', {
			signal: AbortSignal.timeout(4000)
		});
		const data = await res.json();
		return typeof data?.USD === 'number' ? data.USD : 0;
	} catch {
		return 0;
	}
}
