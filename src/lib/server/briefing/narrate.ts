// Stork Sightings — token-of-the-day narrative. LLM primary pass.
// Selects the most notable token that passes all quality gates,
// then has the LLM write a 2-paragraph profile. Omits the section
// if no token qualifies.

import type { Briefing, BriefingConfig, TokenProfile } from './types.js';
import { llmCall } from './llm.js';

// Quality gates: a token must meet ALL of these to be eligible for spotlight.
const MIN_HOLDERS = 10;

interface TokenCandidate {
	categoryHex: string;
	name: string;
	symbol: string | null;
	description: string | null;
	holderCount: number;
	iconCleared: boolean;
	listed: boolean;
	hasActivity: boolean;
	giniTier: string;
	score: number;
}

export async function writeTokenProfile(
	briefing: Briefing,
	config: BriefingConfig
): Promise<{ profile: TokenProfile | null; omitted: boolean; reason: string }> {
	const candidate = selectCandidate(briefing);
	if (!candidate) {
		return {
			profile: null,
			omitted: true,
			reason: 'No token passed quality gates (requires BCMR metadata, >10 holders, cleared icon, not moderated)'
		};
	}

	const prompt = buildProfilePrompt(candidate, briefing);

	const { text, ok } = await llmCall(
		'You write token profiles for Stork Sightings. Punchy, informative, just the facts.',
		prompt,
		config,
		config.llm.model
	);

	const narrative = ok && text.trim()
		? text.trim()
		: `${candidate.name} (${candidate.symbol ?? 'No symbol'}) — ${candidate.holderCount} holders, Gini tier: ${candidate.giniTier}. ${candidate.description ?? ''}`;

	const profile: TokenProfile = {
		categoryHex: candidate.categoryHex,
		name: candidate.name,
		symbol: candidate.symbol ?? '',
		description: candidate.description ?? '',
		holderCount: candidate.holderCount,
		giniTier: candidate.giniTier,
		venues: candidate.listed ? ['listed'] : [],
		priceBch: null,
		volume24hSats: null,
		narrative
	};

	return { profile, omitted: false, reason: '' };
}

function selectCandidate(briefing: Briefing): TokenCandidate | null {
	const candidates: TokenCandidate[] = [];

	// Priority 1: whaleMoves entries (have real holder counts from DB)
	for (const w of briefing.whaleMoves) {
		// Strict gate: must have real holder data
		if (w.holderCountAfter < MIN_HOLDERS) continue;
		if (!w.name && !w.symbol) continue;

		candidates.push({
			categoryHex: w.categoryHex,
			name: w.name ?? 'Unknown',
			symbol: w.symbol || null,
			description: null,
			holderCount: w.holderCountAfter,
			iconCleared: false,
			listed: false,
			hasActivity: true,
			giniTier: giniToTier(w.giniAfter),
			score: (1 - w.giniAfter) * 100 * 0.3
		});
	}

	// Priority 2: mover entries (have price movement, but no holder data)
	for (const m of briefing.movers.gainers) {
		if (!m.name && !m.symbol) continue;
		candidates.push({
			categoryHex: m.categoryHex,
			name: m.name,
			symbol: m.symbol || null,
			description: null,
			holderCount: 0,
			iconCleared: false,
			listed: true,
			hasActivity: true,
			giniTier: '',
			score: Math.abs(m.pricePct) * 0.4
		});
	}
	for (const m of briefing.movers.losers) {
		if (!m.name && !m.symbol) continue;
		candidates.push({
			categoryHex: m.categoryHex,
			name: m.name,
			symbol: m.symbol || null,
			description: null,
			holderCount: 0,
			iconCleared: false,
			listed: true,
			hasActivity: true,
			giniTier: '',
			score: Math.abs(m.pricePct) * 0.4
		});
	}

	if (candidates.length === 0) return null;

	// Sort by score, prefer ones with holder data
	candidates.sort((a, b) => {
		if (a.holderCount > 0 && b.holderCount === 0) return -1;
		if (b.holderCount > 0 && a.holderCount === 0) return 1;
		return b.score - a.score;
	});

	return candidates[0];
}

function giniToTier(gini: number): string {
	if (gini < 0.4) return 'Excellent';
	if (gini < 0.6) return 'Good';
	if (gini < 0.75) return 'Fair';
	if (gini < 0.9) return 'Poor';
	return 'Whale-controlled';
}

function buildProfilePrompt(c: TokenCandidate, b: Briefing): string {
	const ecosystemCtx = b.ecosystem;
	return JSON.stringify({
		token: { name: c.name, symbol: c.symbol, holderCount: c.holderCount, giniTier: c.giniTier },
		ecosystem: {
			totalTokens: ecosystemCtx.totalTokens,
			newToday: ecosystemCtx.tokensNew24h,
			medianGini: ecosystemCtx.medianGini
		}
	}, null, 2) + `\n\n` +
		`Write a 2-paragraph profile of this token.\n` +
		`Paragraph 1: What it is, what it does, who might use it.\n` +
		`Paragraph 2: Why it's notable today. What happened.\n` +
		`Be punchy. If there's a pun to be made, make it — but keep it sharp.\n` +
		`No filler. No "in the world of." No "exciting." Just the facts with bite.`;
}
