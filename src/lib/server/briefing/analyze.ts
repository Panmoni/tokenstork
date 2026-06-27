// Stork Sightings — analysis. Takes raw signals from gather.ts and
// computes derived metrics: sorts movers into gainers/losers, scores
// token-of-the-day candidates, filters quality gates. No LLM here — this
// is pure rule-based computation.

import type * as T from './types.js';
import type { RawSignals } from './gather.js';

export interface AnalyzedSignals {
	movers: { gainers: T.MoverItem[]; losers: T.MoverItem[]; tvlMovers: T.MoverItem[] };
	newTokens: T.NewTokenItem[];
	whaleMoves: T.WhaleMoveItem[];
	bcmrChanges: T.BcmrChangeItem[];
	votes: T.VoteItem[];
	ecosystem: T.EcosystemSnapshot;
	bchChain: T.BchChainStats | null;
}

export function analyzeSignals(raw: RawSignals): AnalyzedSignals {
	const gainers = raw.movers
		.filter((m) => m.pricePct > 0)
		.sort((a, b) => b.pricePct - a.pricePct)
		.slice(0, 5);

	const losers = raw.movers
		.filter((m) => m.pricePct < 0)
		.sort((a, b) => a.pricePct - b.pricePct)
		.slice(0, 5);

	const tvlMovers = raw.movers
		.filter((m): m is typeof m & { tvlPct: number } => m.tvlPct !== null)
		.sort((a, b) => Math.abs(b.tvlPct!) - Math.abs(a.tvlPct!))
		.slice(0, 5);

	return {
		movers: { gainers, losers, tvlMovers },
		newTokens: raw.newTokens,
		whaleMoves: raw.whaleMoves,
		bcmrChanges: raw.bcmrChanges,
		votes: raw.votes,
		ecosystem: raw.ecosystem,
		bchChain: raw.bchChain
	};
}
