// Stork Sightings — pipeline orchestrator. Calls gather → analyze →
// LLM passes (summary, classify, narrate, review) → build Briefing.
// The public API.

import type * as T from './types.js';
import { loadConfig } from './config.js';
import { gatherSignals } from './gather.js';
import { analyzeSignals } from './analyze.js';
import { resetLlmStats, getLlmStats } from './llm.js';
import { writeExecutiveSummary } from './summarize.js';
import { classifyNewTokens } from './classify.js';
import { writeTokenProfile } from './narrate.js';
import { reviewBriefing } from './review.js';

export async function generateBriefing(
	config?: T.BriefingConfig
): Promise<{ briefing: T.Briefing }> {
	const cfg = config ?? loadConfig();
	const genAt = new Date().toISOString();
	const t0 = Date.now();
	resetLlmStats();

	const raw = await gatherSignals(cfg);
	const analyzed = analyzeSignals(raw);

	const signalSetsWithData = [
		analyzed.movers.gainers.length + analyzed.movers.losers.length > 0,
		analyzed.newTokens.length > 0,
		analyzed.whaleMoves.length > 0,
		analyzed.bcmrChanges.length > 0,
		analyzed.votes.length > 0
	].filter(Boolean).length;

	const hasLlm = cfg.llm.apiKey.length > 0;

	// LLM passes (non-blocking via allSettled)
	let summary = { summary: '', trends: [] as T.TrendBullet[] };
	let classifiedTokens: T.NewTokenItem[] = [];
	let profileResult: { profile: T.TokenProfile | null; omitted: boolean; reason: string } = { profile: null, omitted: true, reason: 'No token passed quality gates' };
	let reviewFindings: T.ReviewFindings | null = null;

	if (hasLlm) {
		const [sumP, classP, profP] = await Promise.allSettled([
			writeExecutiveSummary(
				{ ...emptyBriefing(cfg, genAt, raw.diagnostics.length, signalSetsWithData), ...analyzed, movers: analyzed.movers, newTokens: analyzed.newTokens, whaleMoves: analyzed.whaleMoves, bcmrChanges: analyzed.bcmrChanges, votes: analyzed.votes, ecosystem: analyzed.ecosystem } as T.Briefing,
				cfg
			),
			classifyNewTokens(analyzed.newTokens, cfg),
			(async () => {
				const b = { ...emptyBriefing(cfg, genAt, raw.diagnostics.length, signalSetsWithData), ...analyzed, movers: analyzed.movers, newTokens: analyzed.newTokens, whaleMoves: analyzed.whaleMoves, bcmrChanges: analyzed.bcmrChanges, votes: analyzed.votes, ecosystem: analyzed.ecosystem } as T.Briefing;
				return writeTokenProfile(b, cfg);
			})()
		]);

		summary = sumP.status === 'fulfilled' ? sumP.value : { summary: '', trends: [] };
		classifiedTokens = classP.status === 'fulfilled' ? classP.value : analyzed.newTokens.map((t) => ({ ...t, classification: 'other' as const }));
		profileResult = profP.status === 'fulfilled' ? profP.value : { profile: null, omitted: true, reason: 'LLM pass failed' };
	} else {
		classifiedTokens = analyzed.newTokens.map((t) => ({ ...t, classification: 'other' as const }));
		summary = fallbackBasic(analyzed);
	}

	const llmStats = getLlmStats();

	const briefing: T.Briefing = {
		generatedAt: genAt,
		windowHours: cfg.windowHours,
		masthead: 'Stork Sightings',
		executiveSummary: summary.summary,
		trends: summary.trends,
		movers: analyzed.movers,
		newTokens: classifiedTokens,
		whaleMoves: analyzed.whaleMoves,
		bcmrChanges: analyzed.bcmrChanges,
		votes: analyzed.votes,
		ecosystem: analyzed.ecosystem,
		bchChain: analyzed.bchChain,
		tokenProfile: profileResult.profile,
		tokenOfTheDayOmitted: profileResult.omitted,
		tokenOfTheDayOmitReason: profileResult.reason,
		spark: generateSpark(analyzed),
		stats: {
			generatedAt: genAt,
			windowHours: cfg.windowHours,
			totalSignalSets: raw.diagnostics.length,
			signalSetsWithData,
			llmCallsMade: llmStats.callsMade,
			llmCallsFailed: llmStats.callsFailed,
			llmTokensUsed: llmStats.totalTokens,
			queryDiagnostics: raw.diagnostics,
		}
	};

	// Reviewer pass (after brief is built, so it can see the full output)
	if (hasLlm && cfg.llm.reviewModel) {
		try {
			reviewFindings = await reviewBriefing(briefing, cfg);
			briefing.stats.reviewFindings = reviewFindings ?? undefined;
			if (reviewFindings) {
				process.stderr.write(`[review] ${reviewFindings.factualErrors.length} errors, ${reviewFindings.missedInsights.length} missed, ${reviewFindings.toneSuggestions.length} tone suggestions\n`);
			}
		} catch (err) {
			process.stderr.write(`[review] failed: ${err}\n`);
		}
	}

	const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
	process.stderr.write(`[briefing] generated in ${elapsed}s · ${signalSetsWithData}/${raw.diagnostics.length} signal sets with data · ${llmStats.callsMade} LLM calls\n`);

	return { briefing };
}

