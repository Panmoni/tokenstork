// Stork Sightings — plain text renderer. Terminal-friendly, no-HTML
// fallback for email text bodies and console previews.

import type { Briefing } from '../types.js';

export function renderText(b: Briefing): string {
	const date = new Date(b.generatedAt).toISOString().slice(0, 10);
	const time = new Date(b.generatedAt).toISOString().slice(11, 16);

	const lines: string[] = [];
	lines.push(`⬢ STORK SIGHTINGS`);
	lines.push(b.headline || 'Daily Briefing');
	if (b.dek) lines.push(b.dek);
	lines.push(`${date} ${time} UTC · last ${b.windowHours}h`);
	lines.push('─'.repeat(60));

	if (b.executiveSummary) {
		lines.push('');
		lines.push(b.executiveSummary);
	}

	if (b.trends.length > 0) {
		lines.push('');
		lines.push('TRENDS');
		for (const t of b.trends) lines.push(`  • ${t.text}`);
	}

	if (b.tokenProfile) {
		lines.push('');
		lines.push('TOKEN OF THE DAY');
		lines.push(`  ${b.tokenProfile.symbol || b.tokenProfile.name} — ${b.tokenProfile.holderCount} holders · Gini: ${b.tokenProfile.giniTier}`);
		lines.push(`  ${b.tokenProfile.narrative}`);
	}

	if (b.movers.gainers.length > 0) {
		lines.push('');
		lines.push('TOP GAINERS (Cauldron)');
		for (const m of b.movers.gainers) lines.push(`  ↑ ${m.symbol || m.name} ${m.name !== m.symbol ? `(${m.name}) ` : ''}${m.pricePct > 0 ? '+' : ''}${m.pricePct.toFixed(1)}%`);
	}

	if (b.movers.losers.length > 0) {
		lines.push('');
		lines.push('TOP LOSERS (Cauldron)');
		for (const m of b.movers.losers) lines.push(`  ↓ ${m.symbol || m.name} ${m.name !== m.symbol ? `(${m.name}) ` : ''}${m.pricePct.toFixed(1)}%`);
	}

	if (b.newTokens.length > 0) {
		lines.push('');
		lines.push('NEW TOKENS');
		for (const t of b.newTokens) lines.push(`  • ${t.symbol || '(unnamed)'}${t.name ? ` — ${t.name}` : ''} (${t.classification ?? 'other'}) · ${t.holderCount} holders`);
	}

	if (b.whaleMoves.length > 0) {
		lines.push('');
		lines.push('HOLDER SHIFTS');
		for (const w of b.whaleMoves) lines.push(`  • ${w.symbol || w.name}: Gini ${w.giniBefore.toFixed(2)} → ${w.giniAfter.toFixed(2)} (${w.giniDelta > 0 ? '+' : ''}${w.giniDelta.toFixed(2)})`);
	}

	if (b.bcmrChanges.length > 0) {
		lines.push('');
		lines.push('BCMR CHANGES');
		for (const c of b.bcmrChanges) lines.push(`  [${c.severity}] ${c.symbol || c.name} — ${c.summary}`);
	}

	lines.push('');
	lines.push('ECOSYSTEM');
	lines.push(`  Total: ${b.ecosystem.totalTokens.toLocaleString()} tokens · ${b.ecosystem.tokensNew24h} new 24h`);
	lines.push(`  Activity: ${b.ecosystem.activity24hTokenTxs.toLocaleString()} token txs · ${b.ecosystem.activity24hMints} mints`);
	lines.push(`  Holders: ${b.ecosystem.holderCount.toLocaleString()}`);
	if (b.ecosystem.medianGini !== null) lines.push(`  Median Gini: ${b.ecosystem.medianGini.toFixed(2)}`);
	if (b.ecosystem.bchGini !== null) lines.push(`  BCH coin Gini: ${b.ecosystem.bchGini.toFixed(2)}`);

	if (b.spark) {
		lines.push('');
		lines.push(`💡 ${b.spark}`);
	}

	lines.push('');
	lines.push('─'.repeat(60));
	lines.push('⬢ Stork Sightings — automated daily briefing from tokenstork.com');
	lines.push('Subscribe on Substack: tokenstork.substack.com');

	return lines.join('\n');
}
