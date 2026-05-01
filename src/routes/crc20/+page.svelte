<script lang="ts">
	let { data } = $props();

	const fmt = (n: number) => n.toLocaleString('en-US');

	// Bucket the symbol list: contested (multiple contenders) goes in a
	// distinct table because it's the most interesting subset — visible
	// proof that the canonical-winner rule works on real on-chain data.
	const contested = $derived(data.symbols.filter((s) => s.contenderCount > 1));
	const uncontested = $derived(data.symbols.filter((s) => s.contenderCount === 1));
</script>

<svelte:head>
	<title>CRC-20 tokens — Token Stork</title>
	<meta
		name="description"
		content="CRC-20 tokens on Bitcoin Cash — names claimed via covenant in the genesis transaction, with deterministic per-symbol canonical winners detected from on-chain data."
	/>
</svelte:head>

<main class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
	<header class="mb-8">
		<h1 class="text-3xl font-bold text-slate-900 dark:text-white mb-2">
			CRC-20 tokens
		</h1>
		<p class="max-w-3xl ts-text-body">
			CRC-20 is a permissionless naming convention on top of Bitcoin Cash CashTokens.
			A token's <span class="font-semibold">symbol</span>, <span class="font-semibold">decimals</span>, and <span class="font-semibold">name</span>
			are encoded inside a 21-byte covenant in the genesis transaction. A deterministic
			per-symbol sort picks one
			<span class="font-semibold">canonical winner</span> per symbol bucket — the rest
			are non-canonical contenders. Every detection on this page is derived from
			on-chain data alone.
			<a href="https://crc20.cash/" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">Reference →</a>
		</p>
	</header>

	<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
		<div class="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40">
			<div class="text-xs uppercase tracking-wider ts-text-muted">Total CRC-20</div>
			<div class="text-2xl font-bold text-slate-900 dark:text-white mt-1">{fmt(data.counts.totalCategories)}</div>
			<div class="text-xs mt-1 ts-text-muted">categories detected</div>
		</div>
		<div class="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40">
			<div class="text-xs uppercase tracking-wider ts-text-muted">Canonical winners</div>
			<div class="text-2xl font-bold text-slate-900 dark:text-white mt-1">{fmt(data.counts.canonicalWinners)}</div>
			<div class="text-xs mt-1 ts-text-muted">one per symbol bucket</div>
		</div>
		<div class="p-4 rounded-xl border ts-border-subtle ts-surface-soft">
			<div class="text-xs uppercase tracking-wider ts-text-muted">Distinct symbols</div>
			<div class="text-2xl font-bold text-slate-900 dark:text-white mt-1">{fmt(data.counts.distinctSymbols)}</div>
			<div class="text-xs mt-1 ts-text-muted">unique symbol bytes</div>
		</div>
		<div class="p-4 rounded-xl border ts-border-subtle ts-surface-soft">
			<div class="text-xs uppercase tracking-wider ts-text-muted">Contested</div>
			<div class="text-2xl font-bold text-slate-900 dark:text-white mt-1">{fmt(data.counts.contestedSymbols)}</div>
			<div class="text-xs mt-1 ts-text-muted">categories with rivals</div>
		</div>
	</div>

	<div class="mb-8 flex flex-wrap gap-3">
		<a
			href="/?crc20=canonical&sort=tvl"
			class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold"
		>
			Browse canonical CRC-20 tokens →
		</a>
		<a
			href="/?crc20=true&sort=recent"
			class="inline-flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-700 text-sm font-semibold ts-text-strong ts-surface-chip"
		>
			All CRC-20 incl. contenders
		</a>
		<a
			href="/?crc20=noncanonical&sort=recent"
			class="inline-flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-700 text-sm font-semibold ts-text-strong ts-surface-chip"
		>
			Non-canonical only
		</a>
	</div>

	{#if contested.length > 0}
		<section class="mb-10">
			<h2 class="text-xl font-bold text-slate-900 dark:text-white mb-3">
				Contested symbols
				<span class="text-sm font-normal ts-text-muted">({contested.length})</span>
			</h2>
			<p class="text-sm mb-4 max-w-3xl ts-text-body">
				Symbols claimed by more than one CashTokens category. The canonical-winner
				rule (lowest <span class="font-mono">max(commit_block, reveal_block − 20)</span>,
				breaking ties by category id then input index) picks exactly one as
				authoritative; the rest are still detectable but lose the symbol claim.
			</p>
			<div class="overflow-x-auto rounded-xl border ts-border-subtle ts-surface-panel">
				<table class="w-full text-sm">
					<thead class="bg-slate-50 dark:bg-zinc-800/50 text-left text-xs uppercase tracking-wider ts-text-muted">
						<tr>
							<th class="px-4 py-2">Symbol</th>
							<th class="px-4 py-2 text-right">Contenders</th>
							<th class="px-4 py-2">Canonical winner</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100 dark:divide-zinc-800">
						{#each contested as bucket (bucket.symbol + bucket.symbolIsHex)}
							<tr class="hover:bg-slate-50 dark:hover:bg-zinc-800/30">
								<td class="px-4 py-3 font-mono text-slate-900 dark:text-white">
									{bucket.symbol || '<empty>'}
									{#if bucket.symbolIsHex}
										<span class="ml-2 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400">non-UTF-8</span>
									{/if}
								</td>
								<td class="px-4 py-3 text-right font-mono ts-text-strong">{bucket.contenderCount}</td>
								<td class="px-4 py-3">
									{#if bucket.canonicalCategory}
										<a
											href={`/token/${bucket.canonicalCategory}`}
											class="font-mono text-violet-600 dark:text-violet-400 hover:underline"
										>
											{bucket.canonicalCategory.slice(0, 12)}…{bucket.canonicalCategory.slice(-6)}
										</a>
									{:else}
										<span class="ts-text-faint">—</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	<section>
		<h2 class="text-xl font-bold text-slate-900 dark:text-white mb-3">
			All symbol buckets
			<span class="text-sm font-normal ts-text-muted">({data.symbols.length})</span>
		</h2>
		{#if data.symbols.length === 0}
			<div class="p-8 rounded-xl border border-dashed text-center ts-text-muted ts-border-strong">
				No CRC-20 categories detected yet. Run <span class="font-mono">sync-crc20-rescan</span> to backfill historical detections.
			</div>
		{:else}
			<div class="overflow-x-auto rounded-xl border ts-border-subtle ts-surface-panel">
				<table class="w-full text-sm">
					<thead class="bg-slate-50 dark:bg-zinc-800/50 text-left text-xs uppercase tracking-wider ts-text-muted">
						<tr>
							<th class="px-4 py-2">Symbol</th>
							<th class="px-4 py-2 text-right">Contenders</th>
							<th class="px-4 py-2">Canonical winner</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100 dark:divide-zinc-800">
						{#each uncontested as bucket (bucket.symbol + bucket.symbolIsHex)}
							<tr class="hover:bg-slate-50 dark:hover:bg-zinc-800/30">
								<td class="px-4 py-3 font-mono text-slate-900 dark:text-white">
									{bucket.symbol || '<empty>'}
									{#if bucket.symbolIsHex}
										<span class="ml-2 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400">non-UTF-8</span>
									{/if}
								</td>
								<td class="px-4 py-3 text-right font-mono ts-text-strong">1</td>
								<td class="px-4 py-3">
									{#if bucket.canonicalCategory}
										<a
											href={`/token/${bucket.canonicalCategory}`}
											class="font-mono text-violet-600 dark:text-violet-400 hover:underline"
										>
											{bucket.canonicalCategory.slice(0, 12)}…{bucket.canonicalCategory.slice(-6)}
										</a>
									{:else}
										<span class="ts-text-faint">—</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</main>
