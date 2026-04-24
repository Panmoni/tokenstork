<script lang="ts">
	import TokenGrid from '$lib/components/TokenGrid.svelte';

	let { data } = $props();
</script>

<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<div class="mb-8">
		<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent">
			CashTokens
		</h1>
		{#if data.total}
			<p class="text-slate-600 dark:text-slate-400 mt-2">
				{data.total.toLocaleString()} tokens indexed across the Bitcoin Cash network.
			</p>
		{/if}
	</div>

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
		/>
	{/if}
</main>
