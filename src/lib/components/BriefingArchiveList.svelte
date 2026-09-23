<script lang="ts">
	import type { IssueMeta } from '$lib/server/briefing/manifest';

	interface Props { entries: IssueMeta[]; emptyText?: string; }
	let { entries, emptyText = 'No past editions yet. The first daily briefing runs at 11:00 UTC.' }: Props = $props();

	const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	function fmtDate(iso: string, fallbackDate: string): string {
		const d = new Date(iso || fallbackDate);
		if (isNaN(d.getTime())) return fallbackDate;
		return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
	}
</script>

{#if entries.length > 0}
	<div class="divide-y ts-border-subtle">
		{#each entries as entry}
			<article class="py-5 first:pt-0">
				<p class="text-xs ts-text-muted mb-1">
					<time datetime={entry.generatedAt}>{fmtDate(entry.generatedAt, entry.date)}</time>
				</p>
				<h3 class="text-lg font-bold leading-snug mb-1">
					<a href="/briefing/archive/{entry.slug}" class="text-slate-900 dark:text-white no-underline hover:text-violet-600 dark:hover:text-violet-400 transition-colors">
						{entry.title}
					</a>
				</h3>
				{#if entry.dek}
					<p class="text-sm ts-text-body mb-2">{entry.dek}</p>
				{/if}
				{#if entry.tags && entry.tags.length > 0}
					<div class="flex flex-wrap gap-2">
						{#each entry.tags as tag}
							<a
								href="/briefing/archive?tag={encodeURIComponent(tag)}"
								class="no-underline inline-flex items-center rounded-full bg-violet-50 dark:bg-violet-950/50 px-2 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/50 transition-colors"
							>#{tag}</a>
						{/each}
					</div>
				{/if}
			</article>
		{/each}
	</div>
{:else}
	<p class="text-sm ts-text-muted py-8 text-center">{emptyText}</p>
{/if}
