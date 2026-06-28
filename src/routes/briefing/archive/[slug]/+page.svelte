<script lang="ts">
	import BriefingPage from '$lib/components/BriefingPage.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Stork Sightings — {data.slug} — TokenStork</title>
</svelte:head>

{#if data.found && data.briefing}
	<BriefingPage briefing={data.briefing} slug={data.slug} archiveEntries={[]} />
{:else}
	<div class="max-w-3xl mx-auto py-20 px-4 text-center">
		<h1 class="text-3xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent mb-4">Stork Sightings</h1>
		<p class="text-lg ts-text-muted">Edition not found: {data.slug}</p>
		<p class="text-sm ts-text-muted mt-4"><a href="/briefing" class="text-violet-600 dark:text-violet-400 hover:underline">← Back to the latest edition</a></p>
	</div>
{/if}
