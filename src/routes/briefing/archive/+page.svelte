<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>Stork Sightings Archive — TokenStork</title>
</svelte:head>

<div class="max-w-2xl mx-auto py-10 px-4 sm:px-6">
	<div class="mb-8 pb-4 border-b ts-border-subtle">
		<h1 class="font-serif text-2xl font-bold text-emerald-700 dark:text-emerald-400">⬢ Stork Sightings — Archive</h1>
		<p class="mt-1 text-sm ts-text-muted">Past editions of the daily BCH token briefing.</p>
	</div>

	{#if data.entries.length > 0}
		<div class="space-y-1">
			{#each data.entries as entry}
				<a href="/briefing/archive/{entry.slug}" class="flex items-center justify-between px-4 py-3 rounded-lg no-underline hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition-colors border-b ts-border-subtle last:border-b-0">
					<span class="text-sm font-semibold text-slate-900 dark:text-white">{entry.date}</span>
					<span class="text-xs ts-text-muted">{entry.time} UTC</span>
				</a>
			{/each}
		</div>
	{:else}
		<p class="text-sm ts-text-muted py-8 text-center">No archived editions yet. The first daily briefing runs at 11:00 UTC.</p>
	{/if}

	<p class="mt-8">
		<a href="/briefing" class="text-sm text-emerald-600 hover:underline">← Back to today's briefing</a>
	</p>
</div>
