<script lang="ts">
	import TokenGrid from '$lib/components/TokenGrid.svelte';
	import Movers24h from '$lib/components/Movers24h.svelte';
	import { iconHrefFor } from '$lib/icons';
	import { stripEmoji } from '$lib/format';

	let { data } = $props();

	const fmt = (n: number) => n.toLocaleString('en-US');
</script>

<svelte:head>
	<!--
		Explicit title on the home page so navigating from a sub-page
		(e.g. /stats, /faq) back to / updates the document title.
		Without this, <svelte:head><title> elements from sub-pages
		persist in the DOM and the tab label gets stuck on the last
		visited page's title.
	-->
	<title>Token Stork: Discover, Track and Analyze BCH Cash Tokens</title>
</svelte:head>

<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<!--
		24h movers leads the directory — same component used on /stats so
		gainers/losers/TVL-movers stay in lockstep. Lives ABOVE the token grid
		so visitors land on the active-trading signal first; the long
		exhaustive directory is what they scroll to. The "CashTokens" h1
		that used to live here was redundant with the "Token Stork" wordmark
		in the header — removed for vertical density.
	-->
	<Movers24h movers={data.movers} />

	{#if data.voteLeaders.totalVotes > 0}
		<section class="mb-8">
			<div class="flex items-baseline justify-between mb-3">
				<div class="flex items-center gap-1.5">
					<h2 class="text-xl font-semibold text-slate-900 dark:text-white">Community sentiment</h2>
					<a
						href="/faq#faq-vote-ranking"
						class="text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
						aria-label="About community sentiment — opens FAQ"
						title="Ranks weight votes by voter tenure × recency (7-day half-life). Click for the full formula."
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4" aria-hidden="true">
							<circle cx="12" cy="12" r="10" />
							<line x1="12" y1="16" x2="12" y2="12" />
							<line x1="12" y1="8" x2="12.01" y2="8" />
						</svg>
					</a>
				</div>
				<span class="text-xs ts-text-muted">
					{fmt(data.voteLeaders.totalVotes)} vote{data.voteLeaders.totalVotes === 1 ? '' : 's'} cast
				</span>
			</div>
			<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
				{#each [
					{ label: 'Most upvoted', sub: 'highest net score', sortQuery: '?sort=upvoted', items: data.voteLeaders.mostUpvoted },
					{ label: 'Most downvoted', sub: 'lowest net score', sortQuery: '?sort=downvoted', items: data.voteLeaders.mostDownvoted },
					{ label: 'Most controversial', sub: 'big & evenly split', sortQuery: '?sort=controversial', items: data.voteLeaders.mostControversial }
				] as col (col.label)}
					<div class="rounded-xl border overflow-hidden ts-border-subtle ts-surface-panel">
						<div class="px-4 py-3 border-b flex items-baseline justify-between ts-border-subtle">
							<div>
								<div class="text-sm font-semibold text-slate-900 dark:text-white">{col.label}</div>
								<div class="text-xs ts-text-muted">{col.sub}</div>
							</div>
							<a href={`/${col.sortQuery}`} class="text-xs text-violet-600 dark:text-violet-400 hover:underline">All →</a>
						</div>
						{#if col.items.length === 0}
							<div class="px-4 py-6 text-sm text-center ts-text-muted">No votes yet.</div>
						{:else}
							<ol class="divide-y divide-slate-100 dark:divide-zinc-800">
								{#each col.items as t, i (t.id)}
									<li>
										<a href={`/token/${t.id}`} class="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition-colors no-underline">
											<span class="w-5 text-xs font-mono text-slate-400 tabular-nums">{i + 1}</span>
											<img src={iconHrefFor(t.icon, t.iconClearedHash)} alt="" class="w-7 h-7 rounded-full ts-surface-chip" loading="lazy" />
											<span class="flex-1 min-w-0 truncate text-sm text-slate-900 dark:text-white">
												{stripEmoji(t.name) || t.id.slice(0, 10) + '…'}
												{#if t.symbol}<span class="ml-1 text-xs text-slate-500 font-mono">{stripEmoji(t.symbol)}</span>{/if}
											</span>
											<span class="text-xs font-mono tabular-nums shrink-0">
												<span class="text-emerald-600 dark:text-emerald-400">↑{t.upCount}</span>
												<span class="text-slate-400 mx-0.5">·</span>
												<span class="text-rose-600 dark:text-rose-400">↓{t.downCount}</span>
											</span>
										</a>
									</li>
								{/each}
							</ol>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/if}

	{#if data.error}
		<div class="text-center py-12">
			<div class="text-red-500 text-lg mb-2">{data.error}</div>
			<div class="ts-text-muted">Please try again in a moment.</div>
		</div>
	{:else}
		<TokenGrid
			tokens={data.tokens}
			total={data.total}
			limit={data.limit}
			offset={data.offset}
		/>
	{/if}
</main>
