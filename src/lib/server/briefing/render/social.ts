// Stork Sightings — social thread renderer. Produces X (Twitter) and
// Bluesky ready-to-paste threads, character-budgeted at ≤280 chars per
// post. Manual posting for now — operator copies from social.json.

import type { Briefing } from '../types.js';

export interface SocialOutput {
	x: { single: string; thread: string[] };
	bluesky: { single: string; thread: string[] };
}

function esc(s: string): string {
	return s;
}

function fmtPct(n: number): string {
	const sign = n > 0 ? '+' : '';
	return `${sign}${n.toFixed(1)}%`;
}

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return s.slice(0, max - 1) + '…';
}

export function renderSocial(b: Briefing): SocialOutput {
	const date = new Date(b.generatedAt).toISOString().slice(0, 10);

	const header = `⬢ Stork Sightings — ${date}`;

	const posts: string[] = [];
	posts.push(header);

	let body = '';

	// Summary
	if (b.executiveSummary) {
		const summaryPost = truncate(b.executiveSummary, 260);
		posts.push(summaryPost);
	}

	// Movers
	if (b.movers.gainers.length > 0) {
		const gainers = b.movers.gainers.slice(0, 3).map((m) => `${m.symbol || m.name} ${fmtPct(m.pricePct)}`).join(' · ');
		posts.push(`↑ Gainers: ${gainers}`);
	}
	if (b.movers.losers.length > 0) {
		const losers = b.movers.losers.slice(0, 3).map((m) => `${m.symbol || m.name} ${fmtPct(m.pricePct)}`).join(' · ');
		posts.push(`↓ Losers: ${losers}`);
	}

	// New tokens
	if (b.newTokens.length > 0) {
		const names = b.newTokens.map((t) => t.symbol || t.name).join(', ');
		posts.push(truncate(`New: ${names}`, 270));
	}

	// Token of the day
	if (b.tokenProfile) {
		posts.push(truncate(`${b.tokenProfile.symbol || b.tokenProfile.name}: ${b.tokenProfile.narrative}`, 270));
	}

	// Ecosystem stats
	const eco = b.ecosystem;
	posts.push(`${eco.tokensNew24h} new tokens · ${eco.activity24hTokenTxs} txs · ${eco.holderCount.toLocaleString()} holders · median Gini ${eco.medianGini?.toFixed(2) ?? 'N/A'}`);

	if (b.ecosystem.bchGini !== null) {
		posts.push(`BCH coin Gini: ${b.ecosystem.bchGini.toFixed(2)}`);
	}

	// CTA
	posts.push(`Full briefing → tokenstork.com/briefing`);

	// Number the thread
	const thread = posts.map((p, i) => `${i + 1}/${posts.length} ${p}`);

	return {
		x: { single: header, thread },
		bluesky: { single: header, thread }
	};
}
