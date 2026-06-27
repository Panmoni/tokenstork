<script lang="ts">
	import type { Briefing, BcmrChangeItem } from '$lib/server/briefing/types';

	interface Props { briefing: Briefing; archiveEntries?: Array<{ slug: string; date: string; time: string }>; }
	let { briefing: b, archiveEntries = [] }: Props = $props();

	const date = $derived(new Date(b.generatedAt).toISOString().slice(0, 10));
	const time = $derived(new Date(b.generatedAt).toISOString().slice(11, 16));
	const shareUrl = $derived('https://tokenstork.com/briefing');
	const shareText = $derived(`Stork Sightings — ${date}`);

	let copied = $state(false);
	function copyLink() { navigator.clipboard.writeText(shareUrl).then(() => { copied = true; setTimeout(() => copied = false, 2000); }); }

	const fmtNum = (n: number) => n.toLocaleString();
	const SATS_PER_BCH = 100_000_000;

	function fmtPct(n: number) { return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`; }
	function fmtBch(sats: number): string { return (sats / SATS_PER_BCH).toFixed(2) + ' BCH'; }
	function giniLabel(g: number) { return g < 0.4 ? 'Well-distributed' : g < 0.6 ? 'Good' : g < 0.75 ? 'Fair' : g < 0.9 ? 'Poor' : 'Whale-controlled'; }

	const namedNewTokens = $derived(b.newTokens.filter(t => t.name || t.symbol));
	const unnamedCount = $derived(b.newTokens.length - namedNewTokens.length);

	const extremeWhaleMoves = $derived(
		[...b.whaleMoves].sort((a, b) => Math.abs(b.giniAfter - 0.5) - Math.abs(a.giniAfter - 0.5))
	);

	function fmtBcmrSummary(c: BcmrChangeItem): string {
		try {
			const detail = JSON.parse(c.summary);
			if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
				if (detail.changed && Array.isArray(detail.changed) && detail.changed.length > 0) {
					const changes = detail.changed.map((field: string) => {
						const fv = detail.fields?.[field];
						if (fv) {
							const { old: ov, new: nv } = fv;
							if (ov != null && nv != null && String(nv) !== String(ov)) return `${field}: "${ov}" → "${nv}"`;
							if (ov == null && nv != null) return `added ${field}`;
							if (ov != null && nv == null) return `removed ${field}`;
						}
						return `changed ${field}`;
					});
					return changes.join('; ');
				}
				if (detail.claimed && typeof detail.claimed === 'object') {
					const parts: string[] = [];
					for (const [k, v] of Object.entries(detail.claimed)) {
						if (v != null) parts.push(`claimed ${k}="${v}"`);
					}
					if (parts.length > 0) return parts.join(', ');
				}
			}
		} catch {}
		if (c.summary === '{"fields":[],"changed":[]}') return 'no detail';
		return c.summary;
	}
</script>

<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent mb-2">
		Stork Sightings
	</h1>
	<p class="ts-text-body mb-8">
		Daily BCH token briefing — {date} {time} UTC · last {b.windowHours}h window.
		{fmtNum(b.ecosystem.totalTokens)} tokens tracked across {fmtNum(b.ecosystem.holderCount)} holders.
		<a href="#archive" class="text-violet-600 dark:text-violet-400 hover:underline">Archive ↓</a>
	</p>

	<div class="prose prose-slate dark:prose-invert max-w-none">

		<!-- Executive Summary -->
		{#if b.executiveSummary}
			<h2 id="summary">Summary</h2>
			<p class="text-xs ts-text-muted">What happened in the BCH token ecosystem over the last {b.windowHours} hours.</p>
			<p>{b.executiveSummary}</p>
		{/if}

		<!-- Trends -->
		{#if b.trends.length > 0}
			<h2 id="trends">Trends</h2>
			<p class="text-xs ts-text-muted">Patterns worth paying attention to.</p>
			<ul>
				{#each b.trends as t}
					<li>{t.text.replace(/^[•\-]\s*/, '')}</li>
				{/each}
			</ul>
		{/if}

		<!-- BCH Chain Stats -->
		{#if b.bchChain}
			<h2 id="chain-stats">BCH Chain</h2>
			<p class="text-xs ts-text-muted">Bitcoin Cash network activity in the last 24 hours compared to the 7-day average.</p>
			<p>
				<strong>{b.bchChain.blocks24h} blocks</strong> (avg {b.bchChain.avgBlockTimeSec}s block time) ·
				<strong>{fmtNum(b.bchChain.txCount24h)} transactions</strong>
				{#if b.bchChain.avgTxCount7d > 0} (7d avg: {fmtNum(b.bchChain.avgTxCount7d)}/day){/if} ·
				<strong>{fmtBch(b.bchChain.feesSats24h)} in fees</strong> ·
				<strong>{fmtBch(b.bchChain.outputSats24h)} moved</strong> ·
				<strong>{fmtNum(b.bchChain.tokenTxCount24h)} token txs</strong> ·
				<strong>{b.bchChain.mints24h} mints</strong>.
			</p>
		{/if}

		<!-- Token of the Day -->
		{#if b.tokenProfile}
			<h2 id="token-of-the-day">Token of the Day</h2>
			<p class="text-xs ts-text-muted">One token that earned a closer look — selected from today's signals.</p>
			<p>
				<a href="/token/{b.tokenProfile.categoryHex}" class="text-violet-600 dark:text-violet-400 hover:underline font-semibold">
					{b.tokenProfile.symbol || b.tokenProfile.name}
				</a>
				— {fmtNum(b.tokenProfile.holderCount)} holders, Gini: {b.tokenProfile.giniTier || 'unknown'}.
				{b.tokenProfile.narrative}
			</p>
		{/if}

		<!-- Market Movers -->
		{#if b.movers.gainers.length > 0 || b.movers.losers.length > 0}
			<h2 id="movers">Market Movers</h2>
			<p class="text-xs ts-text-muted">Cauldron price and TVL changes over the last 24 hours.</p>

			{#if b.movers.gainers.length > 0}
				<h3>Gainers</h3>
				<ul>
					{#each b.movers.gainers as m}
						<li>
							<a href="/token/{m.categoryHex}" class="text-violet-600 dark:text-violet-400 hover:underline font-medium">{m.symbol || m.name}</a>
							<span class="text-emerald-600 dark:text-emerald-400">↑ {fmtPct(m.pricePct)}</span>
						</li>
					{/each}
				</ul>
			{/if}

			{#if b.movers.losers.length > 0}
				<h3>Losers</h3>
				<ul>
					{#each b.movers.losers as m}
						<li>
							<a href="/token/{m.categoryHex}" class="text-violet-600 dark:text-violet-400 hover:underline font-medium">{m.symbol || m.name}</a>
							<span class="text-red-600 dark:text-red-400">↓ {fmtPct(m.pricePct)}</span>
						</li>
					{/each}
				</ul>
			{/if}

			{#if b.movers.tvlMovers.length > 0}
				<h3>TVL Swings</h3>
				<ul>
					{#each b.movers.tvlMovers.slice(0, 5) as m}
						<li>
							<a href="/token/{m.categoryHex}" class="text-violet-600 dark:text-violet-400 hover:underline font-medium">{m.symbol || m.name}</a>
							<span class={m.tvlPct && m.tvlPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
								{m.tvlPct && m.tvlPct >= 0 ? '↑' : '↓'} {m.tvlPct ? fmtPct(m.tvlPct) : '—'} TVL
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}

		<!-- New Tokens -->
		<h2 id="new-tokens">New Tokens</h2>
		<p class="text-xs ts-text-muted">CashTokens minted in the last {b.windowHours}h.</p>
		{#if namedNewTokens.length > 0}
			<p>
				{#each namedNewTokens as t, i}
					<a href="/token/{t.categoryHex}" class="text-violet-600 dark:text-violet-400 hover:underline font-medium">
						{t.symbol || t.name}</a>{#if t.name && t.symbol && t.symbol !== t.name}<span class="text-slate-500"> ({t.name})</span>{/if}
					{@const nextIsLast = i === namedNewTokens.length - 2 && unnamedCount === 0}
					{@const isLast = i === namedNewTokens.length - 1}
					{#if !isLast && !nextIsLast && i < namedNewTokens.length - 1}, {/if}
					{#if nextIsLast} and {/if}
					{#if isLast && unnamedCount > 0} and {/if}
				{/each}
				{#if unnamedCount > 0}
					{unnamedCount} unnamed token{unnamedCount === 1 ? '' : 's'}
				{/if}
				 minted.
			</p>
		{:else if b.newTokens.length === 0}
			<p>No new tokens in the window.</p>
		{/if}

		<!-- Concentration Watch -->
		{#if extremeWhaleMoves.length > 0}
			<h2 id="concentration">Concentration Watch</h2>
			<p class="text-xs ts-text-muted">Holder distribution health — from evenly spread to whale-dominated.</p>
			<ul>
				{#each extremeWhaleMoves as w}
					<li>
						<a href="/token/{w.categoryHex}" class="text-violet-600 dark:text-violet-400 hover:underline font-medium">{w.symbol || w.name}</a>
						— {giniLabel(w.giniAfter)} ({w.giniAfter.toFixed(2)} Gini), {fmtNum(w.holderCountAfter)} holders.
					</li>
				{/each}
			</ul>
		{/if}

		<!-- BCMR Activity -->
		{#if b.bcmrChanges.length > 0}
			<h2 id="bcmr">BCMR Activity</h2>
			<p class="text-xs ts-text-muted">Metadata registry changes detected on-chain in the last {b.windowHours}h.</p>
			<ul>
				{#each b.bcmrChanges as c}
					<li>
						<span class="font-medium text-fuchsia-600 dark:text-fuchsia-400">{c.severity}</span>
						{#if c.symbol || c.name}
							<a href="/token/{c.categoryHex}" class="text-violet-600 dark:text-violet-400 hover:underline font-medium"> {c.symbol || c.name}</a>
						{/if}
						— {fmtBcmrSummary(c)}.
						{#if c.changeType.includes('×')} <span class="text-xs ts-text-muted">({c.changeType})</span>{/if}
					</li>
				{/each}
			</ul>
		{/if}

		<!-- Ecosystem -->
		<h2 id="ecosystem">Ecosystem</h2>
		<p class="text-xs ts-text-muted">Snapshot of the BCH CashToken directory.</p>
		<p>
			<strong>{fmtNum(b.ecosystem.totalTokens)}</strong> tokens tracked ·
			<strong>{b.ecosystem.tokensNew24h}</strong> new in 24h ·
			<strong>{fmtNum(b.ecosystem.activity24hTokenTxs)}</strong> token txs ·
			<strong>{b.ecosystem.activity24hMints}</strong> mints ·
			<strong>{fmtNum(b.ecosystem.holderCount)}</strong> holders ·
			<strong>{fmtNum(b.ecosystem.listingsCauldron)}</strong> on Cauldron ·
			<strong>{fmtNum(b.ecosystem.listingsTapswap)}</strong> on Tapswap ·
			<strong>{fmtNum(b.ecosystem.listingsFex)}</strong> on Fex.
			{#if b.ecosystem.medianGini !== null} Median Gini: <strong>{b.ecosystem.medianGini.toFixed(2)}</strong>. {/if}
			{#if b.ecosystem.bchGini !== null} BCH coin Gini: <strong>{b.ecosystem.bchGini.toFixed(2)}</strong>. {/if}
		</p>

		<!-- Community Pulse -->
		{#if b.votes.length > 0}
			<h2 id="pulse">Community Pulse</h2>
			<p class="text-xs ts-text-muted">What the crowd is voting on.</p>
			<ul>
				{#each b.votes as v}
					<li>
						<a href="/token/{v.categoryHex}" class="text-violet-600 dark:text-violet-400 hover:underline font-medium">{v.symbol || v.name}</a>
						— ▲{v.upvotes} ▼{v.downvotes}{v.controversial ? ' ⚡controversial' : ''}.
					</li>
				{/each}
			</ul>
		{/if}

		<!-- Spark -->
		{#if b.spark}
			<p class="italic text-slate-500 dark:text-slate-400">💡 {b.spark}</p>
		{/if}

	</div>

	<!-- Share + Data -->
	<div class="mt-12 text-sm space-y-2">
		<div class="flex flex-wrap gap-3">
			<span class="font-semibold text-slate-900 dark:text-white">Share:</span>
			<a href="https://x.com/intent/tweet?text={encodeURIComponent(shareText)}&url={encodeURIComponent(shareUrl)}" target="_blank" rel="noopener" class="text-violet-600 dark:text-violet-400 hover:underline">X</a>
			<a href="https://bsky.app/intent/compose?text={encodeURIComponent(shareText + ' ' + shareUrl)}" target="_blank" rel="noopener" class="text-violet-600 dark:text-violet-400 hover:underline">Bluesky</a>
			<a href="https://www.reddit.com/r/BCHCashTokens/submit?url={encodeURIComponent(shareUrl)}&title={encodeURIComponent(shareText)}" target="_blank" rel="noopener" class="text-violet-600 dark:text-violet-400 hover:underline">Reddit</a>
			<button onclick={copyLink} class="bg-transparent border-0 p-0 cursor-pointer text-violet-600 dark:text-violet-400 hover:underline">{copied ? 'Copied!' : 'Copy link'}</button>
		</div>
		<div class="flex flex-wrap gap-3">
			<span class="font-semibold text-slate-900 dark:text-white">Data:</span>
			<a href="/briefing/briefing.json" class="text-violet-600 dark:text-violet-400 hover:underline">JSON</a>
			<a href="/briefing/briefing.txt" class="text-violet-600 dark:text-violet-400 hover:underline">Text</a>
			<a href="/briefing/briefing.md" class="text-violet-600 dark:text-violet-400 hover:underline">Markdown</a>
			<a href="/briefing/briefing.substack.html" class="text-violet-600 dark:text-violet-400 hover:underline">Substack HTML</a>
		</div>
	</div>

	<!-- Archive -->
	<div id="archive" class="mt-12">
		<h2 class="text-xl font-semibold text-slate-900 dark:text-white mb-3">Archive</h2>
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
		⬢ Stork Sightings — automated daily briefing from the <a href="/" class="text-violet-600 dark:text-violet-400 hover:underline">TokenStork</a> directory.
		<a href="https://tokenstork.substack.com" target="_blank" rel="noopener" class="text-violet-600 dark:text-violet-400 hover:underline">Subscribe on Substack</a>.
	</p>
</main>

<style>
	:global(.prose h2) { margin-top: 2.5rem; }
	:global(.prose h3) { margin-top: 1.5rem; font-size: 1rem; }
</style>
