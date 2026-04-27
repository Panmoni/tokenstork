// Shared API response types. Mirrors src/routes/api/tokens/+server.ts.

export type TokenType = 'FT' | 'NFT' | 'FT+NFT';

export interface TokenApiRow {
	id: string;
	name: string | null;
	symbol: string | null;
	decimals: number;
	description: string | null;
	icon: string | null;
	tokenType: TokenType;
	isVerifiedOnchain: boolean;
	isFullyBurned: boolean;
	currentSupply: string | null;
	liveUtxoCount: number | null;
	liveNftCount: number | null;
	holderCount: number | null;
	hasActiveMinting: boolean;
	firstSeenAt: number;
	genesisBlock: number;
	updatedAt: number;

	// Per-venue listing data. Populated by the `sync-cauldron` worker for
	// AMM price/TVL and by `sync-tail` + `tapswap-backfill` for P2P
	// listings. Values are raw from chain / venue — USD conversion happens
	// at render time using the live BCH price. Null (or 0 for the count)
	// for tokens not currently listed on that venue.
	cauldronPriceSats: number | null;
	cauldronTvlSatoshis: number | null;

	// Tapswap (P2P marketplace) — different semantic from Cauldron: these
	// are fixed-price listings, not a pool. `tapswapListingCount` is the
	// count of open offers where this category is the "has" side (someone
	// is selling this token). Zero if not listed.
	tapswapListingCount: number;

	// Fex.cash AMM — same shape as Cauldron (price + TVL). Null for tokens
	// without a Fex pool. Populated by the `sync-fex` worker from on-chain
	// AssetCovenant UTXOs (no external API; we scan BCHN directly).
	fexPriceSats: number | null;
	fexTvlSatoshis: number | null;

	// Price-change signals across three windows, computed server-side from
	// `token_price_history`. `null` when we don't have a data point on the
	// older side of the window yet (e.g., within 7 days of first deploy).
	priceChange1hPct: number | null;
	priceChange24hPct: number | null;
	priceChange7dPct: number | null;

	// Last 7 days of Cauldron price points in sats, oldest-first. Rendered
	// as an SVG sparkline. Empty array when history is missing.
	sparklinePoints: number[];

	// Icon safety pipeline (item #22 / docs/icon-safety-plan.md): hex of
	// the SHA-256 content hash for this icon's cleared WebP, or null if
	// the icon hasn't been scanned + cleared yet. UI helper
	// $lib/icons.ts#iconHrefFor consumes this — null → placeholder,
	// otherwise → /icons/<hex>.webp served from our origin.
	iconClearedHash: string | null;
}

export interface TokensResponse {
	tokens: TokenApiRow[];
	count: number;
	limit: number;
	offset: number;
	total: number;
}
