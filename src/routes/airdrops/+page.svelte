<script lang="ts">
	let { data } = $props();

	function tone(state: string): string {
		if (state === 'complete') return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300';
		if (state === 'failed') return 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300';
		if (state === 'partial') return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
		if (state === 'broadcasting' || state === 'signing' || state === 'drafting')
			return 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300';
		return 'bg-slate-100 dark:bg-zinc-800 ts-text-muted';
	}
</script>

<svelte:head>
	<title>Your airdrops — Token Stork</title>
</svelte:head>

<div class="max-w-4xl mx-auto px-4 py-8">
	<div class="flex items-center justify-between mb-6">
		<h1 class="text-3xl font-bold ts-text-strong">Your airdrops</h1>
		<a
			href="/airdrops/new"
			class="px-3 py-2 rounded bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold"
		>
			New airdrop →
		</a>
	</div>

	{#if data.airdrops.length === 0}
		<div class="rounded-xl border ts-border-subtle p-8 text-center ts-surface-panel">
			<p class="ts-text-muted">You haven't started any airdrops yet.</p>
			<a
				href="/"
				class="inline-block mt-4 text-violet-600 dark:text-violet-400 hover:underline"
			>Browse the directory to find a token you hold →</a>
		</div>
	{:else}
		<div class="rounded-xl border ts-border-subtle overflow-hidden ts-surface-panel">
			<table class="w-full text-sm">
				<thead class="text-xs font-semibold uppercase tracking-wider ts-text-muted border-b ts-border-subtle bg-slate-50 dark:bg-zinc-900/50">
					<tr>
						<th class="text-left px-4 py-3">When</th>
						<th class="text-left px-4 py-3">From → To holders of</th>
						<th class="text-right px-4 py-3">Recipients</th>
						<th class="text-left px-4 py-3">Mode</th>
						<th class="text-right px-4 py-3">State</th>
					</tr>
				</thead>
				<tbody>
					{#each data.airdrops as a (a.id)}
						<tr class="border-b border-slate-100 dark:border-zinc-800/50 last:border-0 hover:bg-slate-50 dark:hover:bg-zinc-900/40">
							<td class="px-4 py-3">
								<a href={`/airdrops/${a.id}`} class="block">
									<div class="text-xs ts-text-muted">{new Date(a.createdAt).toLocaleString()}</div>
									<div class="font-mono text-[10px] truncate max-w-[10ch] ts-text-muted">{a.id.slice(0, 8)}</div>
								</a>
							</td>
							<td class="px-4 py-3 font-mono text-xs">
								{a.sourceCategoryHex.slice(0, 12)}…
								<span class="ts-text-muted mx-1">→</span>
								{a.recipientCategoryHex.slice(0, 12)}…
							</td>
							<td class="px-4 py-3 text-right font-mono">{a.holderCount}</td>
							<td class="px-4 py-3 font-mono text-xs">{a.mode}</td>
							<td class="px-4 py-3 text-right">
								<span class={`px-2 py-0.5 rounded text-[11px] font-semibold ${tone(a.state)}`}>{a.state}</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="mt-6 flex justify-between text-sm">
			{#if data.offset > 0}
				<a
					href={`/airdrops?offset=${Math.max(0, data.offset - data.pageSize)}`}
					class="text-violet-600 dark:text-violet-400 hover:underline"
				>← Newer</a>
			{:else}
				<span></span>
			{/if}
			{#if data.hasMore}
				<a
					href={`/airdrops?offset=${data.offset + data.pageSize}`}
					class="text-violet-600 dark:text-violet-400 hover:underline"
				>Older →</a>
			{/if}
		</div>
	{/if}
</div>
