// Stork Sightings — Markdown renderer. Produces Substack-optimized
// Markdown and copy-paste-ready HTML (the canonical paste source for
// the Substack editor, matching gmsecurity's pattern).

import type { Briefing, MoverItem } from '../types.js';

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtPct(n: number): string {
	const sign = n > 0 ? '+' : '';
	return `${sign}${n.toFixed(1)}%`;
}

export function renderSubstackMd(b: Briefing): string {
	const date = new Date(b.generatedAt).toISOString().slice(0, 10);
	const time = new Date(b.generatedAt).toISOString().slice(11, 16);

	const lines: string[] = [];
	lines.push(`# ⬢ Stork Sightings — ${date}`);
	lines.push('');
	lines.push(`*Daily BCH token briefing — ${date} ${time} UTC · last ${b.windowHours}h*`);
	lines.push('');

	if (b.executiveSummary) {
		lines.push(b.executiveSummary);
		lines.push('');
	}

	if (b.trends.length > 0) {
		lines.push('## Trends');
		for (const t of b.trends) lines.push(`- ${t.text}`);
		lines.push('');
	}

	if (b.tokenProfile) {
		lines.push('## Token of the Day');
		lines.push(`**${b.tokenProfile.symbol || b.tokenProfile.name}** — ${b.tokenProfile.holderCount} holders · Gini: ${b.tokenProfile.giniTier}`);
		lines.push('');
		lines.push(b.tokenProfile.narrative);
		lines.push('');
	}

	if (b.movers.gainers.length > 0 || b.movers.losers.length > 0) {
		lines.push('## Market Movers (Cauldron)');
		lines.push('');
		if (b.movers.gainers.length > 0) {
			lines.push('| Token | 24h Change |');
			lines.push('|-------|------------|');
			for (const m of b.movers.gainers) lines.push(`| ${m.symbol || m.name} | ↑ ${fmtPct(m.pricePct)} |`);
			lines.push('');
		}
		if (b.movers.losers.length > 0) {
			lines.push('| Token | 24h Change |');
			lines.push('|-------|------------|');
			for (const m of b.movers.losers) lines.push(`| ${m.symbol || m.name} | ↓ ${fmtPct(m.pricePct)} |`);
			lines.push('');
		}
	}

	if (b.newTokens.length > 0) {
		lines.push('## New Tokens');
		lines.push('');
		for (const t of b.newTokens) {
			const cls = t.classification ? ` *(${t.classification.replace(/_/g, ' ')})*` : '';
			lines.push(`- **${t.symbol || '(unnamed)'}**${t.name ? ` — ${t.name}` : ''}${cls} · ${t.holderCount} holders`);
		}
		lines.push('');
	}

	if (b.whaleMoves.length > 0) {
		lines.push('## Holder Distribution Shifts');
		lines.push('');
		for (const w of b.whaleMoves) {
			lines.push(`- **${w.symbol || w.name}**: Gini ${w.giniBefore.toFixed(2)} → ${w.giniAfter.toFixed(2)} (${w.giniDelta > 0 ? '+' : ''}${w.giniDelta.toFixed(2)}) · ${w.holderCountBefore} → ${w.holderCountAfter} holders`);
		}
		lines.push('');
	}

	if (b.bcmrChanges.length > 0) {
		lines.push('## BCMR Changes');
		lines.push('');
		for (const c of b.bcmrChanges) {
			lines.push(`- **[${c.severity}]** ${c.symbol || c.name} — ${c.summary}`);
		}
		lines.push('');
	}

	lines.push('## Ecosystem');
	lines.push('');
	lines.push(`- Total tokens: ${b.ecosystem.totalTokens.toLocaleString()}`);
	lines.push(`- New 24h: ${b.ecosystem.tokensNew24h}`);
	lines.push(`- Token txs 24h: ${b.ecosystem.activity24hTokenTxs.toLocaleString()}`);
	lines.push(`- Mints 24h: ${b.ecosystem.activity24hMints}`);
	lines.push(`- Holders: ${b.ecosystem.holderCount.toLocaleString()}`);
	if (b.ecosystem.medianGini !== null) lines.push(`- Median Gini: ${b.ecosystem.medianGini.toFixed(2)}`);
	if (b.ecosystem.bchGini !== null) lines.push(`- BCH coin Gini: ${b.ecosystem.bchGini.toFixed(2)}`);
	lines.push('');

	if (b.spark) {
		lines.push('> 💡 ' + b.spark);
		lines.push('');
	}

	lines.push('---');
	lines.push('');
	lines.push('⬢ Stork Sightings — automated daily briefing from the [TokenStork](https://tokenstork.com) directory.');
	lines.push('[Subscribe on Substack](https://tokenstork.substack.com)');

	return lines.join('\n');
}

