<script lang="ts">
	import Movers24h from '$lib/components/Movers24h.svelte';
	import { Tooltip, TooltipTrigger, TooltipContent } from '$lib/components/ui/tooltip';
	import { iconHrefFor } from '$lib/icons';
	import { stripEmoji } from '$lib/format';
	import * as m from '$lib/paraglide/messages';
	import { getLocale, localizeHref } from '$lib/paraglide/runtime';

	let { data } = $props();

	const fmt = (n: number) => n.toLocaleString(getLocale());
	const fmtBch = (sats: number) =>
		sats > 0 ? (sats / 1e8).toLocaleString(getLocale(), { maximumFractionDigits: 2 }) : '0';
	const fmtUsd = (usd: number) =>
		usd >= 1_000_000
			? `$${(usd / 1_000_000).toLocaleString(getLocale(), { maximumFractionDigits: 2 })}M`
			: usd >= 1_000
				? `$${(usd / 1_000).toLocaleString(getLocale(), { maximumFractionDigits: 1 })}k`
				: `$${usd.toLocaleString(getLocale(), { maximumFractionDigits: 2 })}`;

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
	<title>{m.st_meta_title()}</title>
	<meta name="description" content={m.st_meta_description()} />
</svelte:head>

<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<div class="mb-8">
		<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent">
			{m.st_h1()}
		</h1>
		<p class="mt-2 ts-text-muted">
			{m.st_intro()}
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
			{ label: m.st_new_24h(), count: data.newIn24h, href: '/?new24h=1&sort=recent' },
			{ label: m.st_new_7d(),  count: data.newIn7d,  href: '/?new7d=1&sort=recent'  },
			{ label: m.st_new_30d(), count: data.newIn30d, href: '/?new30d=1&sort=recent' }
		] as card (card.label)}
			<a
				href={localizeHref(card.href)}
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

	<!--
		24h gainers / losers / TVL movers. Same component used on the
		homepage so the two surfaces stay in lockstep — gainer leaderboard
		on /stats and on / cannot disagree. Pre-loaded once via
		`getMovers24h()` in the page-load Promise.all.
	-->
	<section class="mb-8">
		<Movers24h movers={data.movers} />
	</section>

	<section class="mb-8">
		<div class="flex items-baseline justify-between mb-3">
			<h2 class="text-xl font-semibold text-slate-900 dark:text-white">{m.st_by_type()}</h2>
			<a href={localizeHref('/faq#faq-ft-nft')} class="text-xs text-violet-600 dark:text-violet-400 hover:underline">{m.st_whats_ft_nft()}</a>
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
				href={localizeHref('/?type=FT&sort=tvl')}
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
				<div class="mt-1 text-xs ts-text-muted">{m.st_ft_subtitle()}</div>
			</a>

			<a
				href={localizeHref('/?type=NFT&sort=tvl')}
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
				<div class="mt-1 text-xs ts-text-muted">{m.st_nft_subtitle()}</div>
			</a>

			<a
				href={localizeHref('/?type=FT%2BNFT&sort=tvl')}
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
				<div class="mt-1 text-xs ts-text-muted">{m.st_ftnft_subtitle()}</div>
			</a>
		</div>
	</section>

	<section class="mb-8">
		<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">{m.st_tradeable()}</h2>
		<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
			<a
				href={localizeHref('/?cauldron=1&sort=tvl')}
				class="group p-5 rounded-xl border hover:border-violet-400 dark:hover:border-violet-600 transition-colors no-underline ts-border-subtle ts-surface-panel"
			>
				<div class="flex items-center gap-3">
					<img src="/cauldron-logo.png" alt="" class="w-7 h-7 rounded-full bg-white p-0.5" aria-hidden="true" />
					<span class="font-semibold text-slate-900 dark:text-white">Cauldron <span class="text-xs font-normal ts-text-muted">(AMM)</span></span>
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">{fmt(data.cauldronListedCategories)}</div>
				<div class="mt-1 text-xs ts-text-muted">
					{m.st_pool_price_sub()}
				</div>
			</a>
			<a
				href={localizeHref('/?tapswap=1&sort=recent')}
				class="group p-5 rounded-xl border hover:border-emerald-400 dark:hover:border-emerald-600 transition-colors no-underline ts-border-subtle ts-surface-panel"
			>
				<div class="flex items-center gap-3">
					<img src="/tapswap-logo.png" alt="" class="w-7 h-7 rounded" aria-hidden="true" />
					<span class="font-semibold text-slate-900 dark:text-white">Tapswap <span class="text-xs font-normal ts-text-muted">(P2P)</span></span>
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">{fmt(data.tapswapListedCategories)}</div>
				<div class="mt-1 text-xs ts-text-muted">
					{m.st_tapswap_sub()}
				</div>
			</a>
			<a
				href={localizeHref('/?fex=1&sort=tvl')}
				class="group p-5 rounded-xl border hover:border-sky-400 dark:hover:border-sky-600 transition-colors no-underline ts-border-subtle ts-surface-panel"
			>
				<div class="flex items-center gap-3">
					<img src="/fex-logo.png" alt="" class="w-7 h-7 rounded-full" aria-hidden="true" />
					<span class="font-semibold text-slate-900 dark:text-white">Fex <span class="text-xs font-normal ts-text-muted">(AMM)</span></span>
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">{fmt(data.fexListedCategories)}</div>
				<div class="mt-1 text-xs ts-text-muted">
					{m.st_pool_price_sub()}
				</div>
			</a>
		</div>
	</section>

	{#if data.topHoldersByCount.length > 0}
		<section class="mb-8">
			<div class="flex items-baseline justify-between mb-3">
				<h2 class="text-xl font-semibold text-slate-900 dark:text-white">{m.st_top_holders_h2()}</h2>
				<a href={localizeHref('/?sort=holders')} class="text-xs text-violet-600 dark:text-violet-400 hover:underline">{m.st_all_by_holders()}</a>
			</div>
			<p class="text-sm ts-text-muted mb-3">
				{m.st_top_holders_desc()}
			</p>
			<div class="rounded-xl border ts-border-subtle ts-surface-panel overflow-hidden">
				<ol class="divide-y ts-border-subtle">
					{#each data.topHoldersByCount as t, i (t.id)}
						<li>
							<a href={localizeHref(`/token/${t.id}`)} data-sveltekit-preload-data="hover" class="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition-colors no-underline">
								<span class="w-5 text-xs font-mono text-slate-400 tabular-nums">{i + 1}</span>
								<img src={iconHrefFor(t.icon, t.iconClearedHash)} alt="" class="w-7 h-7 rounded-full bg-slate-100 dark:bg-zinc-800" loading="lazy" />
								<span class="flex-1 min-w-0 truncate text-sm text-slate-900 dark:text-white">
									{stripEmoji(t.name) || t.id.slice(0, 10) + '…'}
									{#if t.symbol}<span class="ml-1 text-xs text-slate-500 font-mono">{stripEmoji(t.symbol)}</span>{/if}
								</span>
								<span class="text-xs font-mono tabular-nums shrink-0 text-teal-700 dark:text-teal-400">
									{fmt(t.holderCount)} {m.st_holders_label()}
								</span>
							</a>
						</li>
					{/each}
				</ol>
			</div>
		</section>
	{/if}

	{#if data.tapswapTop.length > 0}
		<section class="mb-8">
			<div class="flex items-baseline justify-between mb-3">
				<h2 class="text-xl font-semibold text-slate-900 dark:text-white">{m.st_tapswap_top_h2()}</h2>
				<a href={localizeHref('/?tapswap=1&sort=recent')} class="text-xs text-violet-600 dark:text-violet-400 hover:underline">{m.st_all_tapswap()}</a>
			</div>
			<p class="text-sm ts-text-muted mb-3">
				{m.st_tapswap_top_desc()}
			</p>
			<div class="rounded-xl border ts-border-subtle ts-surface-panel overflow-hidden">
				<ol class="divide-y ts-border-subtle">
					{#each data.tapswapTop as t, i (t.id)}
						<li>
							<a href={localizeHref(`/token/${t.id}`)} data-sveltekit-preload-data="hover" class="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition-colors no-underline">
								<span class="w-5 text-xs font-mono text-slate-400 tabular-nums">{i + 1}</span>
								<img src={iconHrefFor(t.icon, t.iconClearedHash)} alt="" class="w-7 h-7 rounded-full bg-slate-100 dark:bg-zinc-800" loading="lazy" />
								<span class="flex-1 min-w-0 truncate text-sm text-slate-900 dark:text-white">
									{stripEmoji(t.name) || t.id.slice(0, 10) + '…'}
									{#if t.symbol}<span class="ml-1 text-xs text-slate-500 font-mono">{stripEmoji(t.symbol)}</span>{/if}
								</span>
								<span class="text-xs font-mono tabular-nums shrink-0 text-emerald-700 dark:text-emerald-400">
									{fmt(t.offerCount)} {m.st_open_label()}
								</span>
							</a>
						</li>
					{/each}
				</ol>
			</div>
		</section>
	{/if}

	<section class="mb-8">
		<div class="flex items-baseline justify-between mb-3">
			<h2 class="text-xl font-semibold text-slate-900 dark:text-white">{m.st_cauldron_amm_h2()}</h2>
			<a
				href="https://app.cauldron.quest/stats"
				target="_blank"
				rel="noopener noreferrer"
				class="text-xs text-violet-600 dark:text-violet-400 hover:underline"
			>
				{m.st_view_on_cauldron()}
			</a>
		</div>
		<p class="text-sm mb-3 ts-text-muted">
			{@html m.st_cauldron_amm_desc()}
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
					{m.st_volume_24h()}
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
					{m.st_volume_7d()}
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
					{m.st_volume_30d()}
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
					{m.st_active_pools()}
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">
					{fmt(data.cauldronStats.pools.active)}
				</div>
			</div>
			<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
				<div class="text-xs uppercase tracking-wider ts-text-muted">
					{m.st_ended_pools()}
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">
					{fmt(data.cauldronStats.pools.ended)}
				</div>
				<div class="mt-1 text-xs ts-text-muted">{m.st_ended_pools_sub()}</div>
			</div>
			<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
				<div class="text-xs uppercase tracking-wider ts-text-muted">
					{m.st_lifetime_swaps()}
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
						{m.st_cumulative_unique_h3()}
					</h3>
					<span class="text-xs font-mono ts-text-muted">
						{fmt(data.cauldronStats.uniqueAddressesByMonth[data.cauldronStats.uniqueAddressesByMonth.length - 1].count)}
						{m.st_total_suffix()}
					</span>
				</div>
				<svg
					viewBox={`0 0 ${chartW} ${chartH}`}
					class="w-full h-auto"
					role="img"
					aria-label={m.st_cauldron_chart_aria()}
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
							<title>{m.st_cumulative_addr_title({ label: bar.label, count: fmt(bar.count) })}</title>
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
		<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">{m.st_growth_h2()}</h2>
		<p class="text-sm mb-3 ts-text-muted">
			{m.st_growth_desc({ count: fmt(growthTotal) })}
		</p>
		<div class="p-5 rounded-xl border overflow-x-auto ts-border-subtle ts-surface-panel">
			{#if growthBars.length === 0}
				<p class="text-sm ts-text-muted">{m.st_no_data()}</p>
			{:else}
				<svg viewBox={`0 0 ${chartW} ${chartH}`} class="w-full h-auto" role="img" aria-label={m.st_growth_chart_aria()}>
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
							<title>{m.st_new_tokens_title({ label: bar.label, count: fmt(bar.count) })}</title>
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
		<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">{m.st_venue_overlap_h2()}</h2>
		<p class="text-sm mb-3 ts-text-muted">
			{m.st_venue_overlap_desc()}
		</p>
		<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
			<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
				<span class="px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-sm font-medium">
					{m.st_cauldron_only()}
				</span>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(data.venueOverlap.cauldronOnly)}</div>
			</div>
			<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
				<span class="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-sm font-medium">
					{m.st_tapswap_only()}
				</span>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(data.venueOverlap.tapswapOnly)}</div>
			</div>
			<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
				<span class="px-2 py-0.5 rounded bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 text-sm font-medium">
					{m.st_fex_only()}
				</span>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(data.venueOverlap.fexOnly)}</div>
			</div>
			<div class="p-5 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20">
				<span class="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-sm font-medium">
					{m.st_cauldron_fex()}
				</span>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white" title={m.st_cauldron_fex_title()}>{fmt(data.venueOverlap.cauldronAndFex)}</div>
			</div>
			<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
				<span class="px-2 py-0.5 rounded text-sm font-medium ts-text-body ts-surface-chip">
					{m.st_cauldron_tapswap()}
				</span>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(data.venueOverlap.cauldronAndTapswap)}</div>
			</div>
			<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
				<span class="px-2 py-0.5 rounded text-sm font-medium ts-text-body ts-surface-chip">
					{m.st_tapswap_fex()}
				</span>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(data.venueOverlap.tapswapAndFex)}</div>
			</div>
			<div class="p-5 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20 col-span-2 md:col-span-1">
				<span class="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-sm font-medium">
					{m.st_all_three()}
				</span>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white" title={m.st_all_three_title()}>{fmt(data.venueOverlap.allThree)}</div>
			</div>
		</div>
	</section>

	<section class="mb-8">
		<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">{m.st_metadata_h2()}</h2>
		<p class="text-sm mb-3 ts-text-muted">
			{m.st_metadata_desc({ count: fmt(data.metadata.total) })}
		</p>
		{#if data.metadata.total === 0}
			<div class="p-5 rounded-xl border bg-slate-50 dark:bg-zinc-900/50 text-sm ts-text-muted ts-border-subtle">
				{m.st_no_tokens_indexed()}
			</div>
		{:else}
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				{#each [[m.st_field_name(), data.metadata.hasName], [m.st_field_symbol(), data.metadata.hasSymbol], [m.st_field_icon(), data.metadata.hasIcon], [m.st_field_description(), data.metadata.hasDescription]] as [label, count] (label)}
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
		<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">{m.st_ecosystem_tvl_h2()}</h2>
		<p class="text-sm mb-3 ts-text-muted">
			{m.st_ecosystem_tvl_desc()}
		</p>
		<div class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
			{#if data.ecosystemTvl30d.length === 0}
				<p class="text-sm ts-text-muted">
					{m.st_no_history_price()}
				</p>
			{:else}
				{@const tvls = data.ecosystemTvl30d.map((p) => p.tvlSats)}
				{@const minTvl = Math.min(...tvls)}
				{@const maxTvl = Math.max(...tvls)}
				{@const range = maxTvl - minTvl || 1}
				<svg viewBox="0 0 600 120" class="w-full h-32" role="img" aria-label={m.st_ecosystem_tvl_aria()}>
					<title>{m.st_ecosystem_tvl_title()}</title>
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
					<span>{m.st_bch_max({ n: (maxTvl / 1e8).toFixed(2) })}</span>
					<span>{data.ecosystemTvl30d[data.ecosystemTvl30d.length - 1]?.day}</span>
				</div>
			{/if}
		</div>
	</section>

	<section class="mb-8">
		<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">{m.st_supply_h2()}</h2>
		<p class="text-sm mb-3 ts-text-muted">
			{m.st_supply_desc()}
		</p>
		{#if data.supplyBuckets.length === 0}
			<div class="p-5 rounded-xl border text-sm ts-text-muted ts-border-subtle ts-surface-panel">
				{m.st_no_data()}
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
							<svg viewBox="0 0 10 100" preserveAspectRatio="none" class="h-20 w-full block" role="img" aria-label={m.st_bucket_tokens_aria({ label: bucket.label, count: fmt(bucket.count) })}>
								<title>{m.st_tokens_count_title({ count: fmt(bucket.count) })}</title>
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
		<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">{m.st_decimals_h2()}</h2>
		<p class="text-sm mb-3 ts-text-muted">
			{m.st_decimals_desc()}
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
						<svg viewBox="0 0 10 100" preserveAspectRatio="none" class="h-24 w-full block" role="img" aria-label={m.st_decimals_bucket_aria({ label: bucket.label, count: fmt(bucket.count) })}>
							<title>{m.st_tokens_count_title({ count: fmt(bucket.count) })}</title>
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
			<h2 class="text-xl font-semibold text-slate-900 dark:text-white">{m.st_gini_h2()}</h2>
			{#if data.giniMedian != null}
				<Tooltip>
					<TooltipTrigger class="text-sm cursor-help ts-text-muted">
						{m.st_gini_median({ n: data.giniMedian.toFixed(2) })}
					</TooltipTrigger>
					<TooltipContent>
						{m.st_gini_median_tooltip()}
					</TooltipContent>
				</Tooltip>
			{/if}
		</div>
		<p class="text-sm mb-3 ts-text-muted">
			{m.st_gini_desc()}
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
						href={localizeHref(`/?gini_tier=${slug}`)}
						class="group flex flex-col items-center no-underline rounded-md p-1 -m-1 hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition-colors"
						title={m.st_gini_tier_title({ count: fmt(bucket.count), label: bucket.label })}
					>
						<svg viewBox="0 0 10 100" preserveAspectRatio="none" class="h-24 w-full block" role="img" aria-label={m.st_bucket_tokens_aria({ label: bucket.label, count: fmt(bucket.count) })}>
							<title>{m.st_bucket_tokens_aria({ label: bucket.label, count: fmt(bucket.count) })}</title>
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

	{#if data.uniqueHolders != null || data.topCollectors.length > 0}
		<section class="mb-8">
			<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">{m.st_eco_holders_h2()}</h2>
			<p class="text-sm mb-3 ts-text-muted">
				{m.st_eco_holders_desc()}
			</p>

			{#if data.uniqueHolders != null}
				<div class="mb-4 p-5 rounded-xl border ts-border-subtle ts-surface-panel">
					<div class="text-xs uppercase tracking-wider ts-text-muted">
						{m.st_distinct_addresses()}
					</div>
					<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(data.uniqueHolders)}</div>
				</div>
			{/if}

			{#if data.topCollectors.length > 0}
				<div class="rounded-xl border ts-border-subtle ts-surface-panel overflow-hidden">
					<div class="px-5 py-3 border-b ts-border-subtle">
						<div class="text-xs uppercase tracking-wider ts-text-muted">{m.st_top_collectors()}</div>
					</div>
					<table class="w-full text-sm">
						<thead class="bg-slate-50 dark:bg-zinc-900/50 border-b text-xs font-semibold uppercase tracking-wider ts-text-muted ts-border-subtle">
							<tr>
								<th class="text-left px-4 py-2 w-10">#</th>
								<th class="text-left px-4 py-2">{m.st_th_address()}</th>
								<th class="text-right px-4 py-2">{m.st_th_categories_held()}</th>
							</tr>
						</thead>
						<tbody>
							{#each data.topCollectors as c, i (c.address)}
								<tr class="border-b border-slate-100 dark:border-zinc-800/50 last:border-0">
									<td class="px-4 py-2 ts-text-muted font-mono">{i + 1}</td>
									<td class="px-4 py-2 font-mono text-xs truncate max-w-md">{c.address}</td>
									<td class="px-4 py-2 text-right font-mono">{fmt(c.categoriesHeld)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	{/if}

	<section class="mb-8">
		<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">{m.st_supply_dyn_h2()}</h2>
		<p class="text-sm mb-3 ts-text-muted">
			{m.st_supply_dyn_desc()}
		</p>
		<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
			{#if data.burned === null}
				<div class="p-5 rounded-xl border bg-slate-50 dark:bg-zinc-900/50 text-sm ts-text-muted ts-border-subtle md:col-span-2">
					{m.st_supply_dyn_pending()}
				</div>
			{:else}
				<div class="block p-5 rounded-xl border ts-border-subtle ts-surface-panel">
					<div class="text-xs uppercase tracking-wider ts-text-muted">{m.st_fully_burned()}</div>
					<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(data.burned)}</div>
					<div class="mt-1 text-xs ts-text-muted">{m.st_fully_burned_sub()}</div>
				</div>
				<div
					class="block p-5 rounded-xl border ts-border-subtle ts-surface-panel"
					title={m.st_active_minting_title()}
				>
					<div class="text-xs uppercase tracking-wider ts-text-muted">{m.st_active_minting()}</div>
					<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(data.activeMinting)}</div>
					<div class="mt-1 text-xs ts-text-muted">{m.st_active_minting_sub()}</div>
				</div>
			{/if}
		</div>
	</section>

	<section class="mb-8">
		<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">{m.st_activity_h2()}</h2>
		<p class="text-sm mb-3 ts-text-muted">
			{@html m.st_activity_desc({ count: fmt(data.activity24h.blocksCount) })}
		</p>
		{#if data.activity24h.blocksCount < 144}
			<p class="mb-3 text-xs ts-text-muted">
				{@html m.st_activity_note({ count: fmt(data.activity24h.blocksCount) })}
			</p>
		{/if}
		<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
			<div
				class="block p-5 rounded-xl border ts-border-subtle ts-surface-panel"
				title={m.st_token_bearing_title()}
			>
				<div class="text-xs uppercase tracking-wider ts-text-muted">{m.st_token_bearing_txs()}</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(data.activity24h.tokenTxs)}</div>
				<div class="mt-1 text-xs ts-text-muted">{m.st_mints_transfers_sub()}</div>
			</div>
			<div
				class="block p-5 rounded-xl border ts-border-subtle ts-surface-panel"
				title={m.st_new_categories_title()}
			>
				<div class="text-xs uppercase tracking-wider ts-text-muted">{m.st_new_categories()}</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{fmt(data.activity24h.mints)}</div>
				<div class="mt-1 text-xs ts-text-muted">{m.st_genesis_only_sub()}</div>
			</div>
		</div>
	</section>

	{#if data.firstCreated.length > 0}
		<section class="mb-8">
			<div class="flex items-baseline justify-between mb-3">
				<h2 class="text-xl font-semibold text-slate-900 dark:text-white">{m.st_first_created_h2()}</h2>
				<a href={localizeHref('/?sort=oldest')} class="text-xs text-violet-600 dark:text-violet-400 hover:underline">{m.st_all_by_oldest()}</a>
			</div>
			<p class="text-sm ts-text-muted mb-3">
				{m.st_first_created_desc()}
			</p>
			<div class="rounded-xl border ts-border-subtle ts-surface-panel overflow-hidden">
				<ol class="divide-y ts-border-subtle">
					{#each data.firstCreated as t, i (t.id)}
						<li>
							<a href={localizeHref(`/token/${t.id}`)} data-sveltekit-preload-data="hover" class="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition-colors no-underline">
								<span class="w-5 text-xs font-mono text-slate-400 tabular-nums">{i + 1}</span>
								<img src={iconHrefFor(t.icon, t.iconClearedHash)} alt="" class="w-7 h-7 rounded-full bg-slate-100 dark:bg-zinc-800" loading="lazy" />
								<span class="flex-1 min-w-0 truncate text-sm text-slate-900 dark:text-white">
									{stripEmoji(t.name) || t.id.slice(0, 10) + '…'}
									{#if t.symbol}<span class="ml-1 text-xs text-slate-500 font-mono">{stripEmoji(t.symbol)}</span>{/if}
								</span>
								<span class="text-xs font-mono tabular-nums shrink-0 ts-text-muted">
									{t.genesisTime.slice(0, 10)}
								</span>
							</a>
						</li>
					{/each}
				</ol>
			</div>
		</section>
	{/if}

	<section class="mb-8">
		<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">{m.st_moderation_h2()}</h2>
		<p class="text-sm mb-3 ts-text-muted">
			{m.st_moderation_desc()}
		</p>
		<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
			<a
				href={localizeHref('/moderated')}
				class="group p-5 rounded-xl border hover:border-rose-400 dark:hover:border-rose-600 transition-colors no-underline ts-border-subtle ts-surface-panel"
			>
				<div class="flex items-center justify-between">
					<div class="text-xs uppercase tracking-wider ts-text-muted">
						{m.st_moderated_tokens()}
					</div>
					<span class="text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity text-sm" aria-hidden="true">→</span>
				</div>
				<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">{fmt(data.moderated)}</div>
				<div class="mt-1 text-xs ts-text-muted">
					{m.st_moderated_sub()}
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
			<h2 class="text-xl font-semibold mb-3 text-slate-900 dark:text-white">{m.st_icon_safety_h2()}</h2>
			<p class="text-sm mb-3 ts-text-muted">
				{m.st_icon_safety_desc()}
				<a href={localizeHref('/moderated#image-safety')} class="text-violet-600 dark:text-violet-400 hover:underline">
					{m.st_icon_safety_link()}
				</a>.
			</p>
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
				<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
					<div class="text-xs uppercase tracking-wider ts-text-muted">{m.st_cleared()}</div>
					<div class="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
						{fmt(data.iconStats.cleared)}
					</div>
					<div class="text-xs mt-1 ts-text-muted">
						{m.st_tokens_use_these({ n: fmt(data.iconStats.tokensWithClearedIcon) })}
					</div>
				</div>
				<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
					<div class="text-xs uppercase tracking-wider ts-text-muted">{m.st_blocked()}</div>
					<div class="mt-1 text-2xl font-bold text-rose-600 dark:text-rose-400">
						{fmt(
							data.iconStats.blockedAdult +
								data.iconStats.blockedOversize +
								data.iconStats.blockedUnsupported +
								data.iconStats.blockedCsam
						)}
					</div>
					<div class="text-xs mt-1 ts-text-muted">
						{m.st_blocked_sub()}
					</div>
				</div>
				<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
					<div class="text-xs uppercase tracking-wider ts-text-muted">{m.st_in_review()}</div>
					<div class="mt-1 text-2xl font-bold text-violet-600 dark:text-violet-400">
						{fmt(data.iconStats.review)}
					</div>
					<div class="text-xs mt-1 ts-text-muted">{m.st_in_review_sub()}</div>
				</div>
				<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
					<div class="text-xs uppercase tracking-wider ts-text-muted">{m.st_pending()}</div>
					<div class="mt-1 text-2xl font-bold ts-text-muted">
						{fmt(data.iconStats.pendingUrls)}
					</div>
					<div class="text-xs mt-1 ts-text-muted">
						{m.st_pending_sub()}
					</div>
				</div>
			</div>
		</section>
	{/if}

	<p class="text-xs mt-10 ts-text-muted">
		{@html m.st_footer_note()}
	</p>
</main>
