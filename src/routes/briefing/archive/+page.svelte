<script lang="ts">
	import BriefingArchiveList from '$lib/components/BriefingArchiveList.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>{data.tag ? `Stork Sightings — #${data.tag}` : 'Stork Sightings — Archive'} — TokenStork</title>
	<link rel="alternate" type="application/rss+xml" title="Stork Sightings" href="/briefing/feed.xml" />
</svelte:head>

<main class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
	<header class="mb-8 pb-6 border-b ts-border-subtle">
		<h1 class="text-3xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent">
			Stork Sightings — Archive
		</h1>
		{#if data.tag}
			<p class="mt-2 text-sm ts-text-body">
				Filtered by <span class="font-medium text-violet-700 dark:text-violet-300">#{data.tag}</span>
				· <a href="/briefing/archive" class="text-violet-600 dark:text-violet-400 hover:underline">clear filter</a>
			</p>
		{:else}
			<p class="mt-1 text-sm ts-text-muted">Every edition of the daily BCH token briefing.</p>
		{/if}
	</header>

	<BriefingArchiveList
		entries={data.entries}
		emptyText={data.tag ? `No editions tagged #${data.tag}.` : 'No archived editions yet. The first daily briefing runs at 11:00 UTC.'}
	/>

	<p class="mt-10 text-sm">
		<a href="/briefing" class="text-violet-600 dark:text-violet-400 hover:underline">← Back to the latest edition</a>
	</p>
</main>
