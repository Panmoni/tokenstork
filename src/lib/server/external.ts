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

// Defense-in-depth caps on issuer-supplied BCMR strings. Svelte already
// escapes everything we render, so the risk isn't XSS — it's
// serving-bandwidth abuse: a single 100 KB tag value would bloat every
// SSR response for that token. The caps below are generous for any
// realistic metadata and aggressive against issuer-injected bloat.
const MAX_TAG_LEN = 64;
const MAX_TAGS = 20;
const MAX_URI_KEY_LEN = 64;
const MAX_URI_VAL_LEN = 1024;
const MAX_URI_ENTRIES = 32;
const MAX_NAME_LEN = 200;
const MAX_SYMBOL_LEN = 32;
const MAX_DESC_LEN = 4000;
const MAX_NFT_DESC_LEN = 4000;
const MAX_STATUS_LEN = 32;

function clipString(v: unknown, max: number): string | null {
	if (typeof v !== 'string') return null;
	const t = v.trim();
	if (t === '') return null;
	return t.length > max ? t.slice(0, max) : t;
}

// A shallow object guard. BCMR JSON shapes can be null / string / array at
// any of the nested keys; we want to preserve only plain objects so the UI
// can iterate them safely. Strips dangerous prototype-pollution keys
// (`__proto__`, `constructor`, `prototype`) defensively even though the
// downstream consumers go through `Object.entries` (which is safe).
const POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function pickObject(v: unknown): Record<string, unknown> | null {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
	const out: Record<string, unknown> = Object.create(null);
	for (const [k, val] of Object.entries(v)) {
		if (POLLUTION_KEYS.has(k)) continue;
		out[k] = val;
	}
	return out;
}

function pickStringDict(v: unknown): Record<string, string> | null {
	const obj = pickObject(v);
	if (!obj) return null;
	const out: Record<string, string> = {};
	let count = 0;
	for (const [k, val] of Object.entries(obj)) {
		if (count >= MAX_URI_ENTRIES) break;
		if (k.length > MAX_URI_KEY_LEN) continue;
		const clipped = clipString(val, MAX_URI_VAL_LEN);
		if (clipped !== null) {
			out[k] = clipped;
			count++;
		}
	}
	return Object.keys(out).length ? out : null;
}

function pickStringArray(v: unknown): string[] | null {
	if (!Array.isArray(v)) return null;
	const out: string[] = [];
	for (const x of v) {
		if (out.length >= MAX_TAGS) break;
		const clipped = clipString(x, MAX_TAG_LEN);
		if (clipped !== null) out.push(clipped);
	}
	return out.length ? out : null;
}

