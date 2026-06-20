<script lang="ts">
	import TokenGrid from '$lib/components/TokenGrid.svelte';
	import Movers24h from '$lib/components/Movers24h.svelte';
	import { iconHrefFor } from '$lib/icons';
	import { stripEmoji } from '$lib/format';
	import { invalidate } from '$app/navigation';

	let { data } = $props();

	const fmt = (n: number) => n.toLocaleString('en-US');

	// Skeleton utility classes
	const sk = 'animate-pulse bg-slate-200 dark:bg-zinc-700 rounded';

	// Tier 3 — fresh-data hydration over the (edge-cached) static shell.
	//
	// `data.tokenGrid` is a deferred promise that SSR streams in: the first
	// paint shows the skeleton, then the real grid. We mirror each resolved
	// value into `liveGrid` and, ONCE it's set, render from `liveGrid`
	// instead of the `{#await}` block. That matters for refreshes: calling
	// `invalidate('app:home-grid')` re-runs only the page load (see
	// +page.server.ts `depends`), which makes `data.tokenGrid` a NEW pending
	// promise — if we rendered straight off the await we'd flash back to the
	// skeleton every cycle. Rendering off `liveGrid` keeps the current rows
	// on screen until the fresh ones land.
	type Grid = Awaited<typeof data.tokenGrid>;
	let liveGrid = $state<Grid | null>(null);

	$effect(() => {
		// Re-runs on first load AND on every invalidation (new promise).
		const pending = data.tokenGrid;
		let cancelled = false;
		pending
			.then((g) => {
				if (!cancelled) liveGrid = g;
			})
			.catch(() => {
				/* keep showing the last good grid on a transient failure */
			});
		return () => {
			cancelled = true;
		};
	});

	// Poll the grid every 30s and on tab re-focus, but only while the tab is
	// visible — a backgrounded tab shouldn't keep hitting the server. The
	// in-process SWR memo (default view) and the API/edge caches absorb the
	// repeats; this just converges a possibly-stale cached shell to live data.
	$effect(() => {
		const REFRESH_MS = 30_000;
		const refresh = () => {
			if (document.visibilityState === 'visible') invalidate('app:home-grid');
		};
		const timer = setInterval(refresh, REFRESH_MS);
		document.addEventListener('visibilitychange', refresh);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', refresh);
		};
	});
</script>

<svelte:head>
	<title>Token Stork: Discover, Track and Analyze BCH Cash Tokens</title>
</svelte:head>

<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<!-- Movers24h — real data from sync load -->
	<Movers24h movers={data.movers} />

	<!-- Community sentiment — real data from sync load -->
	{#if data.voteLeaders.totalVotes > 0}
		<section class="mb-8">
			<div class="flex items-baseline justify-between mb-3">
				<div class="flex items-center gap-1.5">
					<h2 class="text-xl font-semibold text-slate-900 dark:text-white">Community sentiment</h2>
					<a href="/faq#faq-vote-ranking" class="text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors" aria-label="About community sentiment — opens FAQ" title="Ranks weight votes by voter tenure × recency (7-day half-life).">
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4" aria-hidden="true">
							<circle cx="12" cy="12" r="10" />
							<line x1="12" y1="16" x2="12" y2="12" />
							<line x1="12" y1="8" x2="12.01" y2="8" />
						</svg>
					</a>
				</div>
				<span class="text-xs ts-text-muted">{fmt(data.voteLeaders.totalVotes)} vote{data.voteLeaders.totalVotes === 1 ? '' : 's'} cast</span>
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
										<a href={`/token/${t.id}`} data-sveltekit-preload-data="hover" class="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition-colors no-underline">
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

	<!--
		Token grid — deferred (heavy CTE query). Skeleton: a 3-column card
		grid matching TokenGrid's responsive layout, with icon circles + text
		line placeholders for each row.
	-->
	{#snippet gridView(grid: Grid)}
		{#if grid.error}
			<div class="text-center py-12">
				<div class="text-red-500 text-lg mb-2">{grid.error}</div>
				<div class="ts-text-muted">Please try again in a moment.</div>
			</div>
		{:else}
			<TokenGrid tokens={grid.tokens} total={grid.total} limit={grid.limit} offset={grid.offset} />
		{/if}
	{/snippet}

	{#if liveGrid}
		{@render gridView(liveGrid)}
	{:else}
		{#await data.tokenGrid}
			<div class="animate-pulse space-y-3">
				{#each Array(5) as _}
					<div class="flex items-center gap-3 p-3 rounded-xl border ts-border-subtle">
						<div class="w-8 h-8 rounded-full bg-slate-200 dark:bg-zinc-700"></div>
						<div class="flex-1 space-y-2">
							<div class="h-4 bg-slate-200 dark:bg-zinc-700 rounded w-1/3"></div>
							<div class="h-3 bg-slate-200 dark:bg-zinc-700 rounded w-1/2"></div>
						</div>
					</div>
				{/each}
			</div>
		{:then tg}
			{@render gridView(tg)}
		{/await}
	{/if}
</main>
