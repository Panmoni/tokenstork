<script lang="ts">
	import BriefingPage from '$lib/components/BriefingPage.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Stork Sightings — {data.slug} — TokenStork</title>
</svelte:head>

{#if data.found && data.briefing}
	<BriefingPage briefing={data.briefing} archiveEntries={[]} />
{:else}
	<div class="max-w-2xl mx-auto py-20 px-4 text-center">
		<h1 class="font-serif text-3xl font-bold text-emerald-700 dark:text-emerald-400 mb-4">⬢ Stork Sightings</h1>
		<p class="text-lg ts-text-muted">Edition not found: {data.slug}</p>
		<p class="text-sm ts-text-muted mt-4"><a href="/briefing" class="text-emerald-600 hover:underline">← Back to today's briefing</a></p>
	</div>
{/if}
