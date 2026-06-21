<script lang="ts">
	import { stripEmoji, formatMarketCap } from '$lib/format';
	import { iconHrefFor } from '$lib/icons';
	import * as m from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';

	type VenueId = 'cauldron' | 'fex' | 'tapswap';

	let { data } = $props();

	const fmtUsd = (usd: number, present: boolean): string => {
		if (!present) return '—';
		if (usd <= 0) return '—';
		if (usd >= 1) return `$${usd.toFixed(2)}`;
		return `$${usd.toFixed(6)}`;
	};

	const fmtTvl = (usd: number): string =>
		usd > 0 ? formatMarketCap(usd.toString()) : '—';

	// Spread badge tier is now per-row: emerald above this row's specific
	// venue-pair fee, amber close, slate below. Different venue pairs yield
	// different fee floors (Tapswap-buy → Cauldron-sell is the cheapest at
	// 0.3%; Fex-buy → Tapswap-sell is the priciest at 3.6%).
	const spreadColor = (rawPct: number, fee: number): string => {
		if (rawPct >= fee + 1) return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300';
		if (rawPct >= fee) return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
		return 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-200';
	};

	const venueLabel: Record<VenueId, string> = {
		cauldron: 'Cauldron',
		fex: 'Fex',
		tapswap: 'Tapswap'
	};

	// Buy / sell deep-links per venue. Cauldron's swap UI accepts a
	// category suffix (verified). Fex.cash doesn't publish a category-
	// deep-link convention — drop users on the homepage. Tapswap's frontend
	// uses /trade/<category-hex>; verified against active listings on the
	// site.
	const venueURL = (venue: VenueId, id: string): string => {
		switch (venue) {
			case 'cauldron':
				return `https://app.cauldron.quest/swap/${id}`;
			case 'fex':
				return 'https://fex.cash/';
			case 'tapswap':
				return `https://tapswap.cash/trade/${id}`;
		}
	};
</script>

<svelte:head>
	<title>{m.arb_meta_title()}</title>
	<meta
		name="description"
		content={m.arb_meta_description()}
	/>
</svelte:head>

