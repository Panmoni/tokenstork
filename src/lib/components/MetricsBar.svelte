<script lang="ts">
	import { bchPrice } from '$lib/stores/bchPrice';
	import { Tooltip, TooltipTrigger, TooltipContent } from '$lib/components/ui/tooltip';
	import * as m from '$lib/paraglide/messages';
	import { getLocale, localizeHref } from '$lib/paraglide/runtime';

	interface Props {
		tokensTracked: number;
		tailLastBlock: number | null;
		newIn24h: number;
		totalTvlSats: number;
		listedCount: number;
		tokenTxs24h: number;
	}

	let {
		tokensTracked,
		tailLastBlock,
		newIn24h,
		totalTvlSats,
		listedCount,
		tokenTxs24h
	}: Props = $props();

	// Locale-aware grouping: "1,234" (en) vs "1.234" (es), etc.
	const fmt = (n: number) => n.toLocaleString(getLocale());

	// Compact USD for the Total TVL card — "$1.13M", "$742k", "$0".
	function compactUSD(n: number): string {
		if (!Number.isFinite(n) || n <= 0) return '—';
		if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
		if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}k`;
		return `$${n.toFixed(0)}`;
	}

	const tvlUSD = $derived.by(() => {
		const p = $bchPrice.bchPrice;
		if (!p) return null;
		return (totalTvlSats / 1e8) * p;
	});
</script>

<div class="bg-gradient-to-r from-slate-50 to-slate-100 dark:from-zinc-900 dark:to-zinc-800 border-b ts-border-strong">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-3">
		<div class="hidden md:flex items-center justify-between">
			<div class="flex items-center gap-8">
				<Tooltip>
					<TooltipTrigger class="flex items-center gap-2 cursor-default">
						<span class="text-xs font-medium uppercase tracking-wider ts-text-muted">
							{m.metrics_tracked()}
						</span>
						<span class="px-3 py-1 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 font-semibold text-sm">
							{fmt(tokensTracked)}
						</span>
					</TooltipTrigger>
					<TooltipContent>
						{m.metrics_tracked_tip()}
					</TooltipContent>
				</Tooltip>

				<Tooltip>
					<TooltipTrigger class="flex items-center gap-2 cursor-default">
						<span class="text-xs font-medium uppercase tracking-wider ts-text-muted">
							{m.metrics_listed()}
						</span>
						<a
							href={localizeHref('/?listed=1&sort=tvl')}
							class="font-semibold text-violet-600 dark:text-violet-400 text-sm underline-offset-4 hover:underline"
						>
							{fmt(listedCount)}
						</a>
					</TooltipTrigger>
					<TooltipContent>
						{m.metrics_listed_tip()}
					</TooltipContent>
				</Tooltip>

				<Tooltip>
					<TooltipTrigger class="flex items-center gap-2 cursor-default">
						<span class="text-xs font-medium uppercase tracking-wider ts-text-muted">
							{m.metrics_tvl()}
						</span>
						{#if tvlUSD !== null}
							<span class="font-semibold text-slate-900 dark:text-white text-sm font-mono">
								{compactUSD(tvlUSD)}
							</span>
						{:else}
							<span class="inline-block w-14 h-4 bg-slate-200 dark:bg-zinc-700 rounded animate-pulse"></span>
						{/if}
					</TooltipTrigger>
					<TooltipContent>
						{m.metrics_tvl_tip()}
					</TooltipContent>
				</Tooltip>

				<a
					href={localizeHref('/?new24h=1&sort=recent')}
					class="flex items-center gap-2 hover:opacity-80 transition-opacity"
					title={m.metrics_new24h_tip()}
				>
					<span class="text-xs font-medium uppercase tracking-wider ts-text-muted">
						{m.metrics_new24h()}
					</span>
					<span class="font-semibold text-violet-600 dark:text-violet-400 text-sm underline-offset-4 hover:underline">
						{fmt(newIn24h)}
					</span>
				</a>

				<Tooltip>
					<TooltipTrigger class="flex items-center gap-2 cursor-default">
						<span class="text-xs font-medium uppercase tracking-wider ts-text-muted">
							{m.metrics_txs24h()}
						</span>
						<a
							href={localizeHref('/faq#faq-txs-24h')}
							class="font-semibold text-violet-600 dark:text-violet-400 text-sm underline-offset-4 hover:underline"
						>
							{fmt(tokenTxs24h)}
						</a>
					</TooltipTrigger>
					<TooltipContent>
						{m.metrics_txs24h_tip()}
					</TooltipContent>
				</Tooltip>

				{#if tailLastBlock !== null}
					<Tooltip>
						<TooltipTrigger class="flex items-center gap-2 cursor-default">
							<span class="text-xs font-medium uppercase tracking-wider ts-text-muted">
								{m.metrics_block()}
							</span>
							<a
								href={localizeHref('/blocks')}
								class="font-mono text-sm text-violet-600 dark:text-violet-400 underline-offset-4 hover:underline"
							>
								{fmt(tailLastBlock)}
							</a>
						</TooltipTrigger>
						<TooltipContent>
							{m.metrics_block_tip()}
						</TooltipContent>
					</Tooltip>
				{/if}

				<Tooltip>
					<TooltipTrigger class="flex items-center gap-2 cursor-default">
						<span class="text-xs font-medium uppercase tracking-wider ts-text-muted">
							{m.metrics_bch()}
						</span>
						{#if $bchPrice.bchPrice}
							<span class="font-mono text-slate-900 dark:text-white font-semibold text-sm">
								${$bchPrice.bchPrice.toLocaleString(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
							</span>
						{:else}
							<span class="inline-block w-16 h-4 bg-slate-200 dark:bg-zinc-700 rounded animate-pulse"></span>
						{/if}
					</TooltipTrigger>
					<TooltipContent>
						{m.metrics_bch_tip()}
					</TooltipContent>
				</Tooltip>
			</div>
		</div>

		<div class="md:hidden grid grid-cols-2 gap-2 py-1">
			<div class="flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-zinc-800 shadow-sm">
				<span class="text-xs ts-text-muted">{m.metrics_tokens_mobile()}</span>
				<span class="font-semibold text-violet-600 dark:text-violet-400 text-sm">{fmt(tokensTracked)}</span>
			</div>
			<a
				href={localizeHref('/?listed=1&sort=tvl')}
				class="flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-zinc-800 shadow-sm hover:bg-slate-50 dark:hover:bg-zinc-700 transition-colors"
				title={m.metrics_listed_title()}
			>
				<span class="text-xs ts-text-muted">{m.metrics_listed()}</span>
				<span class="font-semibold text-violet-600 dark:text-violet-400 text-sm">{fmt(listedCount)}</span>
			</a>
			<div class="flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-zinc-800 shadow-sm">
				<span class="text-xs ts-text-muted">{m.metrics_tvl()}</span>
				{#if tvlUSD !== null}
					<span class="font-mono font-semibold text-sm">{compactUSD(tvlUSD)}</span>
				{:else}
					<span class="inline-block w-12 h-4 bg-slate-200 dark:bg-zinc-700 rounded animate-pulse"></span>
				{/if}
			</div>
			<a
				href={localizeHref('/?new24h=1&sort=recent')}
				class="flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-zinc-800 shadow-sm no-underline"
				title={m.metrics_new24h_title()}
			>
				<span class="text-xs ts-text-muted">{m.metrics_new24h()}</span>
				<span class="font-semibold text-sm text-violet-600 dark:text-violet-400">{fmt(newIn24h)}</span>
			</a>
			<a
				href={localizeHref('/faq#faq-txs-24h')}
				class="flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-zinc-800 shadow-sm no-underline"
				title={m.metrics_txs24h_title()}
			>
				<span class="text-xs ts-text-muted">{m.metrics_txs24h()}</span>
				<span class="font-semibold text-sm text-violet-600 dark:text-violet-400">{fmt(tokenTxs24h)}</span>
			</a>
			{#if tailLastBlock !== null}
				<a
					href={localizeHref('/blocks')}
					class="flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-zinc-800 shadow-sm no-underline hover:bg-slate-50 dark:hover:bg-zinc-700 transition-colors"
					title={m.metrics_block_title()}
				>
					<span class="text-xs ts-text-muted">{m.metrics_block()}</span>
					<span class="font-mono text-sm text-violet-600 dark:text-violet-400">{fmt(tailLastBlock)}</span>
				</a>
			{/if}
			<div class="flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-zinc-800 shadow-sm">
				<span class="text-xs ts-text-muted">{m.metrics_bch()}</span>
				{#if $bchPrice.bchPrice}
					<span class="font-mono font-semibold text-sm">${$bchPrice.bchPrice.toFixed(2)}</span>
				{:else}
					<span class="w-12 h-4 bg-slate-200 dark:bg-zinc-700 rounded animate-pulse"></span>
				{/if}
			</div>
				<a
					href="/briefing"
					class="flex items-center gap-2 hover:opacity-80 transition-opacity"
					title="Stork Sightings — daily BCH token briefing"
				>
					<span class="text-xs font-medium uppercase tracking-wider ts-text-muted">
						Briefing
					</span>
					<span class="font-semibold text-emerald-600 dark:text-emerald-400 text-sm underline-offset-4 hover:underline">
						Daily
					</span>
				</a>
			</div>
		</div>
</div>
