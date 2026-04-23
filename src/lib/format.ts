// Presentation helpers — shared between server loaders and Svelte components.

// Image-format extensions we refuse to render because they carry animation
// frames. Checked case-insensitively against the URL path portion (before
// `?` / `#`) so query strings don't hide a `.gif`. A future
// bcp-proxy / icon-transcode worker could replace this by serving static
// snapshots of every icon; for now, hiding flashy animated token icons
// behind the placeholder is the cheap + correct default. Extension-only
// detection is imperfect — a CDN serving `image/gif` under `.bin` would
// slip through — but it catches >95% of real-world CashToken icons which
// come straight off IPFS with honest extensions.
const ANIMATED_IMAGE_EXT_RE =
	/\.(gif|apng|webp|avifs|mng|png-sequence)(\?|#|$)/i;

/**
 * Resolve a BCMR-style icon URI to a safe, https(s) gateway URL suitable for
 * <img src>. Unknown schemes (javascript:, file:, data:<not-image>) fall back
 * to a placeholder so untrusted metadata can't render tracking pixels or
 * attempt scheme-based attacks. Animated formats (.gif, .apng, .webp,
 * .avifs) also fall back — we don't want moving images in the directory
 * (some tokens mint intentionally-flashy icons).
 */
export function getIPFSUrl(iconUrl: string | null | undefined): string {
	if (!iconUrl) return PLACEHOLDER_ICON;
	if (ANIMATED_IMAGE_EXT_RE.test(iconUrl)) return PLACEHOLDER_ICON;

	const ipfsGateway = 'https://ipfs.io/ipfs/';

	// Pre-resolved NFT.Storage CID path — pass through unchanged.
	const extendedIpfsPattern =
		/^https:\/\/[a-zA-Z0-9]+\.ipfs\.nftstorage\.link\/.+/;
	if (extendedIpfsPattern.test(iconUrl)) return iconUrl;

	const rewriters: Array<{ pattern: RegExp; replace: (cid: string) => string }> = [
		{
			pattern: /^https:\/\/(.+)\.ipfs\.nftstorage\.link\//,
			replace: (cid) => `${ipfsGateway}${cid}`
		},
		{
			pattern: /^ipfs:\/\/(.+)/,
			replace: (cid) => `${ipfsGateway}${cid}`
		}
	];
	for (const { pattern, replace } of rewriters) {
		const m = iconUrl.match(pattern);
		if (m?.[1]) return replace(m[1]);
	}

	// Fallthrough: accept only https(s) and data:image/*.
	if (/^https?:\/\//i.test(iconUrl)) return iconUrl;
	if (/^data:image\//i.test(iconUrl)) return iconUrl;

	return PLACEHOLDER_ICON;
}

export const PLACEHOLDER_ICON =
	'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="%23e2e8f0"/></svg>';

export function satoshisToBCH(sats: number): number {
	return sats / 100_000_000;
}

export function humanizeBigNumber(value: number): string {
	if (!Number.isFinite(value)) return '—';
	const units = ['', 'K', 'M', 'B', 'T', 'P', 'E'];
	const abs = Math.abs(value);
	if (abs < 1000) return value.toString();

	const unitIndex = Math.min(
		units.length - 1,
		Math.floor(Math.log(abs) / Math.log(1000))
	);
	let numStr = (value / Math.pow(1000, unitIndex)).toFixed(2);
	numStr = parseFloat(numStr).toString();
	return `${numStr}${units[unitIndex]}`;
}

/**
 * Format a NUMERIC(78,0) supply/balance for display without losing precision
 * on the integer-magnitude digits that drive the humanized bucket.
 *
 * Inputs:
 *   - supply: decimal string from Postgres NUMERIC column (no fractional part)
 *   - decimals: CashTokens decimals (0..8)
 *
 * Strategy: do the integer shift in BigInt space so supplies above 2^53
 * still pick the correct K/M/B/T/P/E bucket, then coerce only the magnitude
 * of the shifted value to a JS number for humanize.
 */
export function humanizeNumericSupply(
	supply: string | null | undefined,
	decimals: number = 0
): string {
	if (!supply) return '—';
	const safeDecimals = Math.max(0, Math.min(8, Math.floor(decimals)));
	let big: bigint;
	try {
		big = BigInt(supply);
	} catch {
		return '—';
	}
	if (safeDecimals === 0) {
		return humanizeBigNumber(bigintToApproxNumber(big));
	}
	const divisor = 10n ** BigInt(safeDecimals);
	const integerPart = big / divisor;
	const remainder = big % divisor;
	// Keep up to 3 significant fractional digits so 1.234M doesn't round to 1M.
	const fractional = Number(remainder) / Number(divisor);
	const combined = bigintToApproxNumber(integerPart) + fractional;
	return humanizeBigNumber(combined);
}

function bigintToApproxNumber(n: bigint): number {
	// BigInt → Number is safe up to 2^53; beyond that we lose precision, but
	// humanizeBigNumber only cares about the decimal exponent and the leading
	// few digits, which Number(bigint) preserves.
	return Number(n);
}

/**
 * Convert a Cauldron venue-listing price (sats per smallest-unit-of-token,
 * the raw value we store in `token_venue_listings`) into a dollar string.
 *
 * The source number for, say, a token with 8 decimals and $1 per whole
 * token when BCH = $460 is `(100_000_000 / 460) / 10^8` ≈ `2.17e-3` sats
 * per smallest unit. To get USD-per-whole-token: multiply by `10^decimals`,
 * divide by `10^8` (sats → BCH), multiply by the live BCH/USD rate.
 */
export function formatVenuePriceUSD(
	priceSats: number | null | undefined,
	decimals: number,
	bchPriceUSD: number | null | undefined
): string {
	if (priceSats == null || bchPriceUSD == null || bchPriceUSD <= 0) return '—';
	if (!Number.isFinite(priceSats) || priceSats <= 0) return '—';
	const bchPerToken = (priceSats * Math.pow(10, decimals)) / 1e8;
	const usd = bchPerToken * bchPriceUSD;
	if (!Number.isFinite(usd) || usd <= 0) return '—';
	if (usd >= 1) return `$${usd.toFixed(2)}`;
	if (usd >= 0.01) return `$${usd.toFixed(4)}`;
	return `$${usd.toFixed(6)}`;
}

/**
 * Convert raw locked-BCH-side satoshis (the `tvl_satoshis` column value)
 * into a compact USD TVL string. Cauldron is a double-sided AMM so
 * total pool value is `2 × bch_side`, matching the calc in external.ts.
 */
export function formatVenueTvlUSD(
	tvlSatoshis: number | null | undefined,
	bchPriceUSD: number | null | undefined
): string {
	if (tvlSatoshis == null || bchPriceUSD == null || bchPriceUSD <= 0) return '—';
	if (!Number.isFinite(tvlSatoshis) || tvlSatoshis <= 0) return '—';
	const usd = (tvlSatoshis / 1e8) * bchPriceUSD * 2;
	if (!Number.isFinite(usd) || usd <= 0) return '—';
	if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
	if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}k`;
	if (usd >= 1) return `$${usd.toFixed(0)}`;
	return `$${usd.toFixed(2)}`;
}

export function formatMarketCap(marketCap: string): string {
	if (marketCap === 'N/A' || marketCap === '0') {
		return '-';
	}
	const numericValue = parseFloat(marketCap);
	if (!Number.isFinite(numericValue)) return '-';
	if (numericValue >= 1_000_000) {
		return `$${humanizeBigNumber(numericValue)}`;
	} else if (numericValue >= 1) {
		return `$${numericValue.toLocaleString('en-US', {
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		})}`;
	} else {
		return `$${numericValue.toFixed(2)}`;
	}
}
