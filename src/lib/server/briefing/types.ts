// Stork Sightings — shared types for the daily BCH token briefing engine.
// Mirrors the pattern from gmsecurity: a single Briefing object is the
// canonical output; every renderer consumes it.

export interface BriefingConfig {
	windowHours: number;
	maxMovers: number;
	maxNewTokens: number;
	maxWhaleMoves: number;
	outputDir: string;
	publicUrl: string;
	substackUrl: string;
	llm: {
		baseUrl: string;
		apiKey: string;
		model: string;
		reviewModel: string;
	};
	email: {
		resendApiKey: string;
		from: string;
		to: string;
	};
}

export interface MoverItem {
	categoryHex: string;
	symbol: string;
	name: string;
	priceOld: number;
	priceNew: number;
	pricePct: number;
	tvlOld: number | null;
	tvlNew: number | null;
	tvlPct: number | null;
}

export interface NewTokenItem {
	categoryHex: string;
	name: string | null;
	symbol: string | null;
	description: string | null;
	iconUri: string | null;
	genesisTime: string;
	tokenType: string;
	holderCount: number;
	classification?: string;
}

export interface WhaleMoveItem {
	categoryHex: string;
	name: string | null;
	symbol: string | null;
	giniBefore: number;
	giniAfter: number;
	giniDelta: number;
	holderCountBefore: number;
	holderCountAfter: number;
}

export interface BcmrChangeItem {
	categoryHex: string;
	name: string | null;
	symbol: string | null;
	severity: string;
	changeType: string;
	changedAt: string;
	summary: string;
}

export interface VoteItem {
	categoryHex: string;
	name: string | null;
	symbol: string | null;
	upvotes: number;
	downvotes: number;
	controversial: boolean;
}

export interface EcosystemSnapshot {
	totalTokens: number;
	tokensNew24h: number;
	tokensNew7d: number;
	tvlSats: number;
	tvlUsd: number;
	volume24hSats: number;
	volume24hUsd: number;
	holderCount: number;
	listingsCauldron: number;
	listingsTapswap: number;
	listingsFex: number;
	medianGini: number | null;
	activity24hTokenTxs: number;
	activity24hMints: number;
	bchPriceUsd: number;
	bchGini: number | null;
}

export interface TrendBullet {
	text: string;
}

export interface TokenProfile {
	categoryHex: string;
	name: string;
	symbol: string;
	description: string;
	holderCount: number;
	giniTier: string;
	venues: string[];
	priceBch: number | null;
	volume24hSats: number | null;
	narrative: string;
}

export interface ReviewFindings {
	factualErrors: string[];
	missedInsights: string[];
	toneSuggestions: string[];
}

export interface QueryDiagnostic {
	name: string;
	durationMs: number;
	rowCount: number;
	error?: string;
}

export interface BriefingStats {
	generatedAt: string;
	windowHours: number;
	totalSignalSets: number;
	signalSetsWithData: number;
	llmCallsMade: number;
	llmCallsFailed: number;
	llmTokensUsed: number;
	queryDiagnostics: QueryDiagnostic[];
	reviewFindings?: ReviewFindings;
}

export interface Briefing {
	generatedAt: string;
	windowHours: number;
	masthead: string;
	executiveSummary: string;
	trends: TrendBullet[];
	movers: { gainers: MoverItem[]; losers: MoverItem[]; tvlMovers: MoverItem[] };
	newTokens: NewTokenItem[];
	whaleMoves: WhaleMoveItem[];
	bcmrChanges: BcmrChangeItem[];
	votes: VoteItem[];
	ecosystem: EcosystemSnapshot;
	tokenProfile: TokenProfile | null;
	tokenOfTheDayOmitted: boolean;
	tokenOfTheDayOmitReason: string;
	spark: string;
	stats: BriefingStats;
}
