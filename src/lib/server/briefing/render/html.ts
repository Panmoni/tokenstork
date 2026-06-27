// Stork Sightings — HTML renderer. Produces standalone HTML page and
// email-safe HTML body. TokenStork color palette (green/teal), card-based
// layout. Minimal, scannable, mobile-first.

import type { Briefing, MoverItem, NewTokenItem, WhaleMoveItem, BcmrChangeItem, VoteItem } from '../types.js';

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtPct(n: number): string {
	const sign = n > 0 ? '+' : '';
	return `${sign}${n.toFixed(1)}%`;
}

function giniColor(g: number): string {
	if (g < 0.4) return '#047857';
	if (g < 0.6) return '#2563eb';
	if (g < 0.75) return '#d97706';
	if (g < 0.9) return '#dc2626';
	return '#991b1b';
}

function giniLabel(g: number): string {
	if (g < 0.4) return 'Excellent';
	if (g < 0.6) return 'Good';
	if (g < 0.75) return 'Fair';
	if (g < 0.9) return 'Poor';
	return 'Whale-controlled';
}

function sectionHeader(label: string, count: number): string {
	return `<h2 style="font-size:13px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.4px;margin:24px 0 10px;">${esc(label)} <span style="color:#9ca3af;font-weight:400;">(${count})</span></h2>`;
}

function moverRow(m: MoverItem, showTvl: boolean): string {
	const color = m.pricePct >= 0 ? '#047857' : '#dc2626';
	const arrow = m.pricePct >= 0 ? '↑' : '↓';
	const tvlCell = showTvl && m.tvlPct !== null
		? `<td style="padding:4px 12px;font-size:13px;text-align:right;${m.tvlPct >= 0 ? 'color:#047857' : 'color:#dc2626'}">${m.tvlPct >= 0 ? '+' : ''}${m.tvlPct.toFixed(1)}% TVL</td>`
		: '';

	return `<tr style="border-bottom:1px solid #f1f5f9;">
		<td style="padding:6px 12px 6px 0;font-size:14px;font-weight:600;color:#111;">${esc(m.symbol || m.name)}</td>
		<td style="padding:6px 12px;font-size:13px;color:#64748b;">${esc(m.name !== m.symbol ? m.name : '')}</td>
		<td style="padding:6px 12px;font-size:14px;font-weight:600;text-align:right;color:${color};">${arrow} ${fmtPct(m.pricePct)}</td>
		${tvlCell}
	</tr>`;
}

function moverTable(label: string, items: MoverItem[], showTvl: boolean): string {
	if (items.length === 0) return '';
	return `<div style="margin-bottom:16px;">${sectionHeader(label, items.length)}
		<table style="width:100%;border-collapse:collapse;">
			<thead><tr style="background:#f8fafc;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.3px;">
				<th style="padding:4px 12px 4px 0;text-align:left;">Token</th>
				<th style="padding:4px 12px;text-align:left;"></th>
				<th style="padding:4px 12px;text-align:right;">24h</th>
				${showTvl ? '<th style="padding:4px 12px;text-align:right;">TVL Δ</th>' : ''}
			</tr></thead>
			<tbody>${items.map((m) => moverRow(m, showTvl)).join('')}</tbody>
		</table>
	</div>`;
}

function classBadge(c: string): string {
	const colors: Record<string, string> = {
		fan_token: '#7c3aed', utility: '#2563eb', memecoin: '#db2777',
		nft_collection: '#0891b2', defi: '#059669', gaming: '#ea580c',
		governance: '#4f46e5', stablecoin: '#047857', other: '#6b7280'
	};
	const color = colors[c] ?? '#6b7280';
	return `<span style="color:${color};border:1px solid ${color};border-radius:4px;padding:1px 6px;font-size:9px;font-weight:700;letter-spacing:.3px;">${c.replace(/_/g, ' ')}</span>`;
}

function newTokenRow(t: NewTokenItem): string {
	return `<tr style="border-bottom:1px solid #f1f5f9;">
		<td style="padding:4px 12px 4px 0;font-size:13px;font-weight:600;color:#111;">${esc(t.symbol || '(unnamed)')}</td>
		<td style="padding:4px 12px;font-size:12px;color:#64748b;">${esc(t.name ?? '')}</td>
		<td style="padding:4px 12px;font-size:11px;">${classBadge(t.classification ?? 'other')}</td>
		<td style="padding:4px 12px;font-size:11px;color:#9ca3af;">${t.holderCount} holders</td>
	</tr>`;
}

