<script lang="ts">
	let { data } = $props();

	const fmt = (n: number) => n.toLocaleString('en-US');

	const byTypeTotal = $derived(data.byType.FT + data.byType.NFT + data.byType['FT+NFT']);
	const pct = (n: number) => (byTypeTotal === 0 ? 0 : Math.round((n / byTypeTotal) * 1000) / 10);
</script>

<svelte:head>
	<title>Stats — Token Stork</title>
	<meta name="description" content="Ecosystem-level statistics for the BCH CashTokens directory." />
</svelte:head>

<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<div class="mb-8">
		<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent">
			Stats
		</h1>
		<p class="text-slate-600 dark:text-slate-400 mt-2">
			Headline numbers for the BCH CashTokens ecosystem, computed directly from the tokens we've
			indexed.
		</p>
	</div>

	<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
		<div class="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">New — 24h</div>
			<div class="mt-2 text-3xl font-semibold">{fmt(data.newIn24h)}</div>
		</div>
		<div class="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">New — 7d</div>
			<div class="mt-2 text-3xl font-semibold">{fmt(data.newIn7d)}</div>
		</div>
		<div class="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">New — 30d</div>
			<div class="mt-2 text-3xl font-semibold">{fmt(data.newIn30d)}</div>
		</div>
	</div>

	<section class="mb-8">
		<h2 class="text-xl font-semibold mb-3">By type</h2>
		<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
			{#each [['FT', data.byType.FT], ['NFT', data.byType.NFT], ['FT+NFT', data.byType['FT+NFT']]] as [label, count] (label)}
				<div class="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
					<div class="flex items-baseline justify-between">
						<span class="px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-sm font-medium">
							{label}
						</span>
						<span class="text-xs text-slate-500 dark:text-slate-400">{pct(count as number)}%</span>
					</div>
					<div class="mt-2 text-3xl font-semibold">{fmt(count as number)}</div>
				</div>
			{/each}
		</div>
	</section>

	<section class="mb-8">
		<h2 class="text-xl font-semibold mb-3">Tradeable</h2>
		<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
			<div class="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
				<div class="flex items-baseline justify-between">
					<span class="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-sm font-medium">
						Tapswap (P2P)
					</span>
				</div>
				<div class="mt-2 text-3xl font-semibold">{fmt(data.tapswapListedCategories)}</div>
				<div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
					distinct tokens with open listings
				</div>
			</div>
		</div>
	</section>

	<section class="mb-8">
		<h2 class="text-xl font-semibold mb-3">Burn status</h2>
		{#if data.burned === null}
			<div class="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-sm text-slate-600 dark:text-slate-400">
				Burn status is enriched from live UTXO counts — this requires our BlockBook indexer, which
				is not yet deployed. Numbers will appear here once the enrichment worker has run.
			</div>
		{:else}
			<div class="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
				<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
					Fully burned
				</div>
				<div class="mt-2 text-3xl font-semibold">{fmt(data.burned)}</div>
			</div>
		{/if}
	</section>

	<p class="text-xs text-slate-500 dark:text-slate-400 mt-10">
		Counts reflect what our indexer has seen since CashTokens activation at block 792,772 (May
		2023). Metadata comes from the BCMR registry via Paytaca's public indexer, refreshed every 4
		hours.
	</p>
</main>
