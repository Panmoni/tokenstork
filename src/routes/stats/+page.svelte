<script lang="ts">
	import Movers24h from '$lib/components/Movers24h.svelte';
	import { Tooltip, TooltipTrigger, TooltipContent } from '$lib/components/ui/tooltip';

	let { data } = $props();

	const fmt = (n: number) => n.toLocaleString('en-US');
	const fmtBch = (sats: number) =>
		sats > 0 ? (sats / 1e8).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '0';
	const fmtUsd = (usd: number) =>
		usd >= 1_000_000
			? `$${(usd / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 2 })}M`
			: usd >= 1_000
				? `$${(usd / 1_000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`
				: `$${usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

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

	// Gini histogram helpers. Bucket-tier colors mirror the per-token
	// `giniTier` palette on the detail page so the visual story is the
	// same in both places.
	const giniBucketMax = $derived(Math.max(...data.giniBuckets.map((b) => b.count), 1));
	const GINI_TIER_COLORS = [
		'fill-green-500 dark:fill-green-400',
		'fill-emerald-500 dark:fill-emerald-400',
		'fill-amber-500 dark:fill-amber-400',
		'fill-orange-500 dark:fill-orange-400',
		'fill-rose-500 dark:fill-rose-400'
	];

	// Cauldron unique-addresses chart — cumulative running total per month
	// from indexer.cauldron.quest. Reuses the same chart geometry as the
	// genesis-by-month chart for visual consistency.
	const uniqueBars = $derived.by(() => {
		const rows = data.cauldronStats.uniqueAddressesByMonth;
		if (!rows.length)
			return [] as Array<{ x: number; y: number; w: number; h: number; label: string; count: number }>;
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
				label: r.month,
				count: r.count
			};
		});
	});
	const uniqueMax = $derived(
		data.cauldronStats.uniqueAddressesByMonth.length
			? Math.max(...data.cauldronStats.uniqueAddressesByMonth.map((r) => r.count), 1)
			: 0
	);

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
		<p class="mt-2 ts-text-muted">
			Headline numbers for the BCH CashTokens ecosystem, computed directly from the tokens we've
			indexed.
		</p>
	</div>

	<!--
		"New — N" cards link into the directory with the matching
		new24h / new7d / new30d URL filter + sort=recent, so clicking
		"New — 7d / 119" drops you on the exact list of those tokens.
		Hover state: slight violet highlight + tiny arrow hint.
	-->
	<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
		{#each [
			{ label: 'New — 24h', count: data.newIn24h, href: '/?new24h=1&sort=recent' },
			{ label: 'New — 7d',  count: data.newIn7d,  href: '/?new7d=1&sort=recent'  },
			{ label: 'New — 30d', count: data.newIn30d, href: '/?new30d=1&sort=recent' }
		] as card (card.label)}
			<a
				href={card.href}
				class="group p-5 rounded-xl border hover:border-violet-400 dark:hover:border-violet-600 transition-colors no-underline ts-border-subtle ts-surface-panel"
			>
				<div class="flex items-center justify-between">
					<div class="text-xs uppercase tracking-wider ts-text-muted">{card.label}</div>
					<span class="text-violet-500 opacity-0 group-hover:opacity-100 transition-opacity text-sm" aria-hidden="true">→</span>
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">{fmt(card.count)}</div>
			</a>
		{/each}
	</div>

	<section class="mb-8">
		<div class="flex items-baseline justify-between mb-3">
			<h2 class="text-xl font-semibold text-slate-900 dark:text-white">By type</h2>
			<a href="/faq#faq-ft-nft" class="text-xs text-violet-600 dark:text-violet-400 hover:underline">What's FT+NFT?</a>
		</div>
		<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
			<!--
				Each card links into the directory filtered by token_type.
				Inline SVGs instead of raster logos since CashTokens doesn't
				have canonical type icons. Lucide-style stroke icons match
				the site's overall visual language (ThemeSwitcher + Header
				mobile-menu use the same aesthetic).
				- FT      → stacked coins (fungible: interchangeable units)
				- NFT     → picture frame (non-fungible: unique item)
				- FT+NFT  → layered squares (both semantics on one category)
			-->
			<a
				href="/?type=FT&sort=tvl"
				class="group p-5 rounded-xl border hover:border-violet-400 dark:hover:border-violet-600 transition-colors no-underline ts-border-subtle ts-surface-panel"
			>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<span class="flex items-center justify-center w-9 h-9 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300">
							<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<circle cx="8" cy="8" r="6" />
								<path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
								<path d="M7 6h1v4" />
								<path d="m16.71 13.88.7.71-2.82 2.82" />
							</svg>
						</span>
						<span class="font-semibold text-slate-900 dark:text-white">FT</span>
					</div>
					<span class="text-xs ts-text-muted">{pct(data.byType.FT)}%</span>
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">{fmt(data.byType.FT)}</div>
				<div class="mt-1 text-xs ts-text-muted">fungible only</div>
			</a>

			<a
				href="/?type=NFT&sort=tvl"
				class="group p-5 rounded-xl border hover:border-fuchsia-400 dark:hover:border-fuchsia-600 transition-colors no-underline ts-border-subtle ts-surface-panel"
			>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<span class="flex items-center justify-center w-9 h-9 rounded-lg bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-600 dark:text-fuchsia-300">
							<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
								<circle cx="9" cy="9" r="2" />
								<path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
							</svg>
						</span>
						<span class="font-semibold text-slate-900 dark:text-white">NFT</span>
					</div>
					<span class="text-xs ts-text-muted">{pct(data.byType.NFT)}%</span>
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white group-hover:text-fuchsia-600 dark:group-hover:text-fuchsia-400 transition-colors">{fmt(data.byType.NFT)}</div>
				<div class="mt-1 text-xs ts-text-muted">non-fungible only</div>
			</a>

			<a
				href="/?type=FT%2BNFT&sort=tvl"
				class="group p-5 rounded-xl border hover:border-indigo-400 dark:hover:border-indigo-600 transition-colors no-underline ts-border-subtle ts-surface-panel"
			>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<span class="flex items-center justify-center w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300">
							<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
								<path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
								<path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
							</svg>
						</span>
						<span class="font-semibold text-slate-900 dark:text-white">FT+NFT</span>
					</div>
					<span class="text-xs ts-text-muted">{pct(data.byType['FT+NFT'])}%</span>
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{fmt(data.byType['FT+NFT'])}</div>
				<div class="mt-1 text-xs ts-text-muted">hybrid (fungible + non-fungible)</div>
			</a>
		</div>
	</section>

	<section class="mb-8">
		<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">Tradeable</h2>
		<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
			<a
				href="/?cauldron=1&sort=tvl"
				class="group p-5 rounded-xl border hover:border-violet-400 dark:hover:border-violet-600 transition-colors no-underline ts-border-subtle ts-surface-panel"
			>
				<div class="flex items-center gap-3">
					<img src="/cauldron-logo.png" alt="" class="w-7 h-7 rounded-full bg-slate-900 p-0.5" aria-hidden="true" />
					<span class="font-semibold text-slate-900 dark:text-white">Cauldron <span class="text-xs font-normal ts-text-muted">(AMM)</span></span>
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">{fmt(data.cauldronListedCategories)}</div>
				<div class="mt-1 text-xs ts-text-muted">
					distinct tokens with an active pool price
				</div>
			</a>
			<a
				href="/?tapswap=1&sort=recent"
				class="group p-5 rounded-xl border hover:border-emerald-400 dark:hover:border-emerald-600 transition-colors no-underline ts-border-subtle ts-surface-panel"
			>
				<div class="flex items-center gap-3">
					<img src="/tapswap-logo.png" alt="" class="w-7 h-7 rounded" aria-hidden="true" />
					<span class="font-semibold text-slate-900 dark:text-white">Tapswap <span class="text-xs font-normal ts-text-muted">(P2P)</span></span>
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">{fmt(data.tapswapListedCategories)}</div>
				<div class="mt-1 text-xs ts-text-muted">
					distinct tokens with open listings
				</div>
			</a>
			<a
				href="/?fex=1&sort=tvl"
				class="group p-5 rounded-xl border hover:border-sky-400 dark:hover:border-sky-600 transition-colors no-underline ts-border-subtle ts-surface-panel"
			>
				<div class="flex items-center gap-3">
					<img src="/fex-logo.png" alt="" class="w-7 h-7 rounded-full" aria-hidden="true" />
					<span class="font-semibold text-slate-900 dark:text-white">Fex <span class="text-xs font-normal ts-text-muted">(AMM)</span></span>
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">{fmt(data.fexListedCategories)}</div>
				<div class="mt-1 text-xs ts-text-muted">
					distinct tokens with an active pool price
				</div>
			</a>
		</div>
	</section>

	<section class="mb-8">
		<div class="flex items-baseline justify-between mb-3">
			<h2 class="text-xl font-semibold text-slate-900 dark:text-white">Cauldron AMM</h2>
			<a
				href="https://app.cauldron.quest/stats"
				target="_blank"
				rel="noopener noreferrer"
				class="text-xs text-violet-600 dark:text-violet-400 hover:underline"
			>
				View on Cauldron →
			</a>
		</div>
		<p class="text-sm mb-3 ts-text-muted">
			Live aggregates from <span class="font-mono">indexer.cauldron.quest</span>. TVL is the
			BCH-side reserve only — conservative (industry convention doubles this to count the token
			side too). Volumes are sampled at page render.
		</p>
		<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
			<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
				<div class="text-xs uppercase tracking-wider ts-text-muted">TVL</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">
					{fmtUsd(data.cauldronStats.tvlUSD)}
				</div>
				<div class="mt-1 text-xs font-mono ts-text-muted">
					{fmtBch(data.cauldronStats.tvlSats)} BCH
				</div>
			</div>
			<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
				<div class="text-xs uppercase tracking-wider ts-text-muted">
					Volume — 24h
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">
					{fmtUsd(data.cauldronStats.volume24hUSD)}
				</div>
				<div class="mt-1 text-xs font-mono ts-text-muted">
					{fmtBch(data.cauldronStats.volume24hSats)} BCH
				</div>
			</div>
			<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
				<div class="text-xs uppercase tracking-wider ts-text-muted">
					Volume — 7d
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">
					{fmtUsd(data.cauldronStats.volume7dUSD)}
				</div>
				<div class="mt-1 text-xs font-mono ts-text-muted">
					{fmtBch(data.cauldronStats.volume7dSats)} BCH
				</div>
			</div>
			<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
				<div class="text-xs uppercase tracking-wider ts-text-muted">
					Volume — 30d
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">
					{fmtUsd(data.cauldronStats.volume30dUSD)}
				</div>
				<div class="mt-1 text-xs font-mono ts-text-muted">
					{fmtBch(data.cauldronStats.volume30dSats)} BCH
				</div>
			</div>
		</div>
		<div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
			<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
				<div class="text-xs uppercase tracking-wider ts-text-muted">
					Active pools
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">
					{fmt(data.cauldronStats.pools.active)}
				</div>
			</div>
			<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
				<div class="text-xs uppercase tracking-wider ts-text-muted">
					Ended pools
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">
					{fmt(data.cauldronStats.pools.ended)}
				</div>
				<div class="mt-1 text-xs ts-text-muted">lifetime, swept or closed</div>
			</div>
			<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
				<div class="text-xs uppercase tracking-wider ts-text-muted">
					Lifetime swap interactions
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">
					{fmt(data.cauldronStats.pools.interactions)}
				</div>
			</div>
		</div>
		{#if uniqueBars.length > 0}
			<div class="p-5 rounded-xl border overflow-x-auto ts-border-subtle ts-surface-panel">
				<div class="flex items-baseline justify-between mb-2">
					<h3 class="text-sm font-semibold ts-text-strong">
						Cumulative unique addresses by month
					</h3>
					<span class="text-xs font-mono ts-text-muted">
						{fmt(data.cauldronStats.uniqueAddressesByMonth[data.cauldronStats.uniqueAddressesByMonth.length - 1].count)}
						total
					</span>
				</div>
				<svg
					viewBox={`0 0 ${chartW} ${chartH}`}
					class="w-full h-auto"
					role="img"
					aria-label="Cumulative unique Cauldron addresses by month"
				>
					<g class="text-[10px] fill-slate-400 dark:fill-zinc-500" font-family="ui-monospace,monospace">
						<text x={chartPadLeft - 6} y={chartPadTop + 4} text-anchor="end">{fmt(uniqueMax)}</text>
						<text x={chartPadLeft - 6} y={chartPadTop + (chartH - chartPadTop - chartPadBottom) / 2 + 4} text-anchor="end">{fmt(Math.round(uniqueMax / 2))}</text>
						<text x={chartPadLeft - 6} y={chartH - chartPadBottom + 4} text-anchor="end">0</text>
					</g>
					<line
						x1={chartPadLeft}
						x2={chartW - chartPadRight}
						y1={chartH - chartPadBottom}
						y2={chartH - chartPadBottom}
						class="stroke-slate-200 dark:stroke-zinc-700"
						stroke-width="1"
					/>
					{#each uniqueBars as bar, i (bar.label)}
						<rect
							x={bar.x}
							y={bar.y}
							width={bar.w}
							height={bar.h}
							class="fill-violet-500 dark:fill-violet-400"
						>
							<title>{bar.label}: {fmt(bar.count)} cumulative addresses</title>
						</rect>
						{#if i === 0 || i === uniqueBars.length - 1 || i % Math.max(1, Math.ceil(uniqueBars.length / chartMaxLabels)) === 0}
							<text
								x={bar.x + bar.w / 2}
								y={chartH - chartPadBottom + 14}
								text-anchor="middle"
								class="text-[10px] fill-slate-500 dark:fill-zinc-400"
								font-family="ui-monospace,monospace"
							>
								{bar.label}
							</text>
						{/if}
					{/each}
				</svg>
			</div>
		{/if}
	</section>

	<section class="mb-8">
		<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">Growth by month</h2>
		<p class="text-sm mb-3 ts-text-muted">
			New categories minted each month since CashTokens activation. Bucketed by on-chain genesis block
			timestamp — {fmt(growthTotal)} tokens across the full history.
		</p>
		<div class="p-5 rounded-xl border overflow-x-auto ts-border-subtle ts-surface-panel">
			{#if growthBars.length === 0}
				<p class="text-sm ts-text-muted">No data yet.</p>
			{:else}
				<svg viewBox={`0 0 ${chartW} ${chartH}`} class="w-full h-auto" role="img" aria-label="Monthly token genesis count">
					<!-- y-axis ticks: 0, max/2, max -->
					<g class="text-[10px] fill-slate-400 dark:fill-zinc-500" font-family="ui-monospace,monospace">
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
						class="stroke-slate-200 dark:stroke-zinc-700"
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
						{#if bar.count > 0}
							<text
								x={bar.x + bar.w / 2}
								y={Math.max(bar.y - 3, chartPadTop - 1)}
								text-anchor="middle"
								class="text-[9px] fill-slate-700 dark:fill-zinc-200"
								font-family="ui-monospace,monospace"
							>
								{fmt(bar.count)}
							</text>
						{/if}
						{#if i === 0 || i === growthBars.length - 1 || i % Math.max(1, Math.ceil(growthBars.length / chartMaxLabels)) === 0}
							<text
								x={bar.x + bar.w / 2}
								y={chartH - chartPadBottom + 14}
								text-anchor="middle"
								class="text-[10px] fill-slate-500 dark:fill-zinc-400"
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
		<p class="text-sm mb-3 ts-text-muted">
			How the indexed tokens distribute across our three trading venues. The pair / triple
			intersections are the natural targets for cross-venue arbitrage — same token, different
			prices on each.
		</p>
		<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
			<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
				<span class="px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-sm font-medium">
					Cauldron only
				</span>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(data.venueOverlap.cauldronOnly)}</div>
			</div>
			<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
				<span class="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-sm font-medium">
					Tapswap only
				</span>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(data.venueOverlap.tapswapOnly)}</div>
			</div>
			<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
				<span class="px-2 py-0.5 rounded bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 text-sm font-medium">
					Fex only
				</span>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(data.venueOverlap.fexOnly)}</div>
			</div>
			<div class="p-5 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20">
				<span class="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-sm font-medium">
					Cauldron + Fex
				</span>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white" title="AMM-vs-AMM arbitrage candidates">{fmt(data.venueOverlap.cauldronAndFex)}</div>
			</div>
			<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
				<span class="px-2 py-0.5 rounded text-sm font-medium ts-text-body ts-surface-chip">
					Cauldron + Tapswap
				</span>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(data.venueOverlap.cauldronAndTapswap)}</div>
			</div>
			<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
				<span class="px-2 py-0.5 rounded text-sm font-medium ts-text-body ts-surface-chip">
					Tapswap + Fex
				</span>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(data.venueOverlap.tapswapAndFex)}</div>
			</div>
			<div class="p-5 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20 col-span-2 md:col-span-1">
				<span class="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-sm font-medium">
					All three
				</span>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white" title="Best arbitrage surface — three-way price comparison">{fmt(data.venueOverlap.allThree)}</div>
			</div>
		</div>
	</section>

	<section class="mb-8">
		<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">Metadata completeness</h2>
		<p class="text-sm mb-3 ts-text-muted">
			What fraction of the {fmt(data.metadata.total)} indexed tokens publish each BCMR field. Empty
			strings count as missing — the directory treats them that way for display.
		</p>
		{#if data.metadata.total === 0}
			<div class="p-5 rounded-xl border bg-slate-50 dark:bg-zinc-900/50 text-sm ts-text-muted ts-border-subtle">
				No tokens indexed yet.
			</div>
		{:else}
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				{#each [['Name', data.metadata.hasName], ['Symbol', data.metadata.hasSymbol], ['Icon', data.metadata.hasIcon], ['Description', data.metadata.hasDescription]] as [label, count] (label)}
					{@const p = metaPct(count as number)}
					<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
						<div class="flex items-baseline justify-between mb-2">
							<span class="text-sm font-medium ts-text-strong">{label}</span>
							<span class="text-xs font-mono ts-text-muted">{fmt(count as number)} / {fmt(data.metadata.total)}</span>
						</div>
						<!--
							SVG progress bar (was a `<div style:width=...>` overlay
							before — refactored to SVG so we can drop
							`style-src 'unsafe-inline'` from the CSP). 100×8
							viewBox stretched horizontally; rect width = pct.
						-->
						<svg viewBox="0 0 100 8" preserveAspectRatio="none" class="block w-full h-2 rounded-full overflow-hidden ts-surface-chip" role="progressbar" aria-valuenow={p} aria-valuemin="0" aria-valuemax="100">
							<rect x="0" y="0" width={p} height="8" class="fill-violet-500 dark:fill-violet-400" />
						</svg>
						<div class="mt-1 text-xs font-mono ts-text-muted">{p.toFixed(1)}%</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<section class="mb-8">
		<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">Ecosystem TVL — last 30 days</h2>
		<p class="text-sm mb-3 ts-text-muted">
			Daily mean BCH-side reserve summed across every Cauldron + Fex pool we index. Lines move
			with both pool inflows/outflows AND BCH-price-driven token-side rebalancing — this is
			conservative single-side TVL, not the doubled industry convention. Tapswap (P2P) is
			deliberately excluded.
		</p>
		<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
			{#if data.ecosystemTvl30d.length === 0}
				<p class="text-sm ts-text-muted">
					No history yet — the price-history table is still accumulating points.
				</p>
			{:else}
				{@const tvls = data.ecosystemTvl30d.map((p) => p.tvlSats)}
				{@const minTvl = Math.min(...tvls)}
				{@const maxTvl = Math.max(...tvls)}
				{@const range = maxTvl - minTvl || 1}
				<svg viewBox="0 0 600 120" class="w-full h-32" role="img" aria-label="30-day ecosystem TVL trend">
					<title>30-day ecosystem TVL</title>
					{#if data.ecosystemTvl30d.length > 1}
						<polyline
							class="stroke-violet-500 dark:stroke-violet-400"
							fill="none"
							stroke-width="1.5"
							stroke-linejoin="round"
							points={data.ecosystemTvl30d
								.map((p, i) => {
									const x = (i / (data.ecosystemTvl30d.length - 1)) * 600;
									const y = 110 - ((p.tvlSats - minTvl) / range) * 100;
									return `${x.toFixed(1)},${y.toFixed(1)}`;
								})
								.join(' ')}
						/>
					{/if}
				</svg>
				<div class="mt-2 flex justify-between text-xs font-mono ts-text-muted">
					<span>{data.ecosystemTvl30d[0]?.day}</span>
					<span>{(maxTvl / 1e8).toFixed(2)} BCH (max)</span>
					<span>{data.ecosystemTvl30d[data.ecosystemTvl30d.length - 1]?.day}</span>
				</div>
			{/if}
		</div>
	</section>

	<section class="mb-8">
		<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">FT supply distribution</h2>
		<p class="text-sm mb-3 ts-text-muted">
			How fungible (FT and FT+NFT) tokens distribute by displayable supply (current_supply ÷
			10^decimals). Buckets are powers of ten; "zero / unknown" includes tokens we haven't
			enriched yet.
		</p>
		{#if data.supplyBuckets.length === 0}
			<div class="p-5 rounded-xl border text-sm ts-text-muted ts-border-subtle ts-surface-panel">
				No data yet.
			</div>
		{:else}
			{@const supplyMax = Math.max(...data.supplyBuckets.map((b) => b.count), 1)}
			<!--
				Per-bucket vertical bar via SVG geometry (was
				`<div style:height=...>` before; refactored to SVG so we can
				drop `style-src 'unsafe-inline'` from the CSP). Each bar is
				its own 10×100 viewBox stretched into a 5rem-tall flex cell.
				Bar height = max(4, (count / max) * 100) — matches the prior
				CSS-percentage idiom exactly.
			-->
			<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
				<div class="grid grid-cols-3 sm:grid-cols-9 gap-3">
					{#each data.supplyBuckets as bucket (bucket.label)}
						{@const h = Math.max(4, (bucket.count / supplyMax) * 100)}
						<div class="flex flex-col items-center">
							<svg viewBox="0 0 10 100" preserveAspectRatio="none" class="h-20 w-full block" role="img" aria-label={`${bucket.label}: ${bucket.count} tokens`}>
								<title>{bucket.count} tokens</title>
								<rect x="0" y={100 - h} width="10" height={h} rx="1" ry="1" class="fill-violet-500 dark:fill-violet-400 transition-all" />
							</svg>
							<div class="mt-2 text-[10px] font-mono text-center ts-text-muted">{bucket.label}</div>
							<div class="text-sm font-semibold text-slate-900 dark:text-white">{fmt(bucket.count)}</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</section>

	<section class="mb-8">
		<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">Decimals distribution</h2>
		<p class="text-sm mb-3 ts-text-muted">
			How FT and FT+NFT tokens choose their decimals. Most cash-token communities settle on a small
			set of canonical values; deviations often signal copy-paste configs.
		</p>
		<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
			<div class="grid grid-cols-6 gap-3">
				{#each data.decimalsBuckets as bucket (bucket.label)}
					{@const h = bucket.count > 0 ? Math.max(4, (bucket.count / decMax) * 100) : 0.5}
					<div class="flex flex-col items-center">
						<!--
							Same SVG-bar pattern as the supply distribution chart
							above. The 0-count case renders a sliver-thin
							slate baseline rather than nothing, matching the
							pre-refactor visual.
						-->
						<svg viewBox="0 0 10 100" preserveAspectRatio="none" class="h-24 w-full block" role="img" aria-label={`${bucket.label} decimals: ${bucket.count} tokens`}>
							<title>{bucket.count} tokens</title>
							{#if bucket.count > 0}
								<rect x="0" y={100 - h} width="10" height={h} rx="1" ry="1" class="fill-violet-500 dark:fill-violet-400 transition-all" />
							{:else}
								<rect x="0" y={99.5} width="10" height={0.5} class="fill-slate-200 dark:fill-zinc-700" />
							{/if}
						</svg>
						<div class="mt-2 text-xs font-mono ts-text-muted">{bucket.label}</div>
						<div class="text-sm font-semibold text-slate-900 dark:text-white">{fmt(bucket.count)}</div>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<section class="mb-8">
		<div class="flex items-baseline gap-3 mb-3">
			<h2 class="text-xl font-semibold text-slate-900 dark:text-white">Holder distribution (Gini)</h2>
			{#if data.giniMedian != null}
				<Tooltip>
					<TooltipTrigger class="text-sm cursor-help ts-text-muted">
						median {data.giniMedian.toFixed(2)}
					</TooltipTrigger>
					<TooltipContent>
						Median Gini across all tokens with at least 10 holders. Reported as median (not mean) because the directory's distribution is heavily right-skewed — a handful of single-whale categories pull the mean toward 1.0 and obscure the typical token's score.
					</TooltipContent>
				</Tooltip>
			{/if}
		</div>
		<p class="text-sm mb-3 ts-text-muted">
			Gini coefficient measures how unequally a token's supply is split across its holders. 0 = perfectly equal; 1 = one address owns everything. Crypto distributions concentrate harder than country-income distributions — Bitcoin's holder-Gini is around 0.97 — so the tier cutoffs are calibrated for that reality. Excluded: tokens with fewer than 10 holders (where the math produces meaningless extremes).
		</p>
		<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
			<!--
				Each tier links into the directory filtered by ?gini_tier=<slug>.
				Slugs are the lowercase label, with `whale-controlled` shortened
				to `whale` to keep URLs tidy. The homepage server load maps the
				slug back to the same [lo, hi) ranges the SQL histogram uses.
			-->
			<div class="grid grid-cols-5 gap-3">
				{#each data.giniBuckets as bucket, idx (bucket.bucket)}
					{@const h = bucket.count > 0 ? Math.max(4, (bucket.count / giniBucketMax) * 100) : 0.5}
					{@const slug = bucket.label.toLowerCase().split('-')[0]}
					<a
						href={`/?gini_tier=${slug}`}
						class="group flex flex-col items-center no-underline rounded-md p-1 -m-1 hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition-colors"
						title={`Show all ${bucket.count} tokens in the "${bucket.label}" Gini tier`}
					>
						<svg viewBox="0 0 10 100" preserveAspectRatio="none" class="h-24 w-full block" role="img" aria-label={`${bucket.label}: ${bucket.count} tokens`}>
							<title>{bucket.label}: {bucket.count} tokens</title>
							{#if bucket.count > 0}
								<rect x="0" y={100 - h} width="10" height={h} rx="1" ry="1" class={`${GINI_TIER_COLORS[idx]} transition-all`} />
							{:else}
								<rect x="0" y={99.5} width="10" height={0.5} class="fill-slate-200 dark:fill-zinc-700" />
							{/if}
						</svg>
						<div class="mt-2 text-xs font-mono text-center group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors ts-text-muted">{bucket.label}</div>
						<div class="text-sm font-semibold text-slate-900 dark:text-white">{fmt(bucket.count)}</div>
					</a>
				{/each}
			</div>
		</div>
	</section>

	<section class="mb-8">
		<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">Burn status</h2>
		{#if data.burned === null}
			<div class="p-5 rounded-xl border bg-slate-50 dark:bg-zinc-900/50 text-sm ts-text-muted ts-border-subtle">
				Burn status is enriched from live UTXO counts — this requires our BlockBook indexer, which
				is not yet deployed. Numbers will appear here once the enrichment worker has run.
			</div>
		{:else}
			<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
				<div class="text-xs uppercase tracking-wider ts-text-muted">
					Fully burned
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(data.burned)}</div>
			</div>
		{/if}
	</section>

	<section class="mb-8">
		<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">Moderation</h2>
		<p class="text-sm mb-3 ts-text-muted">
			Categories filtered out of every other counter on this page. Hidden from the directory and the
			public API; we publish the list for transparency.
		</p>
		<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
			<a
				href="/moderated"
				class="group p-5 rounded-xl border hover:border-rose-400 dark:hover:border-rose-600 transition-colors no-underline ts-border-subtle ts-surface-panel"
			>
				<div class="flex items-center justify-between">
					<div class="text-xs uppercase tracking-wider ts-text-muted">
						Moderated tokens
					</div>
					<span class="text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity text-sm" aria-hidden="true">→</span>
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">{fmt(data.moderated)}</div>
				<div class="mt-1 text-xs ts-text-muted">
					see the list with reason and date
				</div>
			</a>
		</div>
	</section>

	<!--
		Icon safety pipeline — counts per UNIQUE IMAGE HASH. Per-blocked-hash
		listing + reason breakdown live on /moderated; this card surfaces just
		the headline numbers + a pointer. Lives at the bottom of /stats
		because it's an operational/safety metric, not an ecosystem-growth
		one — the engaging stuff (movers, growth, supply) leads the page.
	-->
	{#if data.iconStats && data.iconStats.totalUrls > 0}
		<section class="mb-8">
			<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">Icon safety</h2>
			<p class="text-sm mb-3 ts-text-muted">
				Every BCMR-supplied token icon is scanned for adult content + CSAM, capped at 2 MiB,
				transcoded to static WebP, and served from our origin (never hot-linked). Counts below
				are per unique image hash — a single hash can back many tokens.
				<a href="/moderated#image-safety" class="text-violet-600 dark:text-violet-400 hover:underline">
					Per-reason breakdown on /moderated
				</a>.
			</p>
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
				<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
					<div class="text-xs uppercase tracking-wider ts-text-muted">Cleared</div>
					<div class="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
						{fmt(data.iconStats.cleared)}
					</div>
					<div class="text-xs mt-1 ts-text-muted">
						{fmt(data.iconStats.tokensWithClearedIcon)} tokens use these
					</div>
				</div>
				<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
					<div class="text-xs uppercase tracking-wider ts-text-muted">Blocked</div>
					<div class="mt-1 text-2xl font-bold text-rose-600 dark:text-rose-400">
						{fmt(
							data.iconStats.blockedAdult +
								data.iconStats.blockedOversize +
								data.iconStats.blockedUnsupported +
								data.iconStats.blockedCsam
						)}
					</div>
					<div class="text-xs mt-1 ts-text-muted">
						adult / oversize / format
					</div>
				</div>
				<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
					<div class="text-xs uppercase tracking-wider ts-text-muted">In review</div>
					<div class="mt-1 text-2xl font-bold text-violet-600 dark:text-violet-400">
						{fmt(data.iconStats.review)}
					</div>
					<div class="text-xs mt-1 ts-text-muted">operator decides</div>
				</div>
				<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
					<div class="text-xs uppercase tracking-wider ts-text-muted">Pending</div>
					<div class="mt-1 text-2xl font-bold ts-text-muted">
						{fmt(data.iconStats.pendingUrls)}
					</div>
					<div class="text-xs mt-1 ts-text-muted">
						awaiting fetch / retry
					</div>
				</div>
			</div>
		</section>
	{/if}

	<p class="text-xs mt-10 ts-text-muted">
		Counts reflect what our indexer has seen since CashTokens activation at block 792,772 (May
		2023). Metadata comes from the BCMR registry via Paytaca's public indexer, refreshed every 4
		hours.
	</p>
</main>
