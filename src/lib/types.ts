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
}

export interface TokensResponse {
	tokens: TokenApiRow[];
	count: number;
	limit: number;
	offset: number;
	total: number;
}
