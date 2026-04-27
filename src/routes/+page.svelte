<script lang="ts">
	import TokenGrid from '$lib/components/TokenGrid.svelte';
	import Movers24h from '$lib/components/Movers24h.svelte';

	let { data } = $props();
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
	<div class="mb-6">
		<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent">
			CashTokens
		</h1>
	</div>

	<!--
		24h movers leads the directory — same component used on /stats so
		gainers/losers/TVL-movers stay in lockstep. Lives ABOVE the token grid
		so visitors land on the active-trading signal first; the long
		exhaustive directory is what they scroll to.
	-->
	<Movers24h movers={data.movers} />

	{#if data.error}
		<div class="text-center py-12">
			<div class="text-red-500 text-lg mb-2">{data.error}</div>
			<div class="text-slate-500 dark:text-slate-400">Please try again in a moment.</div>
		</div>
	{:else}
		<TokenGrid
			tokens={data.tokens}
			total={data.total}
			limit={data.limit}
			offset={data.offset}
			mcapTvlThresholdSats={data.mcapTvlThresholdSats}
		/>
	{/if}
</main>