// ---- Substack HTML (copy-paste ready, matches gmsecurity pattern) ----
export function renderSubstackHtml(b: Briefing): string {
	const date = new Date(b.generatedAt).toISOString().slice(0, 10);
	const time = new Date(b.generatedAt).toISOString().slice(11, 16);

	return `<!doctype html><html><head><meta charset="utf-8"><title>Stork Sightings — ${date}</title></head>
<body>
<h1>⬢ Stork Sightings — ${date}</h1>
<p><strong>Daily BCH token briefing</strong></p>
<p>${date} ${time} UTC · last ${b.windowHours}h</p>

${b.executiveSummary ? `<p>${esc(b.executiveSummary)}</p>` : ''}

${b.trends.length > 0 ? `<h2>Trends</h2>\n<ul>\n${b.trends.map((t) => `<li>${esc(t.text)}</li>`).join('\n')}\n</ul>` : ''}

${b.tokenProfile ? `<h2>Token of the Day</h2>\n<p><strong>${esc(b.tokenProfile.symbol || b.tokenProfile.name)}</strong> — ${b.tokenProfile.holderCount} holders · Gini: ${b.tokenProfile.giniTier}</p>\n<p>${esc(b.tokenProfile.narrative)}</p>` : ''}

${b.movers.gainers.length > 0 || b.movers.losers.length > 0 ? `<h2>Market Movers (Cauldron)</h2>\n` + 
  (b.movers.gainers.length > 0 ? `<h3>↑ Gainers</h3>\n<ul>\n${b.movers.gainers.map((m) => `<li><strong>${esc(m.symbol || m.name)}</strong> ${esc(m.name !== m.symbol ? m.name : '')} — ${fmtPct(m.pricePct)}</li>`).join('\n')}\n</ul>\n` : '') +
  (b.movers.losers.length > 0 ? `<h3>↓ Losers</h3>\n<ul>\n${b.movers.losers.map((m) => `<li><strong>${esc(m.symbol || m.name)}</strong> ${esc(m.name !== m.symbol ? m.name : '')} — ${fmtPct(m.pricePct)}</li>`).join('\n')}\n</ul>\n` : '') : ''}

${b.newTokens.length > 0 ? `<h2>New Tokens</h2>\n<ul>\n${b.newTokens.map((t) => `<li><strong>${esc(t.symbol || '(unnamed)')}</strong>${t.name ? ` — ${esc(t.name)}` : ''} ${t.classification ? `<em>(${t.classification.replace(/_/g, ' ')})</em>` : ''} · ${t.holderCount} holders</li>`).join('\n')}\n</ul>` : ''}

${b.whaleMoves.length > 0 ? `<h2>Holder Distribution Shifts</h2>\n<ul>\n${b.whaleMoves.map((w) => `<li><strong>${esc(w.symbol || w.name || '')}</strong>: Gini ${w.giniBefore.toFixed(2)} → ${w.giniAfter.toFixed(2)} (${w.giniDelta > 0 ? '+' : ''}${w.giniDelta.toFixed(2)}) · ${w.holderCountBefore} → ${w.holderCountAfter} holders</li>`).join('\n')}\n</ul>` : ''}

${b.bcmrChanges.length > 0 ? `<h2>BCMR Changes</h2>\n<ul>\n${b.bcmrChanges.map((c) => `<li><strong>[${c.severity}]</strong> ${esc(c.symbol || c.name || '')} — ${esc(c.summary)}</li>`).join('\n')}\n</ul>` : ''}

<h2>Ecosystem</h2>
<ul>
  <li>Total tokens: ${b.ecosystem.totalTokens.toLocaleString()}</li>
  <li>New 24h: ${b.ecosystem.tokensNew24h}</li>
  <li>Token txs 24h: ${b.ecosystem.activity24hTokenTxs.toLocaleString()}</li>
  <li>Mints 24h: ${b.ecosystem.activity24hMints}</li>
  <li>Holders: ${b.ecosystem.holderCount.toLocaleString()}</li>
  ${b.ecosystem.medianGini !== null ? `<li>Median Gini: ${b.ecosystem.medianGini.toFixed(2)}</li>` : ''}
  ${b.ecosystem.bchGini !== null ? `<li>BCH coin Gini: ${b.ecosystem.bchGini.toFixed(2)}</li>` : ''}
</ul>

${b.spark ? `<blockquote>💡 ${esc(b.spark)}</blockquote>` : ''}

<hr>
<p>⬢ Stork Sightings — automated daily briefing from the <a href="https://tokenstork.com">TokenStork</a> directory.<br>
<a href="https://tokenstork.substack.com">Subscribe on Substack</a></p>
</body></html>`;
}
