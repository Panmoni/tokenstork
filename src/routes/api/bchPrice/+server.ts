// GET /api/bchPrice — BCH/USD aggregator. CryptoCompare primary, CoinGecko fallback.
// Preserves the CORS allowlist from pages/api/bchPrice.ts.
//
// Caching: this endpoint hits two rate-limited external aggregators on
// every call. Without a cache, a transient upstream blip (CoinGecko free
// tier is aggressively rate-limited; CryptoCompare can exceed our 3s
// timeout) makes the handler return a 500 → callers like
// `fetchBchPrice()` fall back to `0`, which silently nulls every point on
// the token-detail price chart and renders a misleading "Not enough
// history" empty-state. We cache the last good price in-process (the app
// runs as a single long-lived `node build` process — see
// tokenstork.service) with a 60s fresh window and stale-while-revalidate:
// once we've fetched a price even once, an upstream outage keeps serving
// the last good value instead of a zero.

import { dev } from '$app/environment';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { timedFetch } from '$lib/server/fetch';
import type { RequestHandler } from './$types';

// Production origins — every cookie-bearing endpoint that wants CORS
// access lives at one of these. localhost entries are dev-only so a
// local browser tab pointed at a public deployment can't proxy this
// endpoint via a localhost-shaped Origin header.
const PROD_ORIGINS = ['https://tokenstork.com', 'https://drop.tokenstork.com'];
const DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:5173'];
const ALLOWED_ORIGINS = new Set(dev ? [...PROD_ORIGINS, ...DEV_ORIGINS] : PROD_ORIGINS);

// Serve cached value without re-hitting upstream for this long.
const CACHE_TTL_MS = 60_000;

// Last successful price. Module-level (single-process server) so it's
// shared across SSR loads and direct client calls. `null` until the
// first successful upstream fetch.
let cached: { usd: number; at: number } | null = null;
// Coalesces concurrent refreshes so a burst of cold requests doesn't
// fan out into N upstream calls against the rate-limited aggregators.
let inflight: Promise<number | null> | null = null;

function corsHeaders(origin: string | null): Record<string, string> {
	if (origin && ALLOWED_ORIGINS.has(origin)) {
		return {
			'access-control-allow-origin': origin,
			'access-control-allow-methods': 'GET',
			vary: 'Origin'
		};
	}
	return {};
}

// One upstream cycle: CryptoCompare primary, CoinGecko fallback. Returns
// a positive USD price, or `null` on any failure (caller decides whether
// to serve stale or surface a 500).
async function fetchUpstreamUSD(): Promise<number | null> {
	try {
		const apiKey = env.CRYPTO_COMPARE_KEY;
		const ccResponse = await timedFetch(
			'https://min-api.cryptocompare.com/data/price?fsym=BCH&tsyms=USD',
			{ method: 'GET', headers: apiKey ? { Apikey: apiKey } : {}, timeoutMs: 3000 }
		);
		const ccData = await ccResponse.json();
		if (ccResponse.ok && typeof ccData.USD === 'number' && ccData.USD > 0) {
			return ccData.USD;
		}

		const cgResponse = await timedFetch(
			'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd',
			{ timeoutMs: 3000 }
		);
		const cgData = await cgResponse.json();
		const cgUsd = cgData?.['bitcoin-cash']?.usd;
		if (cgResponse.ok && typeof cgUsd === 'number' && cgUsd > 0) {
			return cgUsd;
		}
	} catch (err) {
		console.error('[api/bchPrice] upstream fetch error:', err);
	}
	return null;
}

// Coalesced refresh: at most one upstream cycle in flight at a time.
// Updates `cached` on success; leaves the prior value untouched on
// failure so stale-while-revalidate keeps serving it.
function refresh(): Promise<number | null> {
	if (!inflight) {
		inflight = fetchUpstreamUSD()
			.then((usd) => {
				if (usd != null) cached = { usd, at: Date.now() };
				return usd;
			})
			.finally(() => {
				inflight = null;
			});
	}
	return inflight;
}

export const OPTIONS: RequestHandler = async ({ request }) => {
	const origin = request.headers.get('origin');
	return new Response(null, { status: 200, headers: corsHeaders(origin) });
};

export const GET: RequestHandler = async ({ request }) => {
	const origin = request.headers.get('origin');
	const headers = corsHeaders(origin);

	const now = Date.now();

	// Fresh cache hit — return immediately, no upstream call.
	if (cached && now - cached.at < CACHE_TTL_MS) {
		return json({ USD: cached.usd }, { headers });
	}

	// Stale cache present — serve it instantly and revalidate in the
	// background. Keeps the price-dependent UI working even while upstream
	// is slow or rate-limiting, and never blocks the caller's timeout.
	if (cached) {
		void refresh();
		return json({ USD: cached.usd }, { headers });
	}

	// Cold start — no cached value yet, so we must wait for upstream.
	const usd = await refresh();
	if (usd != null) {
		return json({ USD: usd }, { headers });
	}

	// No cache to fall back on and upstream failed — a genuine total
	// outage. Log it (the non-ok/rate-limit paths inside fetchUpstreamUSD
	// don't throw, so this is the only signal for that case).
	console.error('[api/bchPrice] cold-start price fetch failed, no cache to serve');
	return json(
		{ error: 'Error(s) fetching price in internal API' },
		{ status: 500, headers }
	);
};
