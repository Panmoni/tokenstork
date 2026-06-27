<script lang="ts">
	import type { Briefing } from '$lib/server/briefing/types';

	interface Props { briefing: Briefing; archiveEntries?: Array<{ slug: string; date: string; time: string }>; }
	let { briefing: b, archiveEntries = [] }: Props = $props();

	const date = $derived(new Date(b.generatedAt).toISOString().slice(0, 10));
	const time = $derived(new Date(b.generatedAt).toISOString().slice(11, 16));
	const shareUrl = $derived('https://tokenstork.com/briefing');
	const shareText = $derived(`Stork Sightings — ${date}`);

	let copied = $state(false);
	function copyLink() { navigator.clipboard.writeText(shareUrl).then(() => { copied = true; setTimeout(() => copied = false, 2000); }); }

	const fmtNum = (n: number) => n.toLocaleString();
	function fmtPct(n: number) { return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`; }
	function giniLabel(g: number) {
		return g < 0.4 ? 'Excellent' : g < 0.6 ? 'Good' : g < 0.75 ? 'Fair' : g < 0.9 ? 'Poor' : 'Whale-controlled';
	}
	function giniColorClass(g: number) {
		return g < 0.4 ? 'text-emerald-600' : g < 0.6 ? 'text-blue-600' : g < 0.75 ? 'text-amber-600' : g < 0.9 ? 'text-red-600' : 'text-red-800';
	}

	// Filter out truly unnamed tokens (no name, no symbol)
	const namedNewTokens = $derived(b.newTokens.filter(t => t.name || t.symbol));
	const unnamedCount = $derived(b.newTokens.length - namedNewTokens.length);
</script>

<div class="max-w-3xl mx-auto py-10 px-4 sm:px-6">
	<!-- Page title and description -->
	<h1 class="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
		⬢ Stork Sightings
	</h1>
	<p class="mt-2 text-sm ts-text-muted italic leading-relaxed">
		Daily BCH token briefing — {date} {time} UTC · last {b.windowHours}h window.
		{b.ecosystem.totalTokens > 0 ? `${fmtNum(b.ecosystem.totalTokens)} tokens tracked across ${fmtNum(b.ecosystem.holderCount)} holders.` : ''}
		<a href="#archive" class="text-emerald-600 hover:underline ml-2">Archive ↓</a>
	</p>

	<!-- Executive Summary -->
	{#if b.executiveSummary}
		<p class="mt-6 text-base text-slate-700 dark:text-slate-300 leading-relaxed">
			{b.executiveSummary}
		</p>
	{/if}

	<!-- Trends -->
	{#if b.trends.length > 0}
		<div class="mt-5 space-y-1.5">
			{#each b.trends as t}
				<p class="text-sm text-slate-600 dark:text-slate-400">• {t.text}</p>
			{/each}
		</div>
	{/if}

	<!-- Ecosystem at a glance -->
	<div class="mt-8 text-sm text-slate-600 dark:text-slate-400 space-y-1 border-t ts-border-subtle pt-5">
		<p>
			<b class="text-slate-900 dark:text-white">{fmtNum(b.ecosystem.totalTokens)}</b> tokens tracked ·
			<b class="text-slate-900 dark:text-white">{b.ecosystem.tokensNew24h}</b> new in 24h ·
			<b class="text-slate-900 dark:text-white">{fmtNum(b.ecosystem.activity24hTokenTxs)}</b> token txs 24h ·
			<b class="text-slate-900 dark:text-white">{b.ecosystem.activity24hMints}</b> mints ·
			<b class="text-slate-900 dark:text-white">{fmtNum(b.ecosystem.holderCount)}</b> holders ·
			<b class="text-slate-900 dark:text-white">{fmtNum(b.ecosystem.listingsCauldron)}</b> on Cauldron
			{#if b.ecosystem.medianGini !== null} · median Gini <b class="text-slate-900 dark:text-white">{b.ecosystem.medianGini.toFixed(2)}</b>{/if}
			{#if b.ecosystem.bchGini !== null} · BCH Gini <b class="text-slate-900 dark:text-white">{b.ecosystem.bchGini.toFixed(2)}</b>{/if}
		</p>
	</div>

	<!-- Token of the Day -->
	{#if b.tokenProfile}
		<div class="mt-8 border-t ts-border-subtle pt-5">
			<h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-2">
				Token of the Day: <a href="/token/{b.tokenProfile.categoryHex}" class="text-emerald-600 hover:underline">{b.tokenProfile.symbol || b.tokenProfile.name}</a>
			</h2>
			<p class="text-xs ts-text-muted mb-2">{fmtNum(b.tokenProfile.holderCount)} holders · Gini: {b.tokenProfile.giniTier}</p>
			<p class="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{b.tokenProfile.narrative}</p>
		</div>
	{/if}

	<!-- Market Movers -->
	{#if b.movers.gainers.length > 0 || b.movers.losers.length > 0}
		<div class="mt-8 border-t ts-border-subtle pt-5">
			<h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-3">Market Movers <span class="text-sm font-normal text-slate-400">(Cauldron, 24h)</span></h2>
			<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
				{#if b.movers.gainers.length > 0}
					<div>
						<h3 class="text-sm font-semibold text-emerald-600 mb-2">Gainers</h3>
						<div class="space-y-1.5">
							{#each b.movers.gainers as m}
								<a href="/token/{m.categoryHex}" class="flex items-center justify-between no-underline hover:opacity-80 text-sm">
									<span class="font-semibold text-slate-900 dark:text-white">{m.symbol || m.name}</span>
									<span class="font-mono text-emerald-600">↑ {fmtPct(m.pricePct)}</span>
								</a>
							{/each}
						</div>
					</div>
				{/if}
				{#if b.movers.losers.length > 0}
					<div>
						<h3 class="text-sm font-semibold text-red-600 mb-2">Losers</h3>
						<div class="space-y-1.5">
							{#each b.movers.losers as m}
								<a href="/token/{m.categoryHex}" class="flex items-center justify-between no-underline hover:opacity-80 text-sm">
									<span class="font-semibold text-slate-900 dark:text-white">{m.symbol || m.name}</span>
									<span class="font-mono text-red-600">↓ {fmtPct(m.pricePct)}</span>
								</a>
							{/each}
						</div>
					</div>
				{/if}
			</div>
			{#if b.movers.tvlMovers.length > 0}
				<div class="mt-3">
					<h3 class="text-sm font-semibold text-slate-500 mb-1.5">TVL Swings</h3>
					<div class="space-y-1">
						{#each b.movers.tvlMovers.slice(0, 5) as m}
							<a href="/token/{m.categoryHex}" class="flex items-center justify-between no-underline hover:opacity-80 text-sm">
								<span class="font-semibold text-slate-900 dark:text-white">{m.symbol || m.name}</span>
								<span class="font-mono {m.tvlPct && m.tvlPct >= 0 ? 'text-emerald-600' : 'text-red-600'}">
									{m.tvlPct && m.tvlPct >= 0 ? '↑' : '↓'} {m.tvlPct ? fmtPct(m.tvlPct) : '—'} TVL
								</span>
							</a>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- New Tokens -->
	<div class="mt-8 border-t ts-border-subtle pt-5">
		<h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-2">New Tokens <span class="text-sm font-normal text-slate-400">(last {b.windowHours}h)</span></h2>
		{#if namedNewTokens.length > 0}
			<div class="space-y-1.5">
				{#each namedNewTokens as t}
					<a href="/token/{t.categoryHex}" class="flex items-center justify-between no-underline hover:opacity-80 text-sm">
						<span>
							<span class="font-semibold text-slate-900 dark:text-white">{t.symbol || t.name}</span>
							{#if t.name && t.symbol !== t.name}<span class="text-slate-500 ml-1.5">{t.name}</span>{/if}
						</span>
						<span class="text-xs ts-text-muted">{fmtNum(t.holderCount)} holders</span>
					</a>
				{/each}
			</div>
		{/if}
		{#if unnamedCount > 0}
			<p class="text-sm ts-text-muted mt-1">{unnamedCount} additional token{unnamedCount === 1 ? '' : 's'} minted without BCMR metadata (no name or symbol yet).</p>
		{/if}
		{#if b.newTokens.length === 0}
			<p class="text-sm ts-text-muted">No new tokens in the window.</p>
		{/if}
	</div>

	<!-- Holder Concentration Watch (formerly whale moves) -->
	{#if b.whaleMoves.length > 0}
		<div class="mt-8 border-t ts-border-subtle pt-5">
			<h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-3">Concentration Watch</h2>
			<p class="text-sm ts-text-muted mb-3">Tokens with the highest Gini coefficients — most concentrated holder distribution.</p>
			<div class="space-y-2">
				{#each b.whaleMoves as w}
					<a href="/token/{w.categoryHex}" class="flex items-center justify-between no-underline hover:opacity-80 text-sm">
						<div>
							<span class="font-semibold text-slate-900 dark:text-white">{w.symbol || w.name}</span>
							<span class="text-xs ts-text-muted ml-2">{fmtNum(w.holderCountAfter)} holders</span>
						</div>
						<div class="flex items-center gap-2">
							<div class="w-16 h-1.5 bg-slate-200 dark:bg-zinc-700 rounded-full overflow-hidden">
								<div class="h-full rounded-full {giniColorClass(w.giniAfter).replace('text-', 'bg-')}" style="width:{Math.min(100, Math.round(w.giniAfter * 100))}%"></div>
							</div>
							<span class="text-xs font-mono {giniColorClass(w.giniAfter)}">{w.giniAfter.toFixed(2)} — {giniLabel(w.giniAfter)}</span>
						</div>
					</a>
				{/each}
			</div>
		</div>
	{/if}

	<!-- BCMR Changes -->
	{#if b.bcmrChanges.length > 0}
		<div class="mt-8 border-t ts-border-subtle pt-5">
			<h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-3">BCMR Activity</h2>
			<div class="space-y-1.5">
				{#each b.bcmrChanges as c}
					<p class="text-sm">
						<span class="font-semibold {c.severity === 'critical' ? 'text-red-600' : c.severity === 'warning' ? 'text-amber-600' : 'text-slate-500'}">[{c.severity}]</span>
						<span class="font-medium text-slate-900 dark:text-white">{c.symbol || c.name}</span>
						<span class="text-slate-500">— {c.summary}</span>
					</p>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Community Pulse -->
	{#if b.votes.length > 0}
		<div class="mt-8 border-t ts-border-subtle pt-5">
			<h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-3">Community Pulse</h2>
			<div class="space-y-1.5">
				{#each b.votes as v}
					<a href="/token/{v.categoryHex}" class="flex items-center justify-between no-underline hover:opacity-80 text-sm">
						<span class="font-semibold text-slate-900 dark:text-white">{v.symbol || v.name}</span>
						<span class="text-xs">
							<span class="text-emerald-600">▲{v.upvotes}</span>
							<span class="text-red-600 ml-2">▼{v.downvotes}</span>
							{#if v.controversial}<span class="text-amber-600 ml-1 font-medium">⚡</span>{/if}
						</span>
					</a>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Spark -->
	{#if b.spark}
		<p class="mt-8 text-sm text-slate-600 dark:text-slate-400 italic border-t ts-border-subtle pt-5">💡 {b.spark}</p>
	{/if}

	<!-- Share + Links -->
	<div class="mt-10 border-t ts-border-subtle pt-5">
		<div class="flex flex-wrap items-center gap-3 mb-3">
			<span class="text-xs font-semibold uppercase tracking-wider ts-text-muted">Share</span>
			<a href="https://x.com/intent/tweet?text={encodeURIComponent(shareText)}&url={encodeURIComponent(shareUrl)}" target="_blank" rel="noopener" class="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white">X</a>
			<a href="https://bsky.app/intent/compose?text={encodeURIComponent(shareText + ' ' + shareUrl)}" target="_blank" rel="noopener" class="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white">Bluesky</a>
			<a href="https://www.reddit.com/r/BCHCashTokens/submit?url={encodeURIComponent(shareUrl)}&title={encodeURIComponent(shareText)}" target="_blank" rel="noopener" class="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white">Reddit</a>
			<button onclick={copyLink} class="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer bg-transparent border-0 p-0">
				{copied ? 'Copied!' : 'Copy link'}
			</button>
		</div>
		<div class="flex flex-wrap items-center gap-3">
			<span class="text-xs font-semibold uppercase tracking-wider ts-text-muted">Data</span>
			<a href="/briefing/briefing.json" class="text-xs ts-text-muted hover:text-slate-900 dark:hover:text-white">JSON</a>
			<a href="/briefing/briefing.txt" class="text-xs ts-text-muted hover:text-slate-900 dark:hover:text-white">Text</a>
			<a href="/briefing/briefing.md" class="text-xs ts-text-muted hover:text-slate-900 dark:hover:text-white">Markdown</a>
			<a href="/briefing/briefing.substack.html" class="text-xs ts-text-muted hover:text-slate-900 dark:hover:text-white">Substack HTML</a>
		</div>
	</div>

	<!-- Archive section (on same page) -->
	<div id="archive" class="mt-12 border-t ts-border-subtle pt-6">
		<h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-3">Archive</h2>
		{#if archiveEntries.length > 0}
			<div class="space-y-1">
				{#each archiveEntries as entry}
					<a href="/briefing/archive/{entry.slug}" class="flex items-center justify-between no-underline hover:opacity-80 text-sm py-1.5 border-b ts-border-subtle last:border-b-0">
						<span class="font-semibold text-slate-900 dark:text-white">{entry.date}</span>
						<span class="text-xs ts-text-muted">{entry.time} UTC</span>
					</a>
				{/each}
			</div>
		{:else}
			<p class="text-sm ts-text-muted">No past editions yet. The first briefing runs at 11:00 UTC daily.</p>
		{/if}
	</div>

	<p class="mt-8 text-xs ts-text-muted">
		⬢ Stork Sightings — automated daily briefing from the <a href="/" class="text-emerald-600 hover:underline">TokenStork</a> directory.
		<a href="https://tokenstork.substack.com" target="_blank" rel="noopener" class="text-emerald-600 hover:underline">Subscribe on Substack</a>.
	</p>
</div>
