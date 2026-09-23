<script lang="ts">
	import BriefingArticle from '$lib/components/BriefingArticle.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>{data.briefing?.headline ? `${data.briefing.headline} — Stork Sightings` : `Stork Sightings — ${data.slug}`} — TokenStork</title>
	{#if data.briefing}
		<meta name="description" content={data.briefing.executiveSummary?.slice(0, 160) || data.briefing.dek || 'Stork Sightings — daily BCH token briefing.'} />
	{/if}
	<link rel="alternate" type="application/rss+xml" title="Stork Sightings" href="/briefing/feed.xml" />
</svelte:head>

<main class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<nav class="mb-6 text-sm">
		<a href="/briefing" class="text-violet-600 dark:text-violet-400 hover:underline">Stork Sightings</a>
		<span class="ts-text-muted"> / </span>
		<a href="/briefing/archive" class="text-violet-600 dark:text-violet-400 hover:underline">Archive</a>
	</nav>

	{#if data.found && data.briefing}
		<BriefingArticle briefing={data.briefing} slug={data.slug} />

		<!-- Prev / next editions -->
		{#if data.prev || data.next}
			<nav class="mt-12 pt-6 border-t ts-border-subtle flex justify-between gap-4 text-sm">
				{#if data.next}
					<a href="/briefing/archive/{data.next.slug}" class="text-violet-600 dark:text-violet-400 hover:underline max-w-[45%]">
						← Newer: {data.next.title}
					</a>
				{:else}
					<span></span>
				{/if}
				{#if data.prev}
					<a href="/briefing/archive/{data.prev.slug}" class="text-violet-600 dark:text-violet-400 hover:underline text-right max-w-[45%]">
						Older: {data.prev.title} →
					</a>
				{:else}
					<span></span>
				{/if}
			</nav>
		{/if}
	{:else}
		<div class="py-20 text-center">
			<h1 class="text-3xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent mb-4">Stork Sightings</h1>
			<p class="text-lg ts-text-muted">Edition not found: {data.slug}</p>
			<p class="text-sm ts-text-muted mt-4"><a href="/briefing" class="text-violet-600 dark:text-violet-400 hover:underline">← Back to the latest edition</a></p>
		</div>
	{/if}
</main>
