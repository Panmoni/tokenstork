<script lang="ts">
	import BriefingPage from '$lib/components/BriefingPage.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Stork Sightings — TokenStork</title>
	{#if data.briefing}
		<meta name="description" content={data.briefing.executiveSummary?.slice(0, 160) || 'Daily BCH token briefing from the TokenStork directory.'} />
	{/if}
</svelte:head>

{#if data.hasBriefing && data.briefing}
	<BriefingPage briefing={data.briefing} archiveEntries={data.archiveEntries} />
{:else}
	<div class="max-w-2xl mx-auto py-20 px-4 text-center">
		<h1 class="font-serif text-3xl font-bold text-emerald-700 dark:text-emerald-400 mb-4">⬢ Stork Sightings</h1>
		<p class="text-lg ts-text-muted mb-2">No briefing yet.</p>
		<p class="text-sm ts-text-muted">The stork is out gathering data — check back later today.</p>
		<p class="text-xs ts-text-muted mt-4">The daily briefing runs at 11:00 UTC. It surfaces market movers, new tokens, holder shifts, BCMR changes, and ecosystem health.</p>
	</div>
{/if}
