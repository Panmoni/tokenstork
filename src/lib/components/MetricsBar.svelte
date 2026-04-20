<script lang="ts">
	import { bchPrice } from '$lib/stores/bchPrice';

	interface Props {
		tokensTracked: number;
	}

	let { tokensTracked }: Props = $props();
</script>

<div class="bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 border-b border-slate-200 dark:border-slate-700">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-3">
		<div class="hidden md:flex items-center justify-between">
			<div class="flex items-center gap-8">
				<div class="flex items-center gap-2">
					<span class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
						Tracked
					</span>
					<span class="px-3 py-1 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 font-semibold text-sm">
						{tokensTracked}
					</span>
				</div>
				<div class="flex items-center gap-2">
					<span class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
						BCH
					</span>
					{#if $bchPrice.bchPrice}
						<span class="font-mono text-slate-900 dark:text-white font-semibold">
							${$bchPrice.bchPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
						</span>
					{:else}
						<span class="inline-block w-16 h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse"></span>
					{/if}
				</div>
			</div>
			<div class="text-xs text-slate-500 dark:text-slate-400">
				Updates every 5 min
			</div>
		</div>

		<div class="md:hidden grid grid-cols-2 gap-3 py-2">
			<div class="flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-slate-800 shadow-sm">
				<span class="text-xs text-slate-500 dark:text-slate-400">Tokens</span>
				<span class="font-semibold text-violet-600 dark:text-violet-400">{tokensTracked}</span>
			</div>
			<div class="flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-slate-800 shadow-sm">
				<span class="text-xs text-slate-500 dark:text-slate-400">BCH</span>
				{#if $bchPrice.bchPrice}
					<span class="font-mono font-semibold">${$bchPrice.bchPrice.toFixed(2)}</span>
				{:else}
					<span class="w-12 h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse"></span>
				{/if}
			</div>
		</div>
	</div>
</div>
