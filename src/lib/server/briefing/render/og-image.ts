// Stork Sightings — OG image renderer. Produces SVG (and optionally PNG)
// social card for link previews on X, Bluesky, etc.

import type { Briefing } from '../types.js';

export function renderOgImageSvg(b: Briefing): string {
	const date = new Date(b.generatedAt).toISOString().slice(0, 10);
	const e = b.ecosystem;

	const lines: string[] = [];
	lines.push(`${e.totalTokens.toLocaleString()} tokens tracked`);
	if (e.tokensNew24h > 0) lines.push(`${e.tokensNew24h} new today`);
	if (e.activity24hTokenTxs > 0) lines.push(`${e.activity24hTokenTxs.toLocaleString()} token txs 24h`);
	if (b.movers.gainers.length > 0) lines.push(`Top gainer: ${b.movers.gainers[0].symbol || b.movers.gainers[0].name} ${b.movers.gainers[0].pricePct > 0 ? '+' : ''}${b.movers.gainers[0].pricePct.toFixed(1)}%`);
	if (e.bchGini !== null) lines.push(`BCH Gini: ${e.bchGini.toFixed(2)}`);

	const lineHeight = 28;
	const startY = 100;
	const stats = lines.slice(0, 4);

	return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0d9488;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#0f766e;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <text x="60" y="80" font-family="Georgia,'Times New Roman',serif" font-size="48" font-weight="700" fill="#fff">⬢ Stork Sightings</text>
  <text x="60" y="120" font-family="Inter,-apple-system,sans-serif" font-size="22" fill="#ccfbf1" font-style="italic">Daily BCH token briefing — ${date}</text>
  ${stats.map((s, i) => `<text x="60" y="${startY + 40 + i * lineHeight}" font-family="Inter,-apple-system,sans-serif" font-size="26" fill="#f0fdfa">• ${s}</text>`).join('\n  ')}
  <text x="60" y="580" font-family="Inter,-apple-system,sans-serif" font-size="16" fill="#99f6e4">tokenstork.com/briefing</text>
</svg>`;
}
