<script lang="ts">
	import { getIPFSUrl, stripEmoji, formatMarketCap } from '$lib/format';

	let { data } = $props();

	const fmtUsd = (usd: number): string => {
		if (usd <= 0) return '—';
		if (usd >= 1) return `$${usd.toFixed(2)}`;
		return `$${usd.toFixed(6)}`;
	};

	const fmtTvl = (usd: number): string =>
		usd > 0 ? formatMarketCap(usd.toString()) : '—';

	// Spread badge color: emerald above the fee floor (profitable on
	// paper), amber close to the floor, slate below (informational only).
	const spreadColor = (rawPct: number, fee: number): string => {
		if (rawPct >= fee + 1) return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300';
		if (rawPct >= fee) return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
		return 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300';
	};

	// "Buy on X, sell on Y" copy. Cauldron uses category-suffixed swap
	// URLs (verified — same shape as the detail-page card uses). Fex's
	// frontend doesn't publish a category-deep-link convention as far as
	// I can find, so we send users to fex.cash's homepage and they can
	// paste the category there. TODO: when fex-cash/fex documents a
	// `/swap?...` or similar deep-link, switch to it here so the action
	// button lands directly on the right pool.
	const cauldronURL = (id: string) => `https://app.cauldron.quest/swap/${id}`;
	// Signature takes id for symmetry with cauldronURL; unused today
	// because there's no verified deep-link pattern. Drop the prefix
	// underscore + use it once Fex publishes a /swap?cat=... route.
	const fexURL = (_id: string) => `https://fex.cash/`;
</script>

<svelte:head>
	<title>Cross-venue arbitrage — Token Stork</title>
	<meta
		name="description"
		content="BCH CashTokens listed on multiple AMMs, ranked by price spread between Cauldron and Fex.cash. Informational only — slippage, mempool risk, and execution cost not modelled."
	/>
</svelte:head>

