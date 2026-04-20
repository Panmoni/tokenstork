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
}

export interface TokensResponse {
	tokens: TokenApiRow[];
	count: number;
	limit: number;
	offset: number;
	total: number;
}
