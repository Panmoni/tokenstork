<script lang="ts">
	let { data } = $props();

	const fmt = (n: number) => n.toLocaleString('en-US');

	const byTypeTotal = $derived(data.byType.FT + data.byType.NFT + data.byType['FT+NFT']);
	const pct = (n: number) => (byTypeTotal === 0 ? 0 : Math.round((n / byTypeTotal) * 1000) / 10);

	// Genesis-by-month chart geometry. 680px wide × 140px tall viewport
	// scales to fill the container; `viewBox` preserves aspect so on
	// narrow viewports the bars narrow and month labels shrink. At mobile
	// widths we'd still overlap the tick text, so the label-cull logic
	// below uses an explicit `max labels` target (5) instead of trying to
	// derive it from pixel widths.
	const chartW = 680;
	const chartH = 140;
	const chartPadLeft = 40;
	const chartPadRight = 16;
	const chartPadBottom = 32;
	const chartPadTop = 10;
	const chartMaxLabels = 5;

	const growthBars = $derived.by(() => {
		const rows = data.genesisByMonth;
		if (!rows.length) return [] as Array<{ x: number; y: number; w: number; h: number; label: string; count: number }>;
		const maxCount = Math.max(...rows.map((r) => r.count), 1);
		const innerW = chartW - chartPadLeft - chartPadRight;
		const innerH = chartH - chartPadBottom - chartPadTop;
		const barW = innerW / rows.length;
		return rows.map((r, i) => {
			const h = (r.count / maxCount) * innerH;
			return {
				x: chartPadLeft + i * barW,
				y: chartPadTop + (innerH - h),
				w: Math.max(barW - 2, 1),
				h,
				label: r.month.slice(0, 7), // YYYY-MM
				count: r.count
			};
		});
	});

	const growthMax = $derived(
		data.genesisByMonth.length ? Math.max(...data.genesisByMonth.map((r) => r.count), 1) : 0
	);
	const growthTotal = $derived(data.genesisByMonth.reduce((a, r) => a + r.count, 0));

	// Decimals-histogram geometry. Simpler — 6 fixed buckets.
	const decMax = $derived(Math.max(...data.decimalsBuckets.map((b) => b.count), 1));

	// Metadata-completeness percentages (0-100). Null-safe against an
	// edge case where metadata.total is 0 on a fresh database.
	const metaPct = (n: number): number => {
		if (!data.metadata.total) return 0;
		return Math.round((n / data.metadata.total) * 1000) / 10;
	};
</script>

<svelte:head>
	<title>Stats — Token Stork</title>
	<meta name="description" content="Ecosystem-level statistics for the BCH CashTokens directory." />
</svelte:head>

