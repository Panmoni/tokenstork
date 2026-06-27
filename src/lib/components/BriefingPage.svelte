<script lang="ts">
	import type { Briefing } from '$lib/server/briefing/types';

	interface Props { briefing: Briefing; isArchive?: boolean; slug?: string; }
	let { briefing: b, isArchive = false, slug = '' }: Props = $props();

	const date = $derived(new Date(b.generatedAt).toISOString().slice(0, 10));
	const time = $derived(new Date(b.generatedAt).toISOString().slice(11, 16));
	const shareUrl = $derived(isArchive ? `https://tokenstork.com/briefing/archive/${slug}` : 'https://tokenstork.com/briefing');
	const shareText = $derived(`Stork Sightings — ${date}`);

	let copied = $state(false);
	function copyLink() { navigator.clipboard.writeText(shareUrl).then(() => { copied = true; setTimeout(() => copied = false, 2000); }); }

	const fmtNum = (n: number) => n.toLocaleString();
	function fmtPct(n: number) { return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`; }
	function classBadge(c: string) {
		const m: Record<string, string> = {
			fan_token:'bg-purple-100 text-purple-700', utility:'bg-blue-100 text-blue-700', memecoin:'bg-pink-100 text-pink-700',
			nft_collection:'bg-cyan-100 text-cyan-700', defi:'bg-emerald-100 text-emerald-700', gaming:'bg-orange-100 text-orange-700',
			governance:'bg-indigo-100 text-indigo-700', stablecoin:'bg-green-100 text-green-700', other:'bg-slate-100 text-slate-600'
		}; return m[c] ?? m.other;
	}
	function giniBar(g: number) {
		const colors = ['bg-emerald-500','bg-blue-500','bg-amber-500','bg-red-500','bg-red-700'];
		const idx = g < 0.4 ? 0 : g < 0.6 ? 1 : g < 0.75 ? 2 : g < 0.9 ? 3 : 4;
		return `bg-emerald-500 ${g < 0.4 ? '' : g < 0.6 ? 'bg-blue-500' : g < 0.75 ? 'bg-amber-500' : g < 0.9 ? 'bg-red-500' : 'bg-red-700'}`;
	}
	function giniLabel(g: number) {
		return g < 0.4 ? 'Excellent' : g < 0.6 ? 'Good' : g < 0.75 ? 'Fair' : g < 0.9 ? 'Poor' : 'Whale-controlled';
	}
</script>

<div class="max-w-3xl mx-auto py-10 px-4 sm:px-6">
	<!-- Masthead -->
	<div class="mb-10 pb-6 border-b ts-border-subtle">
		<h1 class="font-serif text-3xl font-bold text-emerald-700 dark:text-emerald-400 tracking-tight">
			⬢ Stork Sightings
		</h1>
		<p class="mt-1 text-sm ts-text-muted italic">
			Daily BCH token briefing — {date} {time} UTC · last {b.windowHours}h
			{#if isArchive}<span class="ml-2 text-xs bg-slate-100 dark:bg-zinc-800 px-2 py-0.5 rounded">Archived</span>{/if}
		</p>
	</div>

	<!-- Executive Summary -->
	{#if b.executiveSummary}
		<div class="bg-emerald-50 dark:bg-emerald-950 border-l-4 border-emerald-500 rounded-r-lg p-5 mb-8 text-sm leading-relaxed text-emerald-900 dark:text-emerald-200">
			{b.executiveSummary}
		</div>
	{/if}

	<!-- Trends -->
	{#if b.trends.length > 0}
		<section class="mb-8">
			<h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-3">Trends</h2>
			<ul class="space-y-1.5">
				{#each b.trends as t}
					<li class="text-sm text-slate-700 dark:text-slate-300 flex gap-2">
						<span class="text-emerald-500 shrink-0">•</span> {t.text}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- Token of the Day -->
	{#if b.tokenProfile}
		<section class="mb-8 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/50 p-5">
			<h2 class="text-base font-semibold text-emerald-700 dark:text-emerald-400 mb-2">
				Token of the Day: {b.tokenProfile.symbol || b.tokenProfile.name}
			</h2>
			<div class="flex flex-wrap gap-3 mb-2 text-xs ts-text-muted">
				<span>{fmtNum(b.tokenProfile.holderCount)} holders</span> <span>·</span>
				<span>Gini: {b.tokenProfile.giniTier}</span>
				{#if b.tokenProfile.venues.length > 0}<span>·</span><span>{b.tokenProfile.venues.join(', ')}</span>{/if}
			</div>
			<p class="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{b.tokenProfile.narrative}</p>
		</section>
	{/if}

	<!-- Market Movers -->
	{#if b.movers.gainers.length > 0 || b.movers.losers.length > 0}
		<section class="mb-8">
			<h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-3">Market Movers <span class="text-xs font-normal text-slate-400">(Cauldron)</span></h2>
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				{#if b.movers.gainers.length > 0}
					<div class="rounded-xl border ts-border-subtle ts-surface-panel p-4">
						<h3 class="text-xs font-semibold uppercase tracking-wider text-emerald-600 mb-3">Top Gainers</h3>
						<div class="space-y-2">
							{#each b.movers.gainers as m}
								<a href="/token/{m.categoryHex}" class="flex items-center justify-between no-underline hover:opacity-80">
									<div><span class="text-sm font-semibold text-slate-900 dark:text-white">{m.symbol || m.name}</span>
									{#if m.name !== m.symbol && m.name}<span class="text-xs ts-text-muted ml-1.5">{m.name}</span>{/if}</div>
									<span class="text-sm font-semibold text-emerald-600">↑ {fmtPct(m.pricePct)}</span>
								</a>
							{/each}
						</div>
					</div>
				{/if}
				{#if b.movers.losers.length > 0}
					<div class="rounded-xl border ts-border-subtle ts-surface-panel p-4">
						<h3 class="text-xs font-semibold uppercase tracking-wider text-red-600 mb-3">Top Losers</h3>
						<div class="space-y-2">
							{#each b.movers.losers as m}
								<a href="/token/{m.categoryHex}" class="flex items-center justify-between no-underline hover:opacity-80">
									<div><span class="text-sm font-semibold text-slate-900 dark:text-white">{m.symbol || m.name}</span>
									{#if m.name !== m.symbol && m.name}<span class="text-xs ts-text-muted ml-1.5">{m.name}</span>{/if}</div>
									<span class="text-sm font-semibold text-red-600">↓ {fmtPct(m.pricePct)}</span>
								</a>
							{/each}
						</div>
					</div>
				{/if}
			</div>
			{#if b.movers.tvlMovers.length > 0}
				<div class="mt-4 rounded-xl border ts-border-subtle ts-surface-panel p-4">
					<h3 class="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">TVL Swings</h3>
					<div class="space-y-2">
						{#each b.movers.tvlMovers.slice(0, 5) as m}
							<a href="/token/{m.categoryHex}" class="flex items-center justify-between no-underline hover:opacity-80">
								<span class="text-sm font-semibold text-slate-900 dark:text-white">{m.symbol || m.name}</span>
								<span class="text-sm font-semibold {m.tvlPct && m.tvlPct >= 0 ? 'text-emerald-600' : 'text-red-600'}">
									{m.tvlPct && m.tvlPct >= 0 ? '↑' : '↓'} {m.tvlPct ? fmtPct(m.tvlPct) : '—'} TVL
								</span>
							</a>
						{/each}
					</div>
				</div>
			{/if}
		</section>
	{/if}

	<!-- New Tokens -->
	{#if b.newTokens.length > 0}
		<section class="mb-8">
			<h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-3">New Tokens</h2>
			<div class="rounded-xl border ts-border-subtle ts-surface-panel divide-y ts-border-subtle">
				{#each b.newTokens as t}
					<a href="/token/{t.categoryHex}" class="flex items-center gap-3 px-4 py-3 no-underline hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition-colors">
						<div class="flex-1 min-w-0">
							<span class="text-sm font-semibold text-slate-900 dark:text-white">{t.symbol || '(unnamed)'}</span>
							{#if t.name}<span class="text-xs ts-text-muted ml-1.5">{t.name}</span>{/if}
						</div>
						{#if t.classification && t.classification !== 'other'}
							<span class="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded {classBadge(t.classification)}">{t.classification.replace(/_/g, ' ')}</span>
						{/if}
						<span class="text-xs ts-text-muted">{fmtNum(t.holderCount)} holders</span>
					</a>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Holder Shifts -->
	{#if b.whaleMoves.length > 0}
		<section class="mb-8">
			<h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-3">Holder Distribution Shifts</h2>
			<div class="space-y-3">
				{#each b.whaleMoves as w}
					<a href="/token/{w.categoryHex}" class="block rounded-xl border ts-border-subtle ts-surface-panel p-4 no-underline hover:shadow-sm transition-shadow">
						<div class="flex items-baseline justify-between mb-1">
							<span class="text-sm font-semibold text-slate-900 dark:text-white">{w.symbol || w.name}</span>
							<span class="text-xs {w.giniDelta > 0 ? 'text-red-600' : 'text-emerald-600'}">
								Gini {w.giniBefore.toFixed(2)} → {w.giniAfter.toFixed(2)} ({w.giniDelta > 0 ? '+' : ''}{w.giniDelta.toFixed(2)})
							</span>
						</div>
						<div class="text-xs ts-text-muted">{fmtNum(w.holderCountBefore)} → {fmtNum(w.holderCountAfter)} holders</div>
						<div class="mt-1.5 h-1.5 bg-slate-200 dark:bg-zinc-700 rounded-full overflow-hidden">
							<div class="h-full rounded-full {giniBar(w.giniAfter)}" style="width:{Math.min(100, Math.round(w.giniAfter * 100))}%"></div>
						</div>
					</a>
				{/each}
			</div>
		</section>
	{/if}

	<!-- BCMR Changes -->
	{#if b.bcmrChanges.length > 0}
		<section class="mb-8">
			<h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-3">BCMR Changes</h2>
			<div class="rounded-xl border ts-border-subtle ts-surface-panel divide-y ts-border-subtle">
				{#each b.bcmrChanges as c}
					<div class="px-4 py-2.5 text-sm">
						<span class="font-semibold {c.severity === 'critical' ? 'text-red-600' : c.severity === 'warning' ? 'text-amber-600' : 'text-slate-500'} mr-1">[{c.severity}]</span>
						<span class="text-slate-900 dark:text-white font-medium">{c.symbol || c.name}</span>
						<span class="text-slate-500"> — {c.summary}</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Community Pulse -->
	{#if b.votes.length > 0}
		<section class="mb-8">
			<h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-3">Community Pulse</h2>
			<div class="rounded-xl border ts-border-subtle ts-surface-panel divide-y ts-border-subtle">
				{#each b.votes as v}
					<a href="/token/{v.categoryHex}" class="flex items-center justify-between px-4 py-2.5 no-underline hover:bg-slate-50 dark:hover:bg-zinc-800/50">
						<span class="text-sm font-semibold text-slate-900 dark:text-white">{v.symbol || v.name}</span>
						<div class="flex items-center gap-3 text-xs">
							<span class="text-emerald-600">▲ {v.upvotes}</span>
							<span class="text-red-600">▼ {v.downvotes}</span>
							{#if v.controversial}<span class="text-amber-600 font-medium">⚡</span>{/if}
						</div>
					</a>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Ecosystem -->
	<section class="mb-8 rounded-xl border ts-border-subtle ts-surface-panel p-5">
		<h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-4">Ecosystem</h2>
		<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
			<div><span class="block text-2xl font-bold text-emerald-600">{fmtNum(b.ecosystem.totalTokens)}</span><span class="text-xs ts-text-muted">total tokens</span></div>
			<div><span class="block text-2xl font-bold text-emerald-600">{b.ecosystem.tokensNew24h}</span><span class="text-xs ts-text-muted">new 24h</span></div>
			<div><span class="block text-2xl font-bold text-emerald-600">{fmtNum(b.ecosystem.activity24hTokenTxs)}</span><span class="text-xs ts-text-muted">token txs 24h</span></div>
			<div><span class="block text-2xl font-bold text-emerald-600">{b.ecosystem.activity24hMints}</span><span class="text-xs ts-text-muted">mints 24h</span></div>
			<div><span class="block text-2xl font-bold text-emerald-600">{fmtNum(b.ecosystem.holderCount)}</span><span class="text-xs ts-text-muted">holders</span></div>
			<div><span class="block text-2xl font-bold text-emerald-600">{fmtNum(b.ecosystem.listingsCauldron)}</span><span class="text-xs ts-text-muted">on Cauldron</span></div>
			{#if b.ecosystem.medianGini !== null}
				<div><span class="block text-2xl font-bold text-emerald-600">{b.ecosystem.medianGini.toFixed(2)}</span><span class="text-xs ts-text-muted">median Gini</span></div>
			{/if}
			{#if b.ecosystem.bchGini !== null}
				<div><span class="block text-2xl font-bold text-emerald-600">{b.ecosystem.bchGini.toFixed(2)}</span><span class="text-xs ts-text-muted">BCH Gini</span></div>
			{/if}
		</div>
	</section>

	<!-- Spark -->
	{#if b.spark}
		<div class="bg-amber-50 dark:bg-amber-950 border-l-4 border-amber-400 rounded-r-lg p-4 mb-8 text-sm text-amber-800 dark:text-amber-200">
			💡 {b.spark}
		</div>
	{/if}

	<!-- Share + Data links -->
	<div class="border-t ts-border-subtle pt-6 mt-10">
		<div class="flex flex-wrap items-center gap-3 mb-4">
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
			{#if isArchive}
				<a href="/briefing/archive/briefing-{slug}.json" class="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white">JSON</a>
			{:else}
				<a href="/briefing/briefing.json" class="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white">JSON</a>
				<a href="/briefing/briefing.txt" class="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white">Text</a>
				<a href="/briefing/briefing.md" class="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white">Markdown</a>
			{/if}
		</div>
		<p class="mt-6 text-xs ts-text-muted">
			⬢ Stork Sightings — automated daily briefing from the <a href="/" class="text-emerald-600 hover:underline">TokenStork</a> directory.
			<a href="https://tokenstork.substack.com" class="text-emerald-600 hover:underline">Subscribe on Substack</a> ·
			<a href="/briefing/archive" class="text-emerald-600 hover:underline">Archive</a>
		</p>
	</div>
</div>
