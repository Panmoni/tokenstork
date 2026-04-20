// GET /api/bchPrice — BCH/USD aggregator. CryptoCompare primary, CoinGecko fallback.
// Preserves the CORS allowlist from pages/api/bchPrice.ts.

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const ALLOWED_ORIGINS = new Set([
	'https://tokenstork.com',
	'http://localhost:3000',
	'http://localhost:5173',
	'https://drop.tokenstork.com'
]);

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

export const OPTIONS: RequestHandler = async ({ request }) => {
	const origin = request.headers.get('origin');
	return new Response(null, { status: 200, headers: corsHeaders(origin) });
};

export const GET: RequestHandler = async ({ request }) => {
	const origin = request.headers.get('origin');
	const headers = corsHeaders(origin);
	const errors: string[] = [];

	try {
		const apiKey = env.CRYPTO_COMPARE_KEY;
		if (!apiKey) {
			errors.push('cryptocompare: CRYPTO_COMPARE_KEY is not set');
		}

		const ccResponse = await fetch(
			'https://min-api.cryptocompare.com/data/price?fsym=BCH&tsyms=USD',
			{ method: 'GET', headers: apiKey ? { Apikey: apiKey } : {} }
		);
		const ccData = await ccResponse.json();
		if (ccResponse.ok && ccData.USD) {
			return json({ USD: ccData.USD }, { headers });
		}
		errors.push(`Failed to fetch price from cryptocompare: ${ccResponse.status}`);

		const cgResponse = await fetch(
			'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd'
		);
		const cgData = await cgResponse.json();
		if (cgResponse.ok && cgData['bitcoin-cash']?.usd) {
			return json({ USD: cgData['bitcoin-cash'].usd }, { headers });
		}
		errors.push(`Failed to fetch price from coingecko: ${cgResponse.status}`);
	} catch (err) {
		errors.push(`Exception in internal API: ${err}`);
	}

	if (!errors.length) errors.push('Unknown error');
	errors.unshift('Error(s) fetching price in internal API');
	return json({ error: errors.join('; ') }, { status: 500, headers });
};
