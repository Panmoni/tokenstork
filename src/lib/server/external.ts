// Server-only external fetchers: BCMR (Paytaca) + Cauldron price/TVL.
// Called from per-token page loaders. No Chaingraph — supply/holder/NFT
// data now comes from Postgres via enrich workers.

import { satoshisToBCH } from '$lib/format';
import { timedFetch } from '$lib/server/fetch';

const BCMR_ENDPOINT = 'https://bcmr.paytaca.com/api/tokens/';
const CAULDRON_INDEXER = 'https://indexer.cauldron.quest/cauldron';
const CATEGORY_REGEX = /^[0-9a-f]{64}$/;

export interface BcmrMetadata {
	// Core fields used by the detail-page title/header/price-format fallback.
	// These are the hot-path values; every renderer touches them.
	name: string | null;
	symbol: string | null;
	decimals: number;
	description: string | null;
	iconUri: string | null;
	// Extended fields — surfaced as a structured dump under the main content
	// on the detail page. Pulled directly from the BCMR JSON per
	// https://cashtokens.org/docs/bcmr/chip/. Any of these can be null/empty
	// for tokens that don't publish rich metadata.
	status: string | null;                         // 'active' | 'inactive' | 'burned' | ...
	splitId: string | null;                        // hex — category this was split from
	uris: Record<string, string> | null;           // full link dictionary (icon, web, twitter, …)
	tags: string[] | null;                         // free-form BCMR tags
	extensions: Record<string, unknown> | null;    // arbitrary namespaced bag
	nftTypes: Record<string, unknown> | null;      // token.nfts.types — per-NFT-commitment definitions
	nftsDescription: string | null;                // token.nfts.description
}

function assertValidCategory(category: string): void {
	if (!CATEGORY_REGEX.test(category)) {
		throw new Error('external: invalid category (expected 64 lowercase hex chars)');
	}
}

// A shallow object guard. BCMR JSON shapes can be null / string / array at
// any of the nested keys; we want to preserve only plain objects so the UI
// can iterate them safely.
function pickObject(v: unknown): Record<string, unknown> | null {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
	return v as Record<string, unknown>;
}

function pickStringDict(v: unknown): Record<string, string> | null {
	const obj = pickObject(v);
	if (!obj) return null;
	const out: Record<string, string> = {};
	for (const [k, val] of Object.entries(obj)) {
		if (typeof val === 'string' && val.trim() !== '') out[k] = val;
	}
	return Object.keys(out).length ? out : null;
}

function pickStringArray(v: unknown): string[] | null {
	if (!Array.isArray(v)) return null;
	const out = v.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
	return out.length ? out : null;
}

export async function fetchBcmr(category: string): Promise<BcmrMetadata | null> {
	assertValidCategory(category);
	try {
		const res = await timedFetch(BCMR_ENDPOINT + category, { timeoutMs: 5000 });
		if (!res.ok) return null;
		const data = await res.json();
		return {
			name: data?.name ?? null,
			symbol: data?.token?.symbol ?? null,
			decimals: validateDecimals(data?.token?.decimals),
			description: data?.description ?? null,
			iconUri: data?.uris?.icon ?? null,
			status: typeof data?.status === 'string' ? data.status : null,
			splitId: typeof data?.splitId === 'string' ? data.splitId : null,
			uris: pickStringDict(data?.uris),
			tags: pickStringArray(data?.tags),
			extensions: pickObject(data?.extensions),
			nftTypes: pickObject(data?.token?.nfts?.types),
			nftsDescription:
				typeof data?.token?.nfts?.description === 'string'
					? data.token.nfts.description
					: null
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
	assertValidCategory(category);
	let priceUSD = 0;
	let tvlUSD = 0;
	try {
		const priceRes = await timedFetch(
			`${CAULDRON_INDEXER}/price/${category}/current`,
			{ timeoutMs: 5000 }
		);
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
		const tvlRes = await timedFetch(
			`${CAULDRON_INDEXER}/valuelocked/${category}`,
			{ timeoutMs: 5000 }
		);
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
