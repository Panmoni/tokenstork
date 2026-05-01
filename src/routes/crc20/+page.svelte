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
		<p class="text-slate-600 dark:text-zinc-200 max-w-3xl">
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
			<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-zinc-300">Total CRC-20</div>
			<div class="text-2xl font-bold text-slate-900 dark:text-white mt-1">{fmt(data.counts.totalCategories)}</div>
			<div class="text-xs text-slate-500 dark:text-zinc-300 mt-1">categories detected</div>
		</div>
		<div class="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40">
			<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-zinc-300">Canonical winners</div>
			<div class="text-2xl font-bold text-slate-900 dark:text-white mt-1">{fmt(data.counts.canonicalWinners)}</div>
			<div class="text-xs text-slate-500 dark:text-zinc-300 mt-1">one per symbol bucket</div>
		</div>
		<div class="p-4 rounded-xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800">
			<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-zinc-300">Distinct symbols</div>
			<div class="text-2xl font-bold text-slate-900 dark:text-white mt-1">{fmt(data.counts.distinctSymbols)}</div>
			<div class="text-xs text-slate-500 dark:text-zinc-300 mt-1">unique symbol bytes</div>
		</div>
		<div class="p-4 rounded-xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800">
			<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-zinc-300">Contested</div>
			<div class="text-2xl font-bold text-slate-900 dark:text-white mt-1">{fmt(data.counts.contestedSymbols)}</div>
			<div class="text-xs text-slate-500 dark:text-zinc-300 mt-1">categories with rivals</div>
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
			class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-200 text-sm font-semibold"
		>
			All CRC-20 incl. contenders
		</a>
		<a
			href="/?crc20=noncanonical&sort=recent"
			class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-200 text-sm font-semibold"
		>
			Non-canonical only
		</a>
	</div>

	{#if contested.length > 0}
		<section class="mb-10">
			<h2 class="text-xl font-bold text-slate-900 dark:text-white mb-3">
				Contested symbols
				<span class="text-sm font-normal text-slate-500 dark:text-zinc-300">({contested.length})</span>
			</h2>
			<p class="text-sm text-slate-600 dark:text-zinc-200 mb-4 max-w-3xl">
				Symbols claimed by more than one CashTokens category. The canonical-winner
				rule (lowest <span class="font-mono">max(commit_block, reveal_block − 20)</span>,
				breaking ties by category id then input index) picks exactly one as
				authoritative; the rest are still detectable but lose the symbol claim.
			</p>
			<div class="overflow-x-auto rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
				<table class="w-full text-sm">
					<thead class="bg-slate-50 dark:bg-zinc-800/50 text-left text-xs uppercase tracking-wider text-slate-500 dark:text-zinc-300">
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
								<td class="px-4 py-3 text-right font-mono text-slate-700 dark:text-zinc-200">{bucket.contenderCount}</td>
								<td class="px-4 py-3">
									{#if bucket.canonicalCategory}
										<a
											href={`/token/${bucket.canonicalCategory}`}
											class="font-mono text-violet-600 dark:text-violet-400 hover:underline"
										>
											{bucket.canonicalCategory.slice(0, 12)}…{bucket.canonicalCategory.slice(-6)}
										</a>
									{:else}
										<span class="text-slate-400 dark:text-zinc-400">—</span>
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
			<span class="text-sm font-normal text-slate-500 dark:text-zinc-300">({data.symbols.length})</span>
		</h2>
		{#if data.symbols.length === 0}
			<div class="p-8 rounded-xl border border-dashed border-slate-300 dark:border-zinc-700 text-center text-slate-500 dark:text-zinc-300">
				No CRC-20 categories detected yet. Run <span class="font-mono">sync-crc20-rescan</span> to backfill historical detections.
			</div>
		{:else}
			<div class="overflow-x-auto rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
				<table class="w-full text-sm">
					<thead class="bg-slate-50 dark:bg-zinc-800/50 text-left text-xs uppercase tracking-wider text-slate-500 dark:text-zinc-300">
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
								<td class="px-4 py-3 text-right font-mono text-slate-700 dark:text-zinc-200">1</td>
								<td class="px-4 py-3">
									{#if bucket.canonicalCategory}
										<a
											href={`/token/${bucket.canonicalCategory}`}
											class="font-mono text-violet-600 dark:text-violet-400 hover:underline"
										>
											{bucket.canonicalCategory.slice(0, 12)}…{bucket.canonicalCategory.slice(-6)}
										</a>
									{:else}
										<span class="text-slate-400 dark:text-zinc-400">—</span>
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
