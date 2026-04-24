<script lang="ts">
	import { bchPrice } from '$lib/stores/bchPrice';
	import { Tooltip, TooltipTrigger, TooltipContent } from '$lib/components/ui/tooltip';

	interface Props {
		tokensTracked: number;
		tailLastBlock: number | null;
		newIn24h: number;
		totalTvlSats: number;
		listedCount: number;
	}

	let { tokensTracked, tailLastBlock, newIn24h, totalTvlSats, listedCount }: Props = $props();

	const fmt = (n: number) => n.toLocaleString('en-US');

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

<div class="bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 border-b border-slate-200 dark:border-slate-700">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-3">
		<div class="hidden md:flex items-center justify-between">
			<div class="flex items-center gap-8">
				<Tooltip>
					<TooltipTrigger class="flex items-center gap-2 cursor-default">
						<span class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
							Tracked
						</span>
						<span class="px-3 py-1 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 font-semibold text-sm">
							{fmt(tokensTracked)}
						</span>
					</TooltipTrigger>
					<TooltipContent>
						Every CashToken category our indexer has ever seen since activation block 792,772 — fungible and non-fungible, active or long-dead. Minus the ones hidden by moderation.
					</TooltipContent>
				</Tooltip>

				<a
					href="/?listed=1&sort=tvl"
					class="flex items-center gap-2 hover:opacity-80 transition-opacity"
					title="Subset of Tracked — tokens you can buy or sell right now (Cauldron AMM price or open Tapswap P2P listing). Click to view them."
				>
					<span class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
						Listed
					</span>
					<span class="font-semibold text-violet-600 dark:text-violet-400 text-sm underline-offset-4 hover:underline">
						{fmt(listedCount)}
					</span>
				</a>

				<Tooltip>
					<TooltipTrigger class="flex items-center gap-2 cursor-default">
						<span class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
							Total TVL
						</span>
						{#if tvlUSD !== null}
							<span class="font-semibold text-slate-900 dark:text-white text-sm font-mono">
								{compactUSD(tvlUSD)}
							</span>
						{:else}
							<span class="inline-block w-14 h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse"></span>
						{/if}
					</TooltipTrigger>
					<TooltipContent>
						Sum of BCH locked in Cauldron AMM pools across every listed token, priced in USD at the current BCH rate. P2P offers on Tapswap aren't counted — those aren't pooled liquidity.
					</TooltipContent>
				</Tooltip>

				<a
					href="/?new24h=1&sort=recent"
					class="flex items-center gap-2 hover:opacity-80 transition-opacity"
					title="Categories whose genesis transaction was mined in the last 24 hours. Click to view them."
				>
					<span class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
						New 24h
					</span>
					<span class="font-semibold text-violet-600 dark:text-violet-400 text-sm underline-offset-4 hover:underline">
						{fmt(newIn24h)}
					</span>
				</a>

				{#if tailLastBlock !== null}
					<Tooltip>
						<TooltipTrigger class="flex items-center gap-2 cursor-default">
							<span class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
								Block
							</span>
							<span class="font-mono text-sm text-slate-700 dark:text-slate-300">
								{fmt(tailLastBlock)}
							</span>
						</TooltipTrigger>
						<TooltipContent>
							Latest BCH block our tail worker has scanned for new CashToken categories and Tapswap listings. Typically sub-second behind tip via ZMQ.
						</TooltipContent>
					</Tooltip>
				{/if}

				<Tooltip>
					<TooltipTrigger class="flex items-center gap-2 cursor-default">
						<span class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
							BCH
						</span>
						{#if $bchPrice.bchPrice}
							<span class="font-mono text-slate-900 dark:text-white font-semibold text-sm">
								${$bchPrice.bchPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
							</span>
						{:else}
							<span class="inline-block w-16 h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse"></span>
						{/if}
					</TooltipTrigger>
					<TooltipContent>
						BCH spot price in USD, refreshed every 5 minutes. Used across the site to convert BCH-denominated prices (Cauldron, Tapswap) to USD.
					</TooltipContent>
				</Tooltip>
			</div>
		</div>

		<div class="md:hidden grid grid-cols-2 gap-2 py-1">
			<div class="flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-slate-800 shadow-sm">
				<span class="text-xs text-slate-500 dark:text-slate-400">Tokens</span>
				<span class="font-semibold text-violet-600 dark:text-violet-400 text-sm">{fmt(tokensTracked)}</span>
			</div>
			<a
				href="/?listed=1&sort=tvl"
				class="flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-slate-800 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
			>
				<span class="text-xs text-slate-500 dark:text-slate-400">Listed</span>
				<span class="font-semibold text-violet-600 dark:text-violet-400 text-sm">{fmt(listedCount)}</span>
			</a>
			<div class="flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-slate-800 shadow-sm">
				<span class="text-xs text-slate-500 dark:text-slate-400">Total TVL</span>
				{#if tvlUSD !== null}
					<span class="font-mono font-semibold text-sm">{compactUSD(tvlUSD)}</span>
				{:else}
					<span class="inline-block w-12 h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse"></span>
				{/if}
			</div>
			<a
				href="/?new24h=1&sort=recent"
				class="flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-slate-800 shadow-sm no-underline"
				title="Tokens minted in the last 24 hours"
			>
				<span class="text-xs text-slate-500 dark:text-slate-400">New 24h</span>
				<span class="font-semibold text-sm text-violet-600 dark:text-violet-400">{fmt(newIn24h)}</span>
			</a>
			{#if tailLastBlock !== null}
				<div class="flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-slate-800 shadow-sm">
					<span class="text-xs text-slate-500 dark:text-slate-400">Block</span>
					<span class="font-mono text-sm">{fmt(tailLastBlock)}</span>
				</div>
			{/if}
			<div class="flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-slate-800 shadow-sm">
				<span class="text-xs text-slate-500 dark:text-slate-400">BCH</span>
				{#if $bchPrice.bchPrice}
					<span class="font-mono font-semibold text-sm">${$bchPrice.bchPrice.toFixed(2)}</span>
				{:else}
					<span class="w-12 h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse"></span>
				{/if}
			</div>
		</div>
	</div>
</div>
