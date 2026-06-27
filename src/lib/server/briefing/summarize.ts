// Stork Sightings — executive summary + trend bullets. LLM primary pass.
// Falls back to a deterministic template if the LLM is unavailable.

import type { Briefing, BriefingConfig, TrendBullet } from './types.js';
import { llmCall, validateNumbers } from './llm.js';

export async function writeExecutiveSummary(
	briefing: Briefing,
	config: BriefingConfig
): Promise<{ summary: string; trends: TrendBullet[] }> {
	const dataBundle = buildDataBundle(briefing);
	const prompt = buildPrompt(dataBundle);

	const { text, ok } = await llmCall(
		'You are the executive editor of Stork Sightings. Write a concise, punchy briefing.',
		prompt,
		config,
		config.llm.model
	);

	if (!ok || !text.trim()) {
		return fallbackSummary(briefing);
	}

	const parsed = parseSummaryResponse(text);
	if (!parsed.summary) return fallbackSummary(briefing);

	const knownNums = extractKnownNumbers(dataBundle);
	const badNums = validateNumbers(parsed.summary, knownNums);
	if (badNums.length > 0) {
		process.stderr.write(`[summarize] hallucinated numbers: ${badNums.join(', ')}\n`);
	}

	return parsed;
}

interface DataBundle {
	totalTokens: number;
	newTokens24h: number;
	newTokensWindow: number;
	topGainer: string;
	topGainerPct: number;
	topLosers: string;
	topLosersPct: number;
	topTvlMove: string;
	tvlSats: string;
	volume24hSats: string;
	holders: number;
	medianGini: number | null;
	whaleMovesCount: number;
	bcmrChangesCount: number;
	upvoted: string;
	controversial: string;
	bchGini: number | null;
	mints24h: number;
	tokenTxs24h: number;
}

function buildDataBundle(b: Briefing): DataBundle {
	const topG = b.movers.gainers[0];
	const topL = b.movers.losers[0];
	const topT = b.movers.tvlMovers[0];

	return {
		totalTokens: b.ecosystem.totalTokens,
		newTokens24h: b.ecosystem.tokensNew24h,
		newTokensWindow: b.newTokens.length,
		topGainer: topG ? `${topG.symbol || topG.name} (${topG.categoryHex.slice(0, 8)})` : 'none',
		topGainerPct: topG ? Math.round(topG.pricePct * 10) / 10 : 0,
		topLosers: topL ? `${topL.symbol || topL.name} (${topL.categoryHex.slice(0, 8)})` : 'none',
		topLosersPct: topL ? Math.round(topL.pricePct * 10) / 10 : 0,
		topTvlMove: topT ? `${topT.symbol || topT.name} (${topT.categoryHex.slice(0, 8)})` : 'none',
		tvlSats: formatBch(b.ecosystem.tvlSats),
		volume24hSats: formatBch(b.ecosystem.volume24hSats),
		holders: b.ecosystem.holderCount,
		medianGini: b.ecosystem.medianGini,
		whaleMovesCount: b.whaleMoves.length,
		bcmrChangesCount: b.bcmrChanges.length,
		upvoted: b.votes.length > 0 ? `${b.votes[0].symbol || b.votes[0].name}` : 'none',
		controversial: b.votes.filter((v) => v.controversial).map((v) => v.symbol || v.name).join(', ') || 'none',
		bchGini: b.ecosystem.bchGini,
		mints24h: b.ecosystem.activity24hMints,
		tokenTxs24h: b.ecosystem.activity24hTokenTxs
	};
}

function formatBch(sats: number): string {
	return (sats / 1e8).toFixed(2) + ' BCH';
}

function buildPrompt(d: DataBundle): string {
	return JSON.stringify(d, null, 2) + `\n\n` +
		`Write a 3-5 sentence executive summary. Start with the most notable thing that happened.\n` +
		`Then give 2-4 trend bullets (one-line each, prefix with "•").\n` +
		`Respond as JSON: {"summary": "...", "trends": ["• ...", "• ..."]}\n` +
		`The summary should sound like a sharp, opinionated observer — not a robot.\n` +
		`Mention specific token names from the data.\n` +
		`NEVER invent any number not in the input data. Use ONLY the exact numbers provided above.\n` +
		`If a number is "none", "0", or "0.00", do NOT invent alternatives.\n` +
		`Do NOT invent percentages, dollar amounts, BCH amounts, or holder counts not provided.`;
}

function parseSummaryResponse(text: string): { summary: string; trends: TrendBullet[] } {
	try {
		const json = JSON.parse(extractJson(text));
		return {
			summary: String(json.summary ?? ''),
			trends: Array.isArray(json.trends)
				? json.trends.map((t: unknown) => ({ text: String(t) }))
				: []
		};
	} catch {
		const lines = text.split('\n').filter((l) => l.trim());
		const trends: TrendBullet[] = [];
		let summary = '';
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('*')) {
				trends.push({ text: trimmed.replace(/^[•\-*]\s*/, '') });
			} else {
				summary += (summary ? ' ' : '') + trimmed;
			}
		}
		return { summary, trends };
	}
}

function extractJson(text: string): string {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start === -1 || end === -1) return text;
	return text.slice(start, end + 1);
}

function extractKnownNumbers(d: DataBundle): number[] {
	return [
		d.totalTokens, d.newTokens24h, d.newTokensWindow,
		d.topGainerPct, d.topLosersPct,
		d.holders, d.whaleMovesCount, d.bcmrChangesCount,
		d.mints24h, d.tokenTxs24h
	].filter((n) => !isNaN(n) && n !== null);
}

function fallbackSummary(b: Briefing): { summary: string; trends: TrendBullet[] } {
	const e = b.ecosystem;
	const parts: string[] = [];
	if (e.tokensNew24h > 0) parts.push(`${e.tokensNew24h} new token${e.tokensNew24h === 1 ? '' : 's'} minted in the last 24h.`);
	if (e.activity24hTokenTxs > 0) parts.push(`${e.activity24hTokenTxs} token-bearing transactions.`);
	if (b.movers.gainers.length > 0 || b.movers.losers.length > 0) parts.push(`${b.movers.gainers.length} gainers, ${b.movers.losers.length} losers on Cauldron.`);
	if (b.whaleMoves.length > 0) parts.push(`${b.whaleMoves.length} token${b.whaleMoves.length === 1 ? '' : 's'} with significant holder redistribution.`);

	const summary = parts.length > 0
		? parts.join(' ')
		: 'Quiet day in the BCH token ecosystem. Nothing unusual to report.';

	const trends: TrendBullet[] = [];
	if (e.tvlSats > 0) trends.push({ text: `Ecosystem TVL: ${formatBch(e.tvlSats)}` });
	if (e.medianGini !== null) trends.push({ text: `Median Gini coefficient: ${e.medianGini.toFixed(2)}` });
	if (e.bchGini !== null) trends.push({ text: `BCH coin Gini: ${e.bchGini.toFixed(2)}` });

	return { summary, trends };
}