function emptyBriefing(cfg: T.BriefingConfig, genAt: string, totalSigSets: number, sigSetsWithData: number): Partial<T.Briefing> {
	return {
		generatedAt: genAt,
		windowHours: cfg.windowHours,
		masthead: 'Stork Sightings',
		executiveSummary: '',
		trends: [],
		tokenProfile: null,
		tokenOfTheDayOmitted: true,
		tokenOfTheDayOmitReason: '',
		spark: '',
		stats: {} as T.BriefingStats
	};
}

function fallbackBasic(analyzed: ReturnType<typeof analyzeSignals>): { summary: string; trends: T.TrendBullet[] } {
	const e = analyzed.ecosystem;
	const parts: string[] = [];
	if (e.tokensNew24h > 0) parts.push(`${e.tokensNew24h} new token${e.tokensNew24h === 1 ? '' : 's'} minted in the last 24h`);
	if (e.activity24hTokenTxs > 0) parts.push(`${e.activity24hTokenTxs} token-bearing transactions`);
	const summary = parts.length > 0 ? parts.join('. ') + '.' : 'Quiet day in the BCH token ecosystem.';
	const trends: T.TrendBullet[] = [];
	if (e.medianGini !== null) trends.push({ text: `Median Gini: ${e.medianGini.toFixed(2)}` });
	if (e.bchGini !== null) trends.push({ text: `BCH Gini: ${e.bchGini.toFixed(2)}` });
	return { summary, trends };
}

function generateSpark(analyzed: ReturnType<typeof analyzeSignals>): string {
	if (analyzed.whaleMoves.length > 0) {
		const w = analyzed.whaleMoves[0];
		return `Holder distribution shift on ${w.symbol || w.name}: Gini moved ${w.giniDelta > 0 ? 'up' : 'down'} by ${Math.abs(w.giniDelta).toFixed(2)}. ${w.giniDelta > 0 ? 'Concentrating.' : 'Distributing.'}`;
	}
	if (analyzed.bcmrChanges.length > 0) {
		const c = analyzed.bcmrChanges[0];
		return `BCMR update on ${c.symbol || c.name}: ${c.summary.slice(0, 100)}`;
	}
	if (analyzed.movers.gainers.length > 0) {
		const g = analyzed.movers.gainers[0];
		return `${g.symbol || g.name} led gainers at ${g.pricePct.toFixed(1)}%.`;
	}
	return 'Watch your tokens. The stork is watching too.';
}