<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<div class="mb-8">
		<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent">
			{m.arb_h1()}
		</h1>
		<p class="mt-2 max-w-3xl ts-text-muted">
			{m.arb_intro()}
		</p>
	</div>

	<!--
		Headline meta strip. Three cells: ecosystem-wide pair count, what
		the page is filtered to, and a toggle to show all rows including
		sub-1% spreads.
	-->
	<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
		<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
			<div class="text-xs uppercase tracking-wider ts-text-muted">{m.arb_on_2_venues()}</div>
			<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{data.totalRows}</div>
			<div class="mt-1 text-xs ts-text-muted">Cauldron / Fex / Tapswap</div>
		</div>
		<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
			<div class="text-xs uppercase tracking-wider ts-text-muted">{m.arb_filter()}</div>
			<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">≥ {data.minSpreadPct}%</div>
			<div class="mt-1 text-xs ts-text-muted">{m.arb_matching({ count: data.rows.length })}</div>
		</div>
		<div class="p-4 rounded-xl border flex flex-col justify-between ts-border-subtle ts-surface-panel">
			<div class="text-xs uppercase tracking-wider ts-text-muted">{m.arb_view()}</div>
			<div class="mt-2 flex flex-wrap gap-2">
				<a
					href={localizeHref('/arbitrage')}
					class="px-3 py-1 rounded-lg text-xs font-medium {data.minSpreadPct === 1 && !data.showAll ? 'bg-violet-600 text-white' : 'bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700'} ts-text-strong"
				>
					{m.arb_default()}
				</a>
				<a
					href={localizeHref('/arbitrage?min=5')}
					class="px-3 py-1 rounded-lg text-xs font-medium {data.minSpreadPct === 5 ? 'bg-violet-600 text-white' : 'bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700'} ts-text-strong"
				>
					≥ 5%
				</a>
				<a
					href={localizeHref('/arbitrage?showAll=1')}
					class="px-3 py-1 rounded-lg text-xs font-medium {data.showAll ? 'bg-violet-600 text-white' : 'bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700'} ts-text-strong"
				>
					{m.arb_show_all()}
				</a>
			</div>
		</div>
	</div>

	{#if data.bchPriceUSD === 0}
		<div class="mb-6 p-4 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 text-sm text-amber-700 dark:text-amber-300">
			{m.arb_bch_unavailable()}
		</div>
	{/if}

	{#if data.rows.length === 0}
		<div class="p-8 rounded-xl border bg-slate-50 dark:bg-zinc-900/50 text-center ts-border-subtle">
			<p class="ts-text-muted">
				{m.arb_empty({ pct: data.minSpreadPct })}
			</p>
			<p class="text-sm mt-2 ts-text-faint">
				{m.arb_empty_2_before({ total: data.totalRows })}
				<a href={localizeHref('/arbitrage?showAll=1')} class="text-violet-600 hover:underline">{m.arb_show_all_view()}</a>
				{m.arb_empty_2_after()}
			</p>
		</div>
	{:else}
		<!-- Desktop table -->
		<div class="hidden md:block overflow-hidden rounded-xl border ts-border-subtle">
			<div class="grid grid-cols-[2.4fr_0.9fr_0.9fr_0.9fr_0.7fr_0.8fr_1.4fr] gap-2 px-4 py-3 bg-slate-50 dark:bg-zinc-900/50 border-b text-xs font-semibold uppercase tracking-wider items-center ts-text-muted ts-border-subtle">
				<div>{m.grid_col_token()}</div>
				<div class="text-right">Cauldron</div>
				<div class="text-right">Fex</div>
				<div class="text-right">Tapswap</div>
				<div class="text-right" title={m.arb_col_spread_title()}>{m.arb_col_spread()}</div>
				<div class="text-right" title={m.arb_col_net_title()}>{m.arb_col_net()}</div>
				<div class="text-right">{m.arb_col_action()}</div>
			</div>
			{#each data.rows as r (r.id)}
				<div class="grid grid-cols-[2.4fr_0.9fr_0.9fr_0.9fr_0.7fr_0.8fr_1.4fr] gap-2 px-4 py-3 border-b last:border-b-0 items-center hover:bg-slate-50/50 dark:hover:bg-zinc-900/30 transition-colors ts-border-subtle">
					<a href={localizeHref(`/token/${r.id}`)} data-sveltekit-preload-data="hover" class="flex items-center gap-3 min-w-0 no-underline group">
						<img src={iconHrefFor(r.icon, r.iconClearedHash)} alt="" class="w-8 h-8 rounded-full shrink-0 ts-surface-chip" loading="lazy" />
						<div class="min-w-0">
							<div class="font-semibold text-slate-900 dark:text-white truncate group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
								{stripEmoji(r.name) || '—'}
								{#if r.symbol}<span class="ml-2 text-xs text-slate-500 font-mono">{stripEmoji(r.symbol)}</span>{/if}
							</div>
							<div class="text-xs truncate ts-text-muted">
								{#if r.cauldronPresent}{m.arb_cauldron_tvl()} {fmtTvl(r.cauldronTvlUSD)}{/if}
								{#if r.cauldronPresent && r.fexPresent} · {/if}
								{#if r.fexPresent}{m.arb_fex_tvl()} {fmtTvl(r.fexTvlUSD)}{/if}
								{#if (r.cauldronPresent || r.fexPresent) && r.tapswapPresent} · {/if}
								{#if r.tapswapPresent}Tapswap {r.tapswapFtListingCount === 1 ? m.arb_listing_one({ count: r.tapswapFtListingCount }) : m.arb_listing_many({ count: r.tapswapFtListingCount })}{/if}
							</div>
						</div>
					</a>
					<div class="text-right font-mono text-sm {r.cheapestVenue === 'cauldron' ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : r.mostExpensiveVenue === 'cauldron' ? 'text-rose-700 dark:text-rose-400' : 'text-slate-700 dark:text-zinc-200'}">
						{fmtUsd(r.cauldronPriceUSD, r.cauldronPresent)}
					</div>
					<div class="text-right font-mono text-sm {r.cheapestVenue === 'fex' ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : r.mostExpensiveVenue === 'fex' ? 'text-rose-700 dark:text-rose-400' : 'text-slate-700 dark:text-zinc-200'}">
						{fmtUsd(r.fexPriceUSD, r.fexPresent)}
					</div>
					<div class="text-right font-mono text-sm {r.cheapestVenue === 'tapswap' ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : r.mostExpensiveVenue === 'tapswap' ? 'text-rose-700 dark:text-rose-400' : 'text-slate-700 dark:text-zinc-200'}">
						{fmtUsd(r.tapswapPriceUSD, r.tapswapPresent)}
					</div>
					<div class="text-right">
						<span
							class="px-2 py-0.5 rounded text-xs font-mono {spreadColor(r.rawSpreadPct, r.totalFeePct)}"
							aria-label={m.arb_spread_aria({ pct: r.rawSpreadPct.toFixed(2) })}
							title={m.arb_spread_title({ buy: venueLabel[r.cheapestVenue], sell: venueLabel[r.mostExpensiveVenue], fee: r.totalFeePct.toFixed(1) })}
						>
							{r.rawSpreadPct.toFixed(2)}%
						</span>
					</div>
					<div class="text-right font-mono text-xs {r.netSpreadPct > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-zinc-400'}">
						{r.netSpreadPct >= 0 ? '+' : ''}{r.netSpreadPct.toFixed(2)}%
					</div>
					<div class="flex flex-col gap-1 items-end text-xs">
						<a
							href={venueURL(r.cheapestVenue, r.id)}
							target="_blank"
							rel="noopener noreferrer"
							class="px-2 py-1 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors no-underline whitespace-nowrap"
							title={m.arb_buy_title()}
						>
							{m.arb_buy()} {venueLabel[r.cheapestVenue]} →
						</a>
						<a
							href={venueURL(r.mostExpensiveVenue, r.id)}
							target="_blank"
							rel="noopener noreferrer"
							class="px-2 py-1 rounded bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 hover:bg-rose-200 dark:hover:bg-rose-900/50 transition-colors no-underline whitespace-nowrap"
							title={m.arb_sell_title()}
						>
							{m.arb_sell()} {venueLabel[r.mostExpensiveVenue]} →
						</a>
					</div>
				</div>
			{/each}
		</div>

		<!-- Mobile: stacked cards. The desktop grid would crush at <md. -->
		<div class="md:hidden space-y-3">
			{#each data.rows as r (r.id)}
				<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
					<a href={`/token/${r.id}`} data-sveltekit-preload-data="hover" class="flex items-center gap-3 mb-3 no-underline">
						<img src={iconHrefFor(r.icon, r.iconClearedHash)} alt="" class="w-10 h-10 rounded-full ts-surface-chip" />
						<div class="min-w-0 flex-1">
							<div class="font-semibold text-slate-900 dark:text-white truncate">
								{stripEmoji(r.name) || '—'}
							</div>
							{#if r.symbol}<div class="text-xs text-slate-500 font-mono">{stripEmoji(r.symbol)}</div>{/if}
						</div>
						<span
							class="px-2 py-0.5 rounded text-xs font-mono {spreadColor(r.rawSpreadPct, r.totalFeePct)}"
							aria-label={m.arb_spread_aria({ pct: r.rawSpreadPct.toFixed(2) })}
						>
							{r.rawSpreadPct.toFixed(2)}%
						</span>
					</a>
					<div class="grid grid-cols-3 gap-2 mb-3 text-sm">
						<div class="p-2 rounded bg-slate-50 dark:bg-zinc-800/50 {r.cheapestVenue === 'cauldron' ? 'ring-1 ring-emerald-400 dark:ring-emerald-700' : r.mostExpensiveVenue === 'cauldron' ? 'ring-1 ring-rose-400 dark:ring-rose-700' : ''}">
							<div class="text-xs text-slate-500 mb-1">Cauldron</div>
							<div class="font-mono text-xs">{fmtUsd(r.cauldronPriceUSD, r.cauldronPresent)}</div>
						</div>
						<div class="p-2 rounded bg-slate-50 dark:bg-zinc-800/50 {r.cheapestVenue === 'fex' ? 'ring-1 ring-emerald-400 dark:ring-emerald-700' : r.mostExpensiveVenue === 'fex' ? 'ring-1 ring-rose-400 dark:ring-rose-700' : ''}">
							<div class="text-xs text-slate-500 mb-1">Fex</div>
							<div class="font-mono text-xs">{fmtUsd(r.fexPriceUSD, r.fexPresent)}</div>
						</div>
						<div class="p-2 rounded bg-slate-50 dark:bg-zinc-800/50 {r.cheapestVenue === 'tapswap' ? 'ring-1 ring-emerald-400 dark:ring-emerald-700' : r.mostExpensiveVenue === 'tapswap' ? 'ring-1 ring-rose-400 dark:ring-rose-700' : ''}">
							<div class="text-xs text-slate-500 mb-1">Tapswap</div>
							<div class="font-mono text-xs">{fmtUsd(r.tapswapPriceUSD, r.tapswapPresent)}</div>
						</div>
					</div>
					<div class="flex gap-2 text-xs">
						<a
							href={venueURL(r.cheapestVenue, r.id)}
							target="_blank"
							rel="noopener noreferrer"
							title={m.arb_buy_title()}
							class="flex-1 text-center px-3 py-2 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 no-underline"
						>
							{m.arb_buy()} {venueLabel[r.cheapestVenue]}
						</a>
						<a
							href={venueURL(r.mostExpensiveVenue, r.id)}
							target="_blank"
							rel="noopener noreferrer"
							title={m.arb_sell_title()}
							class="flex-1 text-center px-3 py-2 rounded bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 no-underline"
						>
							{m.arb_sell()} {venueLabel[r.mostExpensiveVenue]}
						</a>
					</div>
					<div class="mt-2 text-xs text-slate-500 text-center">
						{m.arb_net_after({ fee: r.totalFeePct.toFixed(1) })} <span class="font-mono {r.netSpreadPct > 0 ? 'text-emerald-600 dark:text-emerald-400' : ''}">{r.netSpreadPct >= 0 ? '+' : ''}{r.netSpreadPct.toFixed(2)}%</span>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<section class="mt-10 p-5 rounded-xl border bg-slate-50/50 dark:bg-zinc-900/30 ts-border-subtle">
		<h2 class="text-base font-semibold text-slate-900 dark:text-white mb-2">{m.ui_notes()}</h2>
		<ul class="text-sm space-y-1.5 list-disc list-inside ts-text-muted">
			<li>{@html m.arb_note1()}</li>
			<li>{@html m.arb_note2({ buyC: data.buyFeePct.cauldron, buyF: data.buyFeePct.fex, buyT: data.buyFeePct.tapswap, sellC: data.sellFeePct.cauldron, sellF: data.sellFeePct.fex, sellT: data.sellFeePct.tapswap })}</li>
			<li>{m.arb_note3()}</li>
			<li>{m.arb_note4()}</li>
			<li>{m.arb_note5()}</li>
		</ul>
	</section>
</main>
