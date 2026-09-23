<script lang="ts">
	import BriefingArticle from '$lib/components/BriefingArticle.svelte';
	import BriefingArchiveList from '$lib/components/BriefingArchiveList.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Stork Sightings — TokenStork</title>
	{#if data.briefing}
		<meta name="description" content={data.briefing.executiveSummary?.slice(0, 160) || 'Daily BCH token briefing from the TokenStork directory.'} />
	{/if}
	<link rel="alternate" type="application/rss+xml" title="Stork Sightings" href="/briefing/feed.xml" />
</svelte:head>

<main class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<!-- Blog masthead -->
	<header class="mb-10 pb-6 border-b ts-border-subtle">
		<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent mb-2">
			Stork Sightings
		</h1>
		<p class="ts-text-body">
			The daily newsletter of the Bitcoin Cash CashToken ecosystem. What moved, what minted, what
			matters — read by a jaded eye so you don't have to squint.
		</p>
		<p class="mt-2 text-sm">
			<a href="/briefing/archive" class="text-violet-600 dark:text-violet-400 hover:underline">All editions</a>
			· <a href="/briefing/feed.xml" class="text-violet-600 dark:text-violet-400 hover:underline">RSS</a>
			· <a href="https://tokenstork.substack.com" target="_blank" rel="noopener" class="text-violet-600 dark:text-violet-400 hover:underline">Subscribe on Substack</a>
		</p>
	</header>

	{#if data.hasBriefing && data.briefing}
		<!-- Latest edition, in full -->
		<BriefingArticle briefing={data.briefing} lead />
	{:else}
		<div class="py-16 text-center">
			<p class="text-lg ts-text-muted mb-2">No briefing yet.</p>
			<p class="text-sm ts-text-muted">The stork is out gathering data — check back later today.</p>
			<p class="text-xs ts-text-muted mt-4">The daily briefing runs at 11:00 UTC. It surfaces market movers, new tokens, holder shifts, BCMR changes, and ecosystem health.</p>
		</div>
	{/if}

	<!-- Archive -->
	{#if data.archiveEntries.length > 0}
		<section id="archive" class="mt-16 pt-8 border-t ts-border-subtle">
			<h2 class="text-2xl font-bold text-slate-900 dark:text-white mb-1">Archive</h2>
			<p class="text-sm ts-text-muted mb-6">Past editions of the daily briefing.</p>
			<BriefingArchiveList entries={data.archiveEntries} />
		</section>
	{/if}

	<p class="mt-12 text-xs ts-text-muted">
		⬢ Stork Sightings — automated daily briefing from the <a href="/" class="text-violet-600 dark:text-violet-400 hover:underline">TokenStork</a> directory.
	</p>
</main>