<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<div class="mb-8">
		<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent">
			Stats
		</h1>
		<p class="text-slate-600 dark:text-slate-400 mt-2">
			Headline numbers for the BCH CashTokens ecosystem, computed directly from the tokens we've
			indexed.
		</p>
	</div>

	<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
		<div class="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">New — 24h</div>
			<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(data.newIn24h)}</div>
		</div>
		<div class="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">New — 7d</div>
			<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(data.newIn7d)}</div>
		</div>
		<div class="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">New — 30d</div>
			<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(data.newIn30d)}</div>
		</div>
	</div>

	<section class="mb-8">
		<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">By type</h2>
		<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
			{#each [['FT', data.byType.FT], ['NFT', data.byType.NFT], ['FT+NFT', data.byType['FT+NFT']]] as [label, count] (label)}
				<div class="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
					<div class="flex items-baseline justify-between">
						<span class="px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-sm font-medium">
							{label}
						</span>
						<span class="text-xs text-slate-500 dark:text-slate-400">{pct(count as number)}%</span>
					</div>
					<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(count as number)}</div>
				</div>
			{/each}
		</div>
	</section>

	<section class="mb-8">
		<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">Tradeable</h2>
		<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
			<div class="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
				<div class="flex items-baseline justify-between">
					<span class="px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-sm font-medium">
						Cauldron (AMM)
					</span>
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(data.cauldronListedCategories)}</div>
				<div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
					distinct tokens with an active pool price
				</div>
			</div>
			<div class="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
				<div class="flex items-baseline justify-between">
					<span class="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-sm font-medium">
						Tapswap (P2P)
					</span>
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(data.tapswapListedCategories)}</div>
				<div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
					distinct tokens with open listings
				</div>
			</div>
		</div>
	</section>

	<section class="mb-8">
		<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">Growth by month</h2>
		<p class="text-sm text-slate-500 dark:text-slate-400 mb-3">
			New categories minted each month since CashTokens activation. Bucketed by on-chain genesis block
			timestamp — {fmt(growthTotal)} tokens across the full history.
		</p>
		<div class="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
			{#if growthBars.length === 0}
				<p class="text-sm text-slate-500 dark:text-slate-400">No data yet.</p>
			{:else}
				<svg viewBox={`0 0 ${chartW} ${chartH}`} class="w-full h-auto" role="img" aria-label="Monthly token genesis count">
					<!-- y-axis ticks: 0, max/2, max -->
					<g class="text-[10px] fill-slate-400 dark:fill-slate-500" font-family="ui-monospace,monospace">
						<text x={chartPadLeft - 6} y={chartPadTop + 4} text-anchor="end">{fmt(growthMax)}</text>
						<text x={chartPadLeft - 6} y={chartPadTop + (chartH - chartPadTop - chartPadBottom) / 2 + 4} text-anchor="end">{fmt(Math.round(growthMax / 2))}</text>
						<text x={chartPadLeft - 6} y={chartH - chartPadBottom + 4} text-anchor="end">0</text>
					</g>
					<!-- baseline -->
					<line
						x1={chartPadLeft}
						x2={chartW - chartPadRight}
						y1={chartH - chartPadBottom}
						y2={chartH - chartPadBottom}
						class="stroke-slate-200 dark:stroke-slate-700"
						stroke-width="1"
					/>
					{#each growthBars as bar, i (bar.label)}
						<rect
							x={bar.x}
							y={bar.y}
							width={bar.w}
							height={bar.h}
							class="fill-violet-500 dark:fill-violet-400"
						>
							<title>{bar.label}: {fmt(bar.count)} new tokens</title>
						</rect>
						{#if i === 0 || i === growthBars.length - 1 || i % Math.max(1, Math.ceil(growthBars.length / chartMaxLabels)) === 0}
							<text
								x={bar.x + bar.w / 2}
								y={chartH - chartPadBottom + 14}
								text-anchor="middle"
								class="text-[10px] fill-slate-500 dark:fill-slate-400"
								font-family="ui-monospace,monospace"
							>
								{bar.label}
							</text>
						{/if}
					{/each}
				</svg>
			{/if}
		</div>
	</section>

	<section class="mb-8">
		<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">Venue overlap</h2>
		<p class="text-sm text-slate-500 dark:text-slate-400 mb-3">
			How tokens are split across our two trading venues. The "on both" set is the natural target
			for cross-venue arbitrage — same token, two different prices.
		</p>
		<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
			<div class="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
				<div class="flex items-baseline justify-between">
					<span class="px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-sm font-medium">
						Cauldron only
					</span>
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(data.venueOverlap.cauldronOnly)}</div>
				<div class="mt-1 text-xs text-slate-500 dark:text-slate-400">AMM-only, no P2P listings</div>
			</div>
			<div class="p-5 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20">
				<div class="flex items-baseline justify-between">
					<span class="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-sm font-medium">
						On both
					</span>
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(data.venueOverlap.both)}</div>
				<div class="mt-1 text-xs text-slate-500 dark:text-slate-400">arbitrage candidates</div>
			</div>
			<div class="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
				<div class="flex items-baseline justify-between">
					<span class="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-sm font-medium">
						Tapswap only
					</span>
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(data.venueOverlap.tapswapOnly)}</div>
				<div class="mt-1 text-xs text-slate-500 dark:text-slate-400">P2P-only, no AMM pool</div>
			</div>
		</div>
	</section>

	<section class="mb-8">
		<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">Metadata completeness</h2>
		<p class="text-sm text-slate-500 dark:text-slate-400 mb-3">
			What fraction of the {fmt(data.metadata.total)} indexed tokens publish each BCMR field. Empty
			strings count as missing — the directory treats them that way for display.
		</p>
		{#if data.metadata.total === 0}
			<div class="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-sm text-slate-600 dark:text-slate-400">
				No tokens indexed yet.
			</div>
		{:else}
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				{#each [['Name', data.metadata.hasName], ['Symbol', data.metadata.hasSymbol], ['Icon', data.metadata.hasIcon], ['Description', data.metadata.hasDescription]] as [label, count] (label)}
					{@const p = metaPct(count as number)}
					<div class="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
						<div class="flex items-baseline justify-between mb-2">
							<span class="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
							<span class="text-xs text-slate-500 dark:text-slate-400 font-mono">{fmt(count as number)} / {fmt(data.metadata.total)}</span>
						</div>
						<div class="relative h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
							<div
								class="absolute inset-y-0 left-0 bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full"
								style:width={`${p}%`}
							></div>
						</div>
						<div class="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono">{p.toFixed(1)}%</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<section class="mb-8">
		<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">Decimals distribution</h2>
		<p class="text-sm text-slate-500 dark:text-slate-400 mb-3">
			How FT and FT+NFT tokens choose their decimals. Most cash-token communities settle on a small
			set of canonical values; deviations often signal copy-paste configs.
		</p>
		<div class="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<div class="grid grid-cols-6 gap-3">
				{#each data.decimalsBuckets as bucket (bucket.label)}
					<div class="flex flex-col items-center">
						<div class="flex items-end h-24 w-full">
							{#if bucket.count > 0}
								<div
									class="w-full rounded-t bg-violet-500 dark:bg-violet-400 transition-all"
									style:height={`${Math.max(4, (bucket.count / decMax) * 100)}%`}
									title={`${bucket.count} tokens`}
								></div>
							{:else}
								<div class="w-full h-px bg-slate-200 dark:bg-slate-700" title="0 tokens"></div>
							{/if}
						</div>
						<div class="mt-2 text-xs font-mono text-slate-500 dark:text-slate-400">{bucket.label}</div>
						<div class="text-sm font-semibold text-slate-900 dark:text-white">{fmt(bucket.count)}</div>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<section class="mb-8">
		<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">Burn status</h2>
		{#if data.burned === null}
			<div class="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-sm text-slate-600 dark:text-slate-400">
				Burn status is enriched from live UTXO counts — this requires our BlockBook indexer, which
				is not yet deployed. Numbers will appear here once the enrichment worker has run.
			</div>
		{:else}
			<div class="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
				<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
					Fully burned
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(data.burned)}</div>
			</div>
		{/if}
	</section>

	<p class="text-xs text-slate-500 dark:text-slate-400 mt-10">
		Counts reflect what our indexer has seen since CashTokens activation at block 792,772 (May
		2023). Metadata comes from the BCMR registry via Paytaca's public indexer, refreshed every 4
		hours.
	</p>
</main>
