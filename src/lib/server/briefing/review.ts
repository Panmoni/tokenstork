// Stork Sightings — reviewer pass. Runs DeepSeek-V4-Pro over the full
// briefing to catch factual errors, missed insights, and tone issues.
// Non-fatal: findings are logged and written to _review.json but never
// block the briefing from publishing.

import type { Briefing, BriefingConfig, ReviewFindings } from './types.js';
import { llmCall } from './llm.js';

export async function reviewBriefing(
	briefing: Briefing,
	config: BriefingConfig
): Promise<ReviewFindings | null> {
	if (!config.llm.reviewModel) return null;

	const data = buildReviewPayload(briefing);

	const prompt = JSON.stringify(data, null, 2) + `\n\n` +
		`You are a fact-checker and editor reviewing the Stork Sightings briefing above.\n` +
		`Check the following:\n` +
		`1. Are any numbers or token names mentioned that are NOT present in the data above? List them.\n` +
		`2. What should the briefing have mentioned that it missed? What's the most important thing in the data that got overlooked?\n` +
		`3. How could the writing be sharper? More punchy? Less robotic? Suggest specific improvements.\n\n` +
		`Respond as JSON: {"factualErrors": ["error 1", ...], "missedInsights": ["insight 1", ...], "toneSuggestions": ["suggestion 1", ...]}\n` +
		`If you find nothing wrong, return empty arrays.`;

	const { text, ok } = await llmCall(
		'You are a meticulous fact-checker and editor. You catch everything.',
		prompt,
		config,
		config.llm.reviewModel
	);

	if (!ok || !text.trim()) {
		return { factualErrors: ['Reviewer model unavailable'], missedInsights: [], toneSuggestions: [] };
	}

	try {
		const parsed = JSON.parse(extractJson(text));
		return {
			factualErrors: Array.isArray(parsed.factualErrors) ? parsed.factualErrors.slice(0, 10) : [],
			missedInsights: Array.isArray(parsed.missedInsights) ? parsed.missedInsights.slice(0, 5) : [],
			toneSuggestions: Array.isArray(parsed.toneSuggestions) ? parsed.toneSuggestions.slice(0, 5) : []
		};
	} catch {
		process.stderr.write(`[review] failed to parse reviewer response\n`);
		return null;
	}
}

function buildReviewPayload(b: Briefing): Record<string, unknown> {
	return {
		masthead: b.masthead,
		generatedAt: b.generatedAt,
		windowHours: b.windowHours,
		executiveSummary: b.executiveSummary,
		trends: b.trends.map((t) => t.text),
		movers: {
			gainers: b.movers.gainers.map((m) => ({ name: m.name, symbol: m.symbol, pricePct: m.pricePct })),
			losers: b.movers.losers.map((m) => ({ name: m.name, symbol: m.symbol, pricePct: m.pricePct })),
			tvlMovers: b.movers.tvlMovers.map((m) => ({ name: m.name, symbol: m.symbol, tvlPct: m.tvlPct }))
		},
		newTokens: b.newTokens.map((t) => ({ name: t.name, symbol: t.symbol, classification: t.classification })),
		whaleMoves: b.whaleMoves.map((w) => ({ name: w.name, symbol: w.symbol, giniDelta: w.giniDelta })),
		bcmrChanges: b.bcmrChanges.map((c) => ({ name: c.name, symbol: c.symbol, severity: c.severity, summary: c.summary })),
		ecosystem: b.ecosystem,
		tokenProfile: b.tokenProfile ? { name: b.tokenProfile.name, narrative: b.tokenProfile.narrative } : null
	};
}

function extractJson(text: string): string {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start === -1 || end === -1) return text;
	return text.slice(start, end + 1);
}