function giniBar(g: number): string {
	const pct = Math.round(g * 100);
	const color = giniColor(g);
	return `<div style="display:flex;align-items:center;gap:8px;">
		<div style="flex:1;height:6px;background:#e2e8f0;border-radius:3px;">
			<div style="height:6px;width:${pct}%;background:${color};border-radius:3px;"></div>
		</div>
		<span style="font-size:11px;font-weight:600;color:${color};">${g.toFixed(2)}</span>
	</div>`;
}

export function renderBriefingHtml(b: Briefing): string {
	const date = new Date(b.generatedAt).toISOString().slice(0, 10);
	const time = new Date(b.generatedAt).toISOString().slice(11, 16);

	return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stork Sightings — ${date}</title>
<meta name="description" content="${esc(b.executiveSummary.slice(0, 160))}">
<style>
  body { margin:0; background:#f8fafc; font-family:Inter,-apple-system,Segoe UI,Roboto,Helvetica,sans-serif; color:#1e293b; }
  .wrap { max-width:680px; margin:0 auto; padding:28px 20px 40px; }
  .masthead { border-bottom:3px solid #0d9488; padding-bottom:12px; margin-bottom:20px; }
  .masthead h1 { font-family:Georgia,'Times New Roman',serif; font-size:22px; font-weight:700; color:#0f766e; margin:0; letter-spacing:-.3px; }
  .masthead p { margin:4px 0 0; font-size:12px; color:#64748b; font-style:italic; }
  .statbar { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:20px; }
  .stat { background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:8px 14px; font-size:12px; }
  .stat strong { display:block; font-size:18px; color:#0f766e; }
  .stat span { color:#64748b; }
  .summary { background:#f0fdfa; border-left:3px solid #0d9488; border-radius:0 8px 8px 0; padding:14px 18px; margin-bottom:20px; font-size:14px; line-height:1.6; color:#134e4a; }
  .card { background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:18px; margin-bottom:16px; }
  .card h3 { font-size:14px; font-weight:700; color:#0f766e; margin:0 0 10px; }
  .trends { list-style:none; padding:0; margin:0; }
  .trends li { padding:4px 0; font-size:13px; color:#374151; }
  .trends li::before { content:'• '; color:#0d9488; font-weight:700; }
  .spark { background:#fffbeb; border-left:3px solid #f59e0b; border-radius:0 6px 6px 0; padding:12px 16px; margin-top:8px; font-size:12px; color:#92400e; }
  .profile { background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:18px; margin-bottom:16px; }
  .profile h3 { font-size:15px; font-weight:700; color:#047857; margin:0 0 8px; }
  .profile p { margin:0; font-size:13px; line-height:1.6; color:#374151; }
  .footer { margin-top:32px; padding-top:16px; border-top:1px solid #e2e8f0; text-align:center; font-size:11px; color:#94a3b8; }
  .footer a { color:#0f766e; text-decoration:none; }
  table { width:100%; border-collapse:collapse; }
  @media (max-width:600px) { .wrap { padding:16px 12px 24px; } }
</style></head><body>
<div class="wrap">
  <div class="masthead">
    <h1>⬢ Stork Sightings</h1>
    <p>Daily BCH token briefing — ${date} ${time} UTC · last ${b.windowHours}h</p>
  </div>

  ${buildStatbar(b)}

  ${b.executiveSummary ? `<div class="summary">${esc(b.executiveSummary)}</div>` : ''}

  ${b.trends.length > 0 ? `<div class="card"><h3>Trends</h3><ul class="trends">${b.trends.map((t) => `<li>${esc(t.text)}</li>`).join('')}</ul></div>` : ''}

  ${b.tokenProfile ? `<div class="profile"><h3>Token of the Day: ${esc(b.tokenProfile.symbol || b.tokenProfile.name)}</h3><p>${esc(b.tokenProfile.narrative)}</p></div>` : ''}

  ${b.movers.gainers.length > 0 || b.movers.losers.length > 0 ? `<div class="card"><h3>Market Movers (Cauldron)</h3>
    ${moverTable('Top Gainers', b.movers.gainers, false)}
    ${moverTable('Top Losers', b.movers.losers, false)}
    ${b.movers.tvlMovers.length > 0 ? moverTable('TVL Swings', b.movers.tvlMovers.slice(0,5), true) : ''}
  </div>` : ''}

  ${b.newTokens.length > 0 ? `<div class="card"><h3>New Tokens</h3>
    <table><tbody>${b.newTokens.map(newTokenRow).join('')}</tbody></table>
  </div>` : ''}

  ${b.whaleMoves.length > 0 ? `<div class="card"><h3>Holder Shifts</h3>
    ${b.whaleMoves.map((w) => `<div style="margin-bottom:10px;">
      <div style="font-size:13px;font-weight:600;color:#111;margin-bottom:3px;">${esc(w.symbol || w.name || '')}</div>
      <div style="font-size:11px;color:#64748b;">Gini: ${w.giniBefore.toFixed(2)} → ${w.giniAfter.toFixed(2)} <span style="color:${w.giniDelta > 0 ? '#dc2626' : '#047857'};">(${w.giniDelta > 0 ? '+' : ''}${w.giniDelta.toFixed(2)})</span> · ${w.holderCountBefore} → ${w.holderCountAfter} holders</div>
      ${giniBar(w.giniAfter)}
    </div>`).join('')}
  </div>` : ''}

  ${b.bcmrChanges.length > 0 ? `<div class="card"><h3>BCMR Changes</h3>
    ${b.bcmrChanges.map((c) => `<div style="margin-bottom:8px;font-size:12px;">
      <span style="font-weight:600;color:${c.severity === 'critical' ? '#dc2626' : c.severity === 'warning' ? '#d97706' : '#6b7280'};">[${c.severity}]</span>
      ${esc(c.symbol || c.name || '')} — ${esc(c.summary)}
    </div>`).join('')}
  </div>` : ''}

  ${b.votes.length > 0 ? `<div class="card"><h3>Community Pulse</h3>
    ${b.votes.map((v) => `<div style="margin-bottom:6px;font-size:12px;">
      <span style="font-weight:600;">${esc(v.symbol || v.name || '')}</span>
      <span style="color:#047857;margin-left:8px;">▲ ${v.upvotes}</span>
      <span style="color:#dc2626;margin-left:4px;">▼ ${v.downvotes}</span>
      ${v.controversial ? '<span style="color:#d97706;margin-left:8px;">⚡ controversial</span>' : ''}
    </div>`).join('')}
  </div>` : ''}

  <div class="card"><h3>Ecosystem</h3>
    <div class="statbar">
      <div class="stat"><strong>${b.ecosystem.totalTokens.toLocaleString()}</strong><span>total tokens</span></div>
      <div class="stat"><strong>${b.ecosystem.tokensNew24h}</strong><span>new 24h</span></div>
      <div class="stat"><strong>${b.ecosystem.activity24hTokenTxs.toLocaleString()}</strong><span>token txs 24h</span></div>
      <div class="stat"><strong>${b.ecosystem.activity24hMints}</strong><span>mints 24h</span></div>
      <div class="stat"><strong>${b.ecosystem.holderCount.toLocaleString()}</strong><span>holders</span></div>
      ${b.ecosystem.medianGini !== null ? `<div class="stat"><strong>${b.ecosystem.medianGini.toFixed(2)}</strong><span>median Gini</span></div>` : ''}
      ${b.ecosystem.bchGini !== null ? `<div class="stat"><strong>${b.ecosystem.bchGini.toFixed(2)}</strong><span>BCH Gini</span></div>` : ''}
    </div>
  </div>

  ${b.spark ? `<div class="spark">💡 ${esc(b.spark)}</div>` : ''}

  <div class="footer">
    ⬢ Stork Sightings — automated daily briefing from the TokenStork directory.<br>
    <a href="https://tokenstork.com">tokenstork.com</a> · <a href="https://tokenstork.substack.com">Subscribe on Substack</a>
  </div>
</div></body></html>`;
}

function buildStatbar(b: Briefing): string {
	const items: string[] = [];
	if (b.movers.gainers.length > 0) items.push(`<div class="stat"><strong>${b.movers.gainers.length}</strong><span>gainers</span></div>`);
	if (b.movers.losers.length > 0) items.push(`<div class="stat"><strong>${b.movers.losers.length}</strong><span>losers</span></div>`);
	if (b.newTokens.length > 0) items.push(`<div class="stat"><strong>${b.newTokens.length}</strong><span>new tokens</span></div>`);
	if (b.whaleMoves.length > 0) items.push(`<div class="stat"><strong>${b.whaleMoves.length}</strong><span>holder shifts</span></div>`);
	if (b.bcmrChanges.length > 0) items.push(`<div class="stat"><strong>${b.bcmrChanges.length}</strong><span>BCMR changes</span></div>`);
	return items.length > 0 ? `<div class="statbar">${items.join('')}</div>` : '';
}

// ---- Email HTML (inline styles, same structure) ----
export function renderEmailHtml(b: Briefing): string {
	return renderBriefingHtml(b);
}