<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<div class="mb-8">
		<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent">
			Arbitrage
		</h1>
		<p class="text-slate-600 dark:text-slate-400 mt-2 max-w-3xl">
			Tokens listed on both Cauldron and Fex with a meaningful price gap. The "net" column
			already deducts the round-trip taker fee floor of {data.feeFloorPct}% (Cauldron 0.3% +
			Fex 0.6%). Slippage, transaction-mining cost, and the chance the gap closes before you
			act are NOT modelled — every number here is the upper bound on what's available in
			theory, not what you'll capture in practice.
		</p>
	</div>

	<!--
		Headline meta strip. Three cells: ecosystem-wide pair count, what
		the page is filtered to, and a toggle to show all rows including
		sub-1% spreads.
	-->
	<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
		<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">Tokens on both AMMs</div>
			<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{data.totalRows}</div>
			<div class="mt-1 text-xs text-slate-500 dark:text-slate-400">Cauldron ∩ Fex (only)</div>
		</div>
		<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">Filter</div>
			<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">≥ {data.minSpreadPct}%</div>
			<div class="mt-1 text-xs text-slate-500 dark:text-slate-400">{data.rows.length} matching</div>
		</div>
		<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between">
			<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">View</div>
			<div class="mt-2 flex flex-wrap gap-2">
				<a
					href="/arbitrage"
					class="px-3 py-1 rounded-lg text-xs font-medium {data.minSpreadPct === 1 && !data.showAll
						? 'bg-violet-600 text-white'
						: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}"
				>
					≥ 1% (default)
				</a>
				<a
					href="/arbitrage?min=5"
					class="px-3 py-1 rounded-lg text-xs font-medium {data.minSpreadPct === 5
						? 'bg-violet-600 text-white'
						: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}"
				>
					≥ 5%
				</a>
				<a
					href="/arbitrage?showAll=1"
					class="px-3 py-1 rounded-lg text-xs font-medium {data.showAll
						? 'bg-violet-600 text-white'
						: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}"
				>
					Show all
				</a>
			</div>
		</div>
	</div>

	{#if data.bchPriceUSD === 0}
		<div class="mb-6 p-4 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 text-sm text-amber-700 dark:text-amber-300">
			BCH price feed is unavailable, so USD columns show — for now. Spread % is independent of
			the BCH price and is still accurate; refresh the page in a moment.
		</div>
	{/if}

	{#if data.rows.length === 0}
		<div class="p-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-center">
			<p class="text-slate-600 dark:text-slate-400">
				No tokens currently meet the {data.minSpreadPct}% spread filter.
			</p>
			<p class="text-sm text-slate-500 dark:text-slate-500 mt-2">
				{data.totalRows} tokens are on both AMMs. Try the
				<a href="/arbitrage?showAll=1" class="text-violet-600 hover:underline">show-all view</a>
				to inspect them.
			</p>
		</div>
	{:else}
		<!-- Desktop table -->
		<div class="hidden md:block overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
			<div class="grid grid-cols-[3fr_1fr_1fr_0.8fr_0.9fr_1.4fr] gap-2 px-4 py-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider items-center">
				<div>Token</div>
				<div class="text-right">Cauldron</div>
				<div class="text-right">Fex</div>
				<div class="text-right" title="Absolute price gap, ignoring fees and slippage">Spread</div>
				<div class="text-right" title="Spread minus the {data.feeFloorPct}% round-trip taker fee floor">Net</div>
				<div class="text-right">Action</div>
			</div>
			{#each data.rows as r (r.id)}
				{@const cauldronCheaper = r.cheaperVenue === 'cauldron'}
				<div class="grid grid-cols-[3fr_1fr_1fr_0.8fr_0.9fr_1.4fr] gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800 last:border-b-0 items-center hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition-colors">
					<a href={`/token/${r.id}`} class="flex items-center gap-3 min-w-0 no-underline group">
						{#if r.icon}
							<img src={getIPFSUrl(r.icon)} alt="" class="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 shrink-0" loading="lazy" />
						{:else}
							<div class="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 shrink-0" aria-hidden="true"></div>
						{/if}
						<div class="min-w-0">
							<div class="font-semibold text-slate-900 dark:text-white truncate group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
								{stripEmoji(r.name) || '—'}
								{#if r.symbol}<span class="ml-2 text-xs text-slate-500 font-mono">{stripEmoji(r.symbol)}</span>{/if}
							</div>
							<div class="text-xs text-slate-500 dark:text-slate-400">
								Cauldron TVL {fmtTvl(r.cauldronTvlUSD)} · Fex TVL {fmtTvl(r.fexTvlUSD)}
							</div>
						</div>
					</a>
					<div class="text-right font-mono text-sm {cauldronCheaper ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-slate-700 dark:text-slate-300'}">
						{fmtUsd(r.cauldronPriceUSD)}
					</div>
					<div class="text-right font-mono text-sm {!cauldronCheaper ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-slate-700 dark:text-slate-300'}">
						{fmtUsd(r.fexPriceUSD)}
					</div>
					<div class="text-right">
						<span
							class="px-2 py-0.5 rounded text-xs font-mono {spreadColor(r.rawSpreadPct, data.feeFloorPct)}"
							aria-label="Spread {r.rawSpreadPct.toFixed(2)} percent"
						>
							{r.rawSpreadPct.toFixed(2)}%
						</span>
					</div>
					<div class="text-right font-mono text-xs {r.netSpreadPct > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-500'}">
						{r.netSpreadPct >= 0 ? '+' : ''}{r.netSpreadPct.toFixed(2)}%
					</div>
					<div class="flex flex-col gap-1 items-end text-xs">
						<a
							href={cauldronCheaper ? cauldronURL(r.id) : fexURL(r.id)}
							target="_blank"
							rel="noopener noreferrer"
							class="px-2 py-1 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors no-underline whitespace-nowrap"
							title="Buy on the cheaper venue"
						>
							Buy {cauldronCheaper ? 'Cauldron' : 'Fex'} →
						</a>
						<a
							href={cauldronCheaper ? fexURL(r.id) : cauldronURL(r.id)}
							target="_blank"
							rel="noopener noreferrer"
							class="px-2 py-1 rounded bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 hover:bg-rose-200 dark:hover:bg-rose-900/50 transition-colors no-underline whitespace-nowrap"
							title="Sell on the more-expensive venue"
						>
							Sell {cauldronCheaper ? 'Fex' : 'Cauldron'} →
						</a>
					</div>
				</div>
			{/each}
		</div>

		<!-- Mobile: stacked cards. The desktop grid would crush at <md. -->
		<div class="md:hidden space-y-3">
			{#each data.rows as r (r.id)}
				{@const cauldronCheaper = r.cheaperVenue === 'cauldron'}
				<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
					<a href={`/token/${r.id}`} class="flex items-center gap-3 mb-3 no-underline">
						{#if r.icon}
							<img src={getIPFSUrl(r.icon)} alt="" class="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800" />
						{:else}
							<div class="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden="true"></div>
						{/if}
						<div class="min-w-0 flex-1">
							<div class="font-semibold text-slate-900 dark:text-white truncate">
								{stripEmoji(r.name) || '—'}
							</div>
							{#if r.symbol}<div class="text-xs text-slate-500 font-mono">{stripEmoji(r.symbol)}</div>{/if}
						</div>
						<span
							class="px-2 py-0.5 rounded text-xs font-mono {spreadColor(r.rawSpreadPct, data.feeFloorPct)}"
							aria-label="Spread {r.rawSpreadPct.toFixed(2)} percent"
						>
							{r.rawSpreadPct.toFixed(2)}%
						</span>
					</a>
					<div class="grid grid-cols-2 gap-2 mb-3 text-sm">
						<div class="p-2 rounded bg-slate-50 dark:bg-slate-800/50 {cauldronCheaper ? 'ring-1 ring-emerald-400 dark:ring-emerald-700' : ''}">
							<div class="text-xs text-slate-500 mb-1">Cauldron</div>
							<div class="font-mono">{fmtUsd(r.cauldronPriceUSD)}</div>
						</div>
						<div class="p-2 rounded bg-slate-50 dark:bg-slate-800/50 {!cauldronCheaper ? 'ring-1 ring-emerald-400 dark:ring-emerald-700' : ''}">
							<div class="text-xs text-slate-500 mb-1">Fex</div>
							<div class="font-mono">{fmtUsd(r.fexPriceUSD)}</div>
						</div>
					</div>
					<div class="flex gap-2 text-xs">
						<a
							href={cauldronCheaper ? cauldronURL(r.id) : fexURL(r.id)}
							target="_blank"
							rel="noopener noreferrer"
							title="Buy on the cheaper venue"
							class="flex-1 text-center px-3 py-2 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 no-underline"
						>
							Buy {cauldronCheaper ? 'Cauldron' : 'Fex'}
						</a>
						<a
							href={cauldronCheaper ? fexURL(r.id) : cauldronURL(r.id)}
							target="_blank"
							rel="noopener noreferrer"
							title="Sell on the more-expensive venue"
							class="flex-1 text-center px-3 py-2 rounded bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 no-underline"
						>
							Sell {cauldronCheaper ? 'Fex' : 'Cauldron'}
						</a>
					</div>
					<div class="mt-2 text-xs text-slate-500 text-center">
						Net after fees: <span class="font-mono {r.netSpreadPct > 0 ? 'text-emerald-600 dark:text-emerald-400' : ''}">{r.netSpreadPct >= 0 ? '+' : ''}{r.netSpreadPct.toFixed(2)}%</span>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<section class="mt-10 p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30">
		<h2 class="text-base font-semibold text-slate-900 dark:text-white mb-2">Notes</h2>
		<ul class="text-sm text-slate-600 dark:text-slate-400 space-y-1.5 list-disc list-inside">
			<li>Prices are pulled from <code class="text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono">token_venue_listings</code> and refresh every 4 h (full discovery) + every 10 min (Cauldron fast-pass) + every 4 h (Fex). The numbers above can be up to 4 h stale even when the spread is real.</li>
			<li>The <strong>Net</strong> column subtracts a flat 0.9% round-trip taker fee. Real fees vary by trade size and venue surge pricing — assume the figure is optimistic.</li>
			<li>Slippage on thin pools eats the spread before you do. Always sanity-check against the live AMM UI before committing funds.</li>
			<li>Tapswap (P2P) is not in v1 — its per-unit ask is derived (<code class="text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono">want_sats / has_amount</code>) and FT-vs-NFT pricing has different semantics. Adding it as a third venue column is a tracked follow-up.</li>
			<li>tokenstork.com displays public market data; nothing here is investment advice or an offer.</li>
		</ul>
	</section>
</main>
