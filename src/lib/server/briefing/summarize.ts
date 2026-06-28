// Stork Sightings — executive summary + trend bullets. LLM primary pass.
// Falls back to a deterministic template if the LLM is unavailable.

import type { Briefing, BriefingConfig, TrendBullet } from './types.js';
import { llmCall, validateNumbers } from './llm.js';

export interface SummaryResult {
	headline: string;
	dek: string;
	summary: string;
	trends: TrendBullet[];
}

export async function writeExecutiveSummary(
	briefing: Briefing,
	config: BriefingConfig
): Promise<SummaryResult> {
	const dataBundle = buildDataBundle(briefing);
	const prompt = buildPrompt(dataBundle);

	const { text, ok } = await llmCall(
		EDITOR_SYSTEM,
		prompt,
		config,
		config.llm.model,
		4096
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

const EDITOR_SYSTEM = [
	'You are the lead writer of Stork Sightings, a daily newsletter about the Bitcoin Cash (BCH) CashToken ecosystem.',
	'You write like a veteran financial-newsletter columnist: a cynical, jaded trader who has watched a thousand tokens pump and dump.',
	'Your prose is sharp, confident, and readable — full sentences, real paragraphs, a point of view.',
	'You are NOT a spreadsheet. You tell the story of the day. You connect the dots between the numbers.',
	'When the day is boring, you say so with dry wit. When something genuinely good happens, you acknowledge it — grudgingly, understated.',
	'You write a punchy newspaper-style HEADLINE that captures the single biggest story of the day.',
	'Hard rule: every number you cite must appear verbatim in the data provided. Never invent or compute new numbers. But you do not need to cram numbers in — write naturally and cite a figure only when it sharpens the point.'
].join('\n');

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
	bchBlocks24h: number;
	bchTxCount24h: number;
	bchAvgTx7d: number;
	bchFeesBch: string;
	bchOutputBch: string;
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
		tokenTxs24h: b.ecosystem.activity24hTokenTxs,
		bchBlocks24h: b.bchChain?.blocks24h ?? 0,
		bchTxCount24h: b.bchChain?.txCount24h ?? 0,
		bchAvgTx7d: b.bchChain?.avgTxCount7d ?? 0,
		bchFeesBch: b.bchChain ? (b.bchChain.feesSats24h / 1e8).toFixed(2) : '0',
		bchOutputBch: b.bchChain ? (b.bchChain.outputSats24h / 1e8).toFixed(2) : '0'
	};
}

function formatBch(sats: number): string {
	return (sats / 1e8).toFixed(2) + ' BCH';
}

function buildPrompt(d: DataBundle): string {
	return `Here is today's data for the BCH CashToken ecosystem:\n\n` +
		JSON.stringify(d, null, 2) + `\n\n` +
		`Write today's edition. Respond as JSON with these fields:\n` +
		`{\n` +
		`  "headline": "A punchy newspaper-style headline, 4-9 words, capturing the day's biggest story",\n` +
		`  "dek": "A single sentence (the standfirst) that expands on the headline",\n` +
		`  "summary": "Three to five flowing sentences telling the story of the day. Real narrative — connect the dots, give your jaded take. Lead with whatever actually matters, not a list of stats.",\n` +
		`  "trends": ["2 to 4 short observations, each a single line"]\n` +
		`}\n\n` +
		`Voice: cynical, jaded trader. Dry wit. Understated when there's good news.\n` +
		`Cite specific token names from the data. Cite a number only when it lands a point — every number must appear verbatim above; never invent or compute new ones.\n` +
		`Do not start the summary with "Today we saw". Do not use the words "exciting" or "in the world of".\n` +
		`If the day is quiet, lean into it — that's a story too.`;
}

function parseSummaryResponse(text: string): SummaryResult {
	try {
		const json = JSON.parse(extractJson(text));
		return {
			headline: String(json.headline ?? '').trim(),
			dek: String(json.dek ?? '').trim(),
			summary: String(json.summary ?? '').trim(),
			trends: Array.isArray(json.trends)
				? json.trends.map((t: unknown) => ({ text: String(t).replace(/^[•\-*]\s*/, '') }))
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
		return { headline: '', dek: '', summary, trends };
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

function fallbackSummary(b: Briefing): SummaryResult {
	const e = b.ecosystem;
	const parts: string[] = [];
	if (e.tokensNew24h > 0) parts.push(`${e.tokensNew24h} new token${e.tokensNew24h === 1 ? '' : 's'} minted in the last 24h.`);
	if (e.activity24hTokenTxs > 0) parts.push(`${e.activity24hTokenTxs} token-bearing transactions cleared.`);
	if (b.movers.gainers.length > 0 || b.movers.losers.length > 0) parts.push(`${b.movers.gainers.length} gainers and ${b.movers.losers.length} losers on Cauldron.`);
	if (b.whaleMoves.length > 0) parts.push(`${b.whaleMoves.length} token${b.whaleMoves.length === 1 ? '' : 's'} flagged for concentrated holdings.`);

	const summary = parts.length > 0
		? parts.join(' ')
		: 'Quiet day in the BCH token ecosystem. Nothing unusual to report.';

	const trends: TrendBullet[] = [];
	if (e.tvlSats > 0) trends.push({ text: `Ecosystem TVL: ${formatBch(e.tvlSats)}` });
	if (e.medianGini !== null) trends.push({ text: `Median Gini coefficient: ${e.medianGini.toFixed(2)}` });
	if (e.bchGini !== null) trends.push({ text: `BCH coin Gini: ${e.bchGini.toFixed(2)}` });

	return {
		headline: e.tokensNew24h > 0 ? `${e.tokensNew24h} New Tokens, Little Else` : 'A Quiet Day on the Motherchain',
		dek: 'The automated rundown, no editor on duty.',
		summary,
		trends
	};
}
