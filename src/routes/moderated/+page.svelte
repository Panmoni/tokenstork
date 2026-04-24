<script lang="ts">
	import { REPORT_REASON_LABELS, type ReportReason } from '$lib/moderation';

	let { data } = $props();

	const fmt = (n: number) => n.toLocaleString('en-US');

	const fmtDate = (unix: number): string => {
		const d = new Date(unix * 1000);
		return d.toISOString().slice(0, 10); // YYYY-MM-DD
	};

	const shortId = (id: string): string => `${id.slice(0, 8)}…${id.slice(-8)}`;

	// Reason → tailwind classes for the pill. Kept in one place so adding
	// a new reason in $lib/moderation only needs a single entry here.
	const reasonClasses: Record<ReportReason, string> = {
		spam: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
		phishing: 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300',
		offensive: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
		fraud: 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300',
		illegal: 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300',
		other: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
	};
</script>

<svelte:head>
	<title>Moderated tokens — Token Stork</title>
	<meta
		name="description"
		content="Public list of CashTokens hidden from the Token Stork directory, with the reason and date for each."
	/>
	<!-- This page exists for transparency, not discovery. Keep it out of
	     search results so the moderated category IDs don't get re-promoted
	     by the very list that documents their removal. -->
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<div class="mb-8">
		<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent">
			Moderated tokens
		</h1>
		<p class="text-slate-600 dark:text-slate-400 mt-2 max-w-3xl">
			These categories are hidden from the directory, the public API, and the stats counters.
			Direct URLs return <span class="font-mono text-xs">410 Gone</span>. We list them here so you
			can see what we filter and why. To report a token, use the report link on its detail page.
		</p>
	</div>

	{#if data.error}
		<div class="text-center py-12">
			<div class="text-red-500 text-lg mb-2">{data.error}</div>
			<div class="text-slate-500 dark:text-slate-400">Please try again in a moment.</div>
		</div>
	{:else if data.rows.length === 0}
		<div class="p-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center">
			<div class="text-lg text-slate-700 dark:text-slate-300">No tokens are currently moderated.</div>
			<div class="mt-1 text-sm text-slate-500 dark:text-slate-400">
				Spot something that should be? Use the report link on any token detail page.
			</div>
		</div>
	{:else}
		<p class="text-sm text-slate-500 dark:text-slate-400 mb-3">
			{fmt(data.rows.length)} {data.rows.length === 1 ? 'token' : 'tokens'} hidden, newest first.
		</p>
		<div class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<table class="min-w-full text-sm">
				<thead class="bg-slate-50 dark:bg-slate-900/60 text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
					<tr>
						<th class="text-left font-medium px-4 py-3">Name</th>
						<th class="text-left font-medium px-4 py-3">Symbol</th>
						<th class="text-left font-medium px-4 py-3">Type</th>
						<th class="text-left font-medium px-4 py-3">Reason</th>
						<th class="text-left font-medium px-4 py-3">Hidden</th>
						<th class="text-left font-medium px-4 py-3">Category ID</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-200 dark:divide-slate-800">
					{#each data.rows as row (row.id)}
						<tr>
							<td class="px-4 py-3 text-slate-900 dark:text-slate-100">
								{row.name ?? '—'}
							</td>
							<td class="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-300">
								{row.symbol ?? '—'}
							</td>
							<td class="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
								{row.tokenType}
							</td>
							<td class="px-4 py-3">
								<span class="px-2 py-0.5 rounded text-xs font-medium {reasonClasses[row.reason]}">
									{REPORT_REASON_LABELS[row.reason]}
								</span>
							</td>
							<td class="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">
								{fmtDate(row.hiddenAt)}
							</td>
							<td class="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400" title={row.id}>
								{shortId(row.id)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</main>
