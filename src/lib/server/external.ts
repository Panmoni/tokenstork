// Server-only external fetchers: BCMR (Paytaca) + Cauldron price/TVL.
// Called from per-token page loaders. No Chaingraph — supply/holder/NFT
// data now comes from Postgres via enrich workers.

import { satoshisToBCH } from '$lib/format';

const BCMR_ENDPOINT = 'https://bcmr.paytaca.com/api/tokens/';
const CAULDRON_INDEXER = 'https://indexer.cauldron.quest/cauldron';

export interface BcmrMetadata {
	name: string | null;
	symbol: string | null;
	decimals: number;
	description: string | null;
	iconUri: string | null;
}

export async function fetchBcmr(category: string): Promise<BcmrMetadata | null> {
	try {
		const res = await fetch(BCMR_ENDPOINT + category);
		if (!res.ok) return null;
		const data = await res.json();
		return {
			name: data?.name ?? null,
			symbol: data?.token?.symbol ?? null,
			decimals: validateDecimals(data?.token?.decimals),
			description: data?.description ?? null,
			iconUri: data?.uris?.icon ?? null
		};
	} catch (err) {
		console.error('[external] BCMR fetch failed:', err);
		return null;
	}
}

export interface CauldronStats {
	priceUSD: number;
	tvlUSD: number;
}

export async function fetchCauldron(
	category: string,
	decimals: number,
	bchPriceUSD: number
): Promise<CauldronStats> {
	let priceUSD = 0;
	let tvlUSD = 0;
	try {
		const priceRes = await fetch(`${CAULDRON_INDEXER}/price/${category}/current`);
		if (priceRes.ok) {
			const priceData = await priceRes.json();
			if (priceData?.price) {
				priceUSD =
					satoshisToBCH(priceData.price * Math.pow(10, decimals)) * bchPriceUSD;
			}
		}
	} catch (err) {
		console.error('[external] Cauldron price fetch failed:', err);
	}
	try {
		const tvlRes = await fetch(`${CAULDRON_INDEXER}/valuelocked/${category}`);
		if (tvlRes.ok) {
			const tvlData = await tvlRes.json();
			if (tvlData?.satoshis) {
				// Double-sided pool — multiply by 2 to reflect the combined value,
				// matching the calculation in app/utils/getTokenData.ts.
				tvlUSD = satoshisToBCH(tvlData.satoshis) * bchPriceUSD * 2;
			}
		}
	} catch (err) {
		console.error('[external] Cauldron TVL fetch failed:', err);
	}
	return { priceUSD, tvlUSD };
}

function validateDecimals(decimals: unknown): number {
	if (decimals === undefined || decimals === null) return 0;
	const n = Number(decimals);
	if (!Number.isFinite(n) || n < 0 || n > 8) return 0;
	return Math.floor(n);
}
