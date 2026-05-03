<script lang="ts">
	let { data } = $props();

	function tone(state: string): string {
		if (state === 'confirmed') return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300';
		if (state === 'failed') return 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300';
		if (state === 'broadcast' || state === 'signed')
			return 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300';
		if (state === 'drafting') return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
		return 'bg-slate-100 dark:bg-zinc-800 ts-text-muted';
	}

	// Click target depends on state. confirmed/broadcast jump to the token
	// page; drafts resume the wizard (which auto-resumes the latest draft);
	// failed/abandoned have no destination.
	function rowHref(m: typeof data.mints[number]): string | null {
		if ((m.state === 'confirmed' || m.state === 'broadcast') && m.categoryHex) {
			return `/token/${m.categoryHex}`;
		}
		if (m.state === 'drafting' || m.state === 'signed') {
			return `/mint?session=${m.id}`;
		}
		return null;
	}

	function formatSupply(supply: string | null, decimals: number | null): string {
		if (!supply) return '—';
		const d = decimals ?? 0;
		if (d === 0) return supply;
		try {
			const raw = BigInt(supply);
			const div = 10n ** BigInt(d);
			const whole = raw / div;
			const frac = raw % div;
			if (frac === 0n) return whole.toString();
			const fracStr = frac.toString().padStart(d, '0').replace(/0+$/, '');
			return `${whole}.${fracStr}`;
		} catch {
			return supply;
		}
	}
</script>

<svelte:head>
	<title>Your mints — Token Stork</title>
</svelte:head>

<div class="max-w-4xl mx-auto px-4 py-8">
	<div class="flex items-center justify-between mb-6">
		<h1 class="text-3xl font-bold ts-text-strong">Your mints</h1>
		<a
			href="/mint"
			class="px-3 py-2 rounded bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold"
		>
			New mint →
		</a>
	</div>

	{#if data.mints.length === 0}
		<div class="rounded-xl border ts-border-subtle p-8 text-center ts-surface-panel">
			<p class="ts-text-muted">You haven't minted any tokens yet.</p>
			<a
				href="/mint"
				class="inline-block mt-4 text-violet-600 dark:text-violet-400 hover:underline"
			>Mint a CashToken →</a>
		</div>
	{:else}
		<div class="rounded-xl border ts-border-subtle overflow-hidden ts-surface-panel">
			<table class="w-full text-sm">
				<thead class="text-xs font-semibold uppercase tracking-wider ts-text-muted border-b ts-border-subtle bg-slate-50 dark:bg-zinc-900/50">
					<tr>
						<th class="text-left px-4 py-3">When</th>
						<th class="text-left px-4 py-3">Token</th>
						<th class="text-left px-4 py-3">Type</th>
						<th class="text-right px-4 py-3">Supply</th>
						<th class="text-right px-4 py-3">State</th>
					</tr>
				</thead>
				<tbody>
					{#each data.mints as m (m.id)}
						{@const href = rowHref(m)}
						<tr class="border-b border-slate-100 dark:border-zinc-800/50 last:border-0 hover:bg-slate-50 dark:hover:bg-zinc-900/40">
							<td class="px-4 py-3">
								{#if href}
									<a {href} class="block">
										<div class="text-xs ts-text-muted">{new Date(m.createdAt * 1000).toLocaleString()}</div>
										<div class="font-mono text-[10px] truncate max-w-[10ch] ts-text-muted">{m.id.slice(0, 8)}</div>
									</a>
								{:else}
									<div class="text-xs ts-text-muted">{new Date(m.createdAt * 1000).toLocaleString()}</div>
									<div class="font-mono text-[10px] truncate max-w-[10ch] ts-text-muted">{m.id.slice(0, 8)}</div>
								{/if}
							</td>
							<td class="px-4 py-3">
								{#if m.ticker || m.name}
									<div class="font-semibold ts-text-strong">{m.ticker ?? '—'}</div>
									<div class="text-xs ts-text-muted truncate max-w-[24ch]">{m.name ?? ''}</div>
								{:else}
									<span class="ts-text-faint italic">unnamed draft</span>
								{/if}
							</td>
							<td class="px-4 py-3 font-mono text-xs">{m.tokenType ?? '—'}</td>
							<td class="px-4 py-3 text-right font-mono">
								{#if m.tokenType === 'NFT'}
									<span class="ts-text-muted">—</span>
								{:else}
									{formatSupply(m.supply, m.decimals)}
								{/if}
							</td>
							<td class="px-4 py-3 text-right">
								<span class={`px-2 py-0.5 rounded text-[11px] font-semibold ${tone(m.state)}`}>{m.state}</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="mt-6 flex justify-between text-sm">
			{#if data.offset > 0}
				<a
					href={`/mints?offset=${Math.max(0, data.offset - data.pageSize)}`}
					class="text-violet-600 dark:text-violet-400 hover:underline"
				>← Newer</a>
			{:else}
				<span></span>
			{/if}
			{#if data.hasMore}
				<a
					href={`/mints?offset=${data.offset + data.pageSize}`}
					class="text-violet-600 dark:text-violet-400 hover:underline"
				>Older →</a>
			{/if}
		</div>
	{/if}
</div>