export async function fetchBcmr(category: string): Promise<BcmrMetadata | null> {
	assertValidCategory(category);
	try {
		const res = await timedFetch(BCMR_ENDPOINT + category, { timeoutMs: 5000 });
		if (!res.ok) return null;
		const data = await res.json();
		const rawSplitId = typeof data?.splitId === 'string' ? data.splitId : null;
		// splitId is a 64-char hex category id by spec; refuse anything
		// else so downstream UI / lookups can trust the shape.
		const splitId =
			rawSplitId && /^[0-9a-fA-F]{64}$/.test(rawSplitId)
				? rawSplitId.toLowerCase()
				: null;
		return {
			name: clipString(data?.name, MAX_NAME_LEN),
			symbol: clipString(data?.token?.symbol, MAX_SYMBOL_LEN),
			decimals: validateDecimals(data?.token?.decimals),
			description: clipString(data?.description, MAX_DESC_LEN),
			iconUri: clipString(data?.uris?.icon, MAX_URI_VAL_LEN),
			status: clipString(data?.status, MAX_STATUS_LEN),
			splitId,
			uris: pickStringDict(data?.uris),
			tags: pickStringArray(data?.tags),
			extensions: pickObject(data?.extensions),
			nftTypes: pickObject(data?.token?.nfts?.types),
			nftsDescription: clipString(data?.token?.nfts?.description, MAX_NFT_DESC_LEN)
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

export interface CauldronGlobalStats {
	tvlSats: number;            // total satoshis locked across all pools
	tvlUSD: number;             // tvlSats * 2 / 1e8 * bchPriceUSD (double-sided pools)
	volume24hSats: number;
	volume24hUSD: number;
	volume7dSats: number;
	volume7dUSD: number;
	volume30dSats: number;
	volume30dUSD: number;
	pools: { active: number; ended: number; interactions: number };
	uniqueAddressesByMonth: Array<{ month: string; count: number }>;
}

async function fetchVolumeWindow(start: number, end: number): Promise<number> {
	try {
		const res = await timedFetch(
			`${CAULDRON_INDEXER}/volume?start=${start}&end=${end}`,
			{ timeoutMs: 5000 }
		);
		if (!res.ok) return 0;
		const data = await res.json();
		const v = Number(data?.total_volume_sats);
		return Number.isFinite(v) ? v : 0;
	} catch (err) {
		console.error('[external] Cauldron volume fetch failed:', err);
		return 0;
	}
}

export async function fetchCauldronGlobalStats(
	bchPriceUSD: number
): Promise<CauldronGlobalStats> {
	const now = Math.floor(Date.now() / 1000);
	const empty: CauldronGlobalStats = {
		tvlSats: 0,
		tvlUSD: 0,
		volume24hSats: 0,
		volume24hUSD: 0,
		volume7dSats: 0,
		volume7dUSD: 0,
		volume30dSats: 0,
		volume30dUSD: 0,
		pools: { active: 0, ended: 0, interactions: 0 },
		uniqueAddressesByMonth: []
	};

	const [tvlRes, vol24Res, vol7Res, vol30Res, countRes, uniqueRes] = await Promise.allSettled([
		timedFetch(`${CAULDRON_INDEXER}/valuelocked`, { timeoutMs: 5000 }),
		fetchVolumeWindow(now - 86_400, now),
		fetchVolumeWindow(now - 7 * 86_400, now),
		fetchVolumeWindow(now - 30 * 86_400, now),
		timedFetch(`${CAULDRON_INDEXER}/contract/count`, { timeoutMs: 5000 }),
		// /user/unique_addresses scans the full chain and is noticeably slower
		// than the others — give it a longer leash before falling back to [].
		timedFetch(`${CAULDRON_INDEXER}/user/unique_addresses`, { timeoutMs: 12_000 })
	]);

	const out: CauldronGlobalStats = { ...empty };
	const usd = (sats: number, double = false) =>
		bchPriceUSD > 0 ? satoshisToBCH(sats) * bchPriceUSD * (double ? 2 : 1) : 0;

	if (tvlRes.status === 'fulfilled' && tvlRes.value.ok) {
		try {
			const data = await tvlRes.value.json();
			const sats = Number(data?.satoshis);
			if (Number.isFinite(sats)) {
				out.tvlSats = sats;
				out.tvlUSD = usd(sats, true);
			}
		} catch (err) {
			console.error('[external] Cauldron TVL parse failed:', err);
		}
	}

	if (vol24Res.status === 'fulfilled') {
		out.volume24hSats = vol24Res.value;
		out.volume24hUSD = usd(vol24Res.value);
	}
	if (vol7Res.status === 'fulfilled') {
		out.volume7dSats = vol7Res.value;
		out.volume7dUSD = usd(vol7Res.value);
	}
	if (vol30Res.status === 'fulfilled') {
		out.volume30dSats = vol30Res.value;
		out.volume30dUSD = usd(vol30Res.value);
	}

	if (countRes.status === 'fulfilled' && countRes.value.ok) {
		try {
			const data = await countRes.value.json();
			out.pools = {
				active: Number(data?.active) || 0,
				ended: Number(data?.ended) || 0,
				interactions: Number(data?.interactions) || 0
			};
		} catch (err) {
			console.error('[external] Cauldron contract/count parse failed:', err);
		}
	}

	if (uniqueRes.status === 'fulfilled' && uniqueRes.value.ok) {
		try {
			const data = await uniqueRes.value.json();
			// Endpoint returns an array of [month, count] tuples (e.g. ["2024-01", 400]).
			if (Array.isArray(data)) {
				out.uniqueAddressesByMonth = data
					.map((row: unknown) => {
						if (Array.isArray(row) && typeof row[0] === 'string') {
							return { month: row[0], count: Number(row[1]) || 0 };
						}
						return null;
					})
					.filter((r): r is { month: string; count: number } => r !== null);
			}
		} catch (err) {
			console.error('[external] Cauldron unique_addresses parse failed:', err);
		}
	}

	return out;
}
