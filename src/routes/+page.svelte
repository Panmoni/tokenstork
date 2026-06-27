<script lang="ts">
	import TokenGrid from '$lib/components/TokenGrid.svelte';
	import Movers24h from '$lib/components/Movers24h.svelte';
	import InfoTooltip from '$lib/components/InfoTooltip.svelte';
	import { iconHrefFor } from '$lib/icons';
	import { stripEmoji } from '$lib/format';
	import { invalidate } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import { getLocale, localizeHref } from '$lib/paraglide/runtime';

	let { data } = $props();

	const fmt = (n: number) => n.toLocaleString(getLocale());

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
	<title>{m.meta_title()}</title>
</svelte:head>

<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<!-- Movers24h — real data from sync load -->
	<Movers24h movers={data.movers} />

	<!-- Community sentiment — real data from sync load -->
	{#if data.voteLeaders.totalVotes > 0}
		<section class="mb-8">
			<div class="flex items-baseline justify-between mb-3">
				<div class="flex items-center gap-1.5">
					<h2 class="text-xl font-semibold text-slate-900 dark:text-white">{m.home_community_sentiment()}</h2>
					<InfoTooltip
						href={localizeHref('/faq#faq-vote-ranking')}
						label={m.home_sentiment_tip_label()}
						text={m.home_sentiment_tip_text()}
					/>
				</div>
				<span class="text-xs ts-text-muted">{data.voteLeaders.totalVotes === 1 ? m.home_votes_cast_one({ count: fmt(data.voteLeaders.totalVotes) }) : m.home_votes_cast_many({ count: fmt(data.voteLeaders.totalVotes) })}</span>
			</div>
			<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
				{#each [
					{ label: m.home_most_upvoted(), sub: m.home_most_upvoted_sub(), sortQuery: '?sort=upvoted', items: data.voteLeaders.mostUpvoted },
					{ label: m.home_most_downvoted(), sub: m.home_most_downvoted_sub(), sortQuery: '?sort=downvoted', items: data.voteLeaders.mostDownvoted },
					{ label: m.home_most_controversial(), sub: m.home_most_controversial_sub(), sortQuery: '?sort=controversial', items: data.voteLeaders.mostControversial }
				] as col (col.label)}
					<div class="rounded-xl border overflow-hidden ts-border-subtle ts-surface-panel">
						<div class="px-4 py-3 border-b flex items-baseline justify-between ts-border-subtle">
							<div>
								<div class="text-sm font-semibold text-slate-900 dark:text-white">{col.label}</div>
								<div class="text-xs ts-text-muted">{col.sub}</div>
							</div>
							<a href={localizeHref(`/${col.sortQuery}`)} class="text-xs text-violet-600 dark:text-violet-400 hover:underline">{m.home_all()} →</a>
						</div>
						{#if col.items.length === 0}
							<div class="px-4 py-6 text-sm text-center ts-text-muted">{m.home_no_votes()}</div>
						{:else}
							<ol class="divide-y divide-slate-100 dark:divide-zinc-800">
								{#each col.items as t, i (t.id)}
									<li>
										<a href={localizeHref(`/token/${t.id}`)} data-sveltekit-preload-data="hover" class="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition-colors no-underline">
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

	<!-- Stork Sightings — daily BCH token briefing CTA -->
	<section class="mb-8">
		<a href="/briefing" class="block rounded-xl border border-emerald-200 dark:border-emerald-800 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950 dark:to-teal-950 p-5 hover:shadow-md transition-shadow no-underline">
			<div class="flex items-center gap-3">
				<span class="text-2xl">⬢</span>
				<div class="flex-1">
					<h2 class="text-base font-semibold text-emerald-800 dark:text-emerald-200">Stork Sightings</h2>
					<p class="text-sm text-emerald-700 dark:text-emerald-300 mt-0.5">Daily BCH token briefing — what the stork spotted today. Market movers, new tokens, holder shifts, ecosystem health.</p>
				</div>
				<div class="hidden sm:flex items-center gap-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
					Read today's briefing <span class="text-lg">→</span>
				</div>
			</div>
		</a>
	</section>

	<!--
		Token grid — deferred (heavy CTE query). Skeleton: a 3-column card
		grid matching TokenGrid's responsive layout, with icon circles + text
		line placeholders for each row.
	-->
	{#snippet gridView(grid: Grid)}
		{#if grid.error}
			<div class="text-center py-12">
				<div class="text-red-500 text-lg mb-2">{grid.error}</div>
				<div class="ts-text-muted">{m.home_grid_retry()}</div>
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
