<script lang="ts">
	import { REPORT_REASON_LABELS, type ReportReason } from '$lib/moderation';
	import * as m from '$lib/paraglide/messages';
	import { getLocale, localizeHref } from '$lib/paraglide/runtime';

	let { data } = $props();

	const fmt = (n: number) => n.toLocaleString(getLocale());
	const totalIconBlocked = $derived(
		data.iconStats
			? data.iconStats.blockedAdult +
				data.iconStats.blockedOversize +
				data.iconStats.blockedUnsupported +
				data.iconStats.blockedCsam
			: 0
	);

	const fmtDate = (unix: number): string => {
		const d = new Date(unix * 1000);
		return d.toISOString().slice(0, 10); // YYYY-MM-DD
	};

	const shortId = (id: string): string => `${id.slice(0, 8)}…${id.slice(-8)}`;

	// Reason → tailwind classes for the pill. Kept in one place so adding
	// a new reason in $lib/moderation only needs a single entry here.
	const reasonClasses: Record<ReportReason, string> = {
		spam: 'bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200',
		phishing: 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300',
		offensive: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
		fraud: 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300',
		illegal: 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300',
		other: 'bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200'
	};
</script>

<svelte:head>
	<title>{m.mod_meta_title()}</title>
	<meta
		name="description"
		content={m.mod_meta_description()}
	/>
	<!-- This page exists for transparency, not discovery. Keep it out of
	     search results so the moderated category IDs don't get re-promoted
	     by the very list that documents their removal. -->
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<div class="mb-8">
		<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent">
			{m.mod_h1()}
		</h1>
		<p class="mt-2 max-w-3xl ts-text-muted">
			{m.mod_intro_1()} <span class="font-mono text-xs">410 Gone</span>. {m.mod_intro_2()}
		</p>
	</div>

	{#if data.iconStats && data.iconStats.totalUrls > 0}
		<!--
			Image-safety transparency card. Counts are per UNIQUE IMAGE HASH
			(issuers reuse icons across categories). The bigger
			"tokensWithClearedIcon" footer shows the per-token rollup.
			Deliberately does NOT list individual blocked icons — the goal is
			a summary, not a directory of removed content.
		-->
		<section id="image-safety" class="mb-8 scroll-mt-20">
			<h2 class="text-2xl font-bold text-slate-900 dark:text-white">{m.mod_img_h2()}</h2>
			<p class="mt-2 mb-4 max-w-3xl text-sm ts-text-muted">
				{m.mod_img_desc_before()}
				<a href={localizeHref('/faq#faq-icons')} class="text-violet-600 dark:text-violet-400 hover:underline"
					>{m.mod_img_faq_link()}</a
				> {m.mod_img_desc_after()}
			</p>
			<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
				<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
					<div class="text-xs uppercase tracking-wider ts-text-muted">{m.mod_stat_cleared()}</div>
					<div class="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
						{fmt(data.iconStats.cleared)}
					</div>
					<div class="text-xs mt-1 ts-text-muted">{m.mod_stat_cleared_sub()}</div>
				</div>
				<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
					<div class="text-xs uppercase tracking-wider ts-text-muted">{m.mod_stat_adult()}</div>
					<div class="text-2xl font-bold text-rose-600 dark:text-rose-400">
						{fmt(data.iconStats.blockedAdult)}
					</div>
					<div class="text-xs mt-1 ts-text-muted">{m.mod_stat_adult_sub()}</div>
				</div>
				<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
					<div class="text-xs uppercase tracking-wider ts-text-muted">{m.mod_stat_csam()}</div>
					<div class="text-2xl font-bold text-rose-600 dark:text-rose-400">
						{fmt(data.iconStats.blockedCsam)}
					</div>
					<div class="text-xs mt-1 ts-text-muted">{m.mod_stat_csam_sub()}</div>
				</div>
				<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
					<div class="text-xs uppercase tracking-wider ts-text-muted">{m.mod_stat_oversize()}</div>
					<div class="text-2xl font-bold text-amber-600 dark:text-amber-400">
						{fmt(data.iconStats.blockedOversize)}
					</div>
					<div class="text-xs mt-1 ts-text-muted">{m.mod_stat_oversize_sub()}</div>
				</div>
				<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
					<div class="text-xs uppercase tracking-wider ts-text-muted">{m.mod_stat_format()}</div>
					<div class="text-2xl font-bold text-amber-600 dark:text-amber-400">
						{fmt(data.iconStats.blockedUnsupported)}
					</div>
					<div class="text-xs mt-1 ts-text-muted">{m.mod_stat_format_sub()}</div>
				</div>
				<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
					<div class="text-xs uppercase tracking-wider ts-text-muted">{m.mod_stat_review()}</div>
					<div class="text-2xl font-bold text-violet-600 dark:text-violet-400">
						{fmt(data.iconStats.review)}
					</div>
					<div class="text-xs mt-1 ts-text-muted">{m.mod_stat_review_sub()}</div>
				</div>
			</div>
			<p class="text-xs mt-3 ts-text-muted">
				{m.mod_img_footer({ rendered: fmt(data.iconStats.tokensWithClearedIcon), blocked: fmt(totalIconBlocked), pending: fmt(data.iconStats.pendingUrls) })}
			</p>
		</section>
	{/if}

	{#if data.error}
		<div class="text-center py-12">
			<div class="text-red-500 text-lg mb-2">{data.error}</div>
			<div class="ts-text-muted">{m.home_grid_retry()}</div>
		</div>
	{:else if data.rows.length === 0}
		<div class="p-8 rounded-xl border text-center ts-border-subtle ts-surface-panel">
			<div class="text-lg ts-text-strong">{m.mod_none_h()}</div>
			<div class="mt-1 text-sm ts-text-muted">
				{m.mod_none_body()}
			</div>
		</div>
	{:else}
		<p class="text-sm mb-3 ts-text-muted">
			{data.rows.length === 1 ? m.mod_count_one({ count: fmt(data.rows.length) }) : m.mod_count_many({ count: fmt(data.rows.length) })}
		</p>
		<div class="overflow-x-auto rounded-xl border ts-border-subtle ts-surface-panel">
			<table class="min-w-full text-sm">
				<thead class="bg-slate-50 dark:bg-zinc-900/60 text-xs uppercase tracking-wider ts-text-muted">
					<tr>
						<th class="text-left font-medium px-4 py-3">{m.mod_col_name()}</th>
						<th class="text-left font-medium px-4 py-3">{m.mod_col_symbol()}</th>
						<th class="text-left font-medium px-4 py-3">{m.mod_col_type()}</th>
						<th class="text-left font-medium px-4 py-3">{m.mod_col_reason()}</th>
						<th class="text-left font-medium px-4 py-3">{m.mod_col_hidden()}</th>
						<th class="text-left font-medium px-4 py-3">{m.mod_col_category()}</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-200 dark:divide-zinc-800">
					{#each data.rows as row (row.id)}
						<tr>
							<td class="px-4 py-3 ts-text-primary">
								{row.name ?? '—'}
							</td>
							<td class="px-4 py-3 font-mono text-xs ts-text-strong">
								{row.symbol ?? '—'}
							</td>
							<td class="px-4 py-3 text-xs ts-text-muted">
								{row.tokenType}
							</td>
							<td class="px-4 py-3">
								<span class="px-2 py-0.5 rounded text-xs font-medium {reasonClasses[row.reason]}">
									{REPORT_REASON_LABELS[row.reason]}
								</span>
							</td>
							<td class="px-4 py-3 font-mono text-xs ts-text-muted">
								{fmtDate(row.hiddenAt)}
							</td>
							<td class="px-4 py-3 font-mono text-xs ts-text-muted" title={row.id}>
								{shortId(row.id)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</main>
