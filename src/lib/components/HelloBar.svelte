<script lang="ts">
	import { onMount } from 'svelte';
	import { bchPrice } from '$lib/stores/bchPrice';
	import TinyLoader from './TinyLoader.svelte';

	interface Props {
		tokensTracked: number;
	}

	let { tokensTracked }: Props = $props();

	let fearGreedIndex: number | null = $state(null);

	onMount(async () => {
		try {
			const response = await fetch('/api/fearAndGreed');
			const data = await response.json();
			const value = data?.fgi?.now?.value;
			if (value !== undefined && value !== null) {
				fearGreedIndex = value;
			}
		} catch (error) {
			console.error(error);
		}
	});
</script>

<div class="bg-primary text-white flex items-center">
	<div class="case text-xs tracking-wider text-center px-4 py-3">
		Tokens tracked: <span>{tokensTracked}</span> | BCH Price:&nbsp;
		{#if $bchPrice.bchPrice}
			${$bchPrice.bchPrice.toFixed(2)}
		{:else}
			<TinyLoader />
		{/if}
		&nbsp;| CNN Fear &amp; Greed:&nbsp;
		{#if fearGreedIndex !== null}
			{fearGreedIndex}
		{:else}
			<TinyLoader />
		{/if}
	</div>
</div>
