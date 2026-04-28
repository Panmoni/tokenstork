<script lang="ts">
	// 24h movers — three top-5 cards (gainers / losers / TVL movers).
	// Used by /stats and the homepage; data comes from
	// $lib/server/movers.ts#getMovers24h.

	import type { MoverDisplay, MoversResult } from '$lib/server/movers';

	interface Props {
		movers: MoversResult;
	}

	let { movers }: Props = $props();

	function fmtPctSigned(p: number): string {
		const sign = p > 0 ? '+' : p < 0 ? '' : '';
		return `${sign}${p.toLocaleString('en-US', {
			minimumFractionDigits: 1,
			maximumFractionDigits: 1
		})}%`;
	}

	// Token label fallback ladder: symbol → name → 8-char hex prefix. The
	// latter is a last-resort identifier for tokens whose BCMR has no
	// non-empty symbol or name fields.
	function moverLabel(m: MoverDisplay | (MoverDisplay & { tvlPct: number })): string {
		return m.symbol || m.name || `${m.categoryHex.slice(0, 8)}…`;
	}
</script>

<section class="mb-8">
	<div class="flex items-center gap-1.5 mb-3">
		<h2 class="text-xl font-semibold text-slate-900 dark:text-white">24h movers</h2>
		<button
			type="button"
			class="text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
			aria-label="About 24h movers"
			title="Biggest 24-hour price + TVL changes among Cauldron-listed tokens. Computed from the oldest price_history point ≥23h ago vs. the newest point within the last 23h. Tokens without two qualifying points (newly listed, or sync gap) are excluded."
		>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4" aria-hidden="true">
				<circle cx="12" cy="12" r="10" />
				<line x1="12" y1="16" x2="12" y2="12" />
				<line x1="12" y1="8" x2="12.01" y2="8" />
			</svg>
		</button>
	</div>
	<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
		<!-- Top gainers -->
		<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<h3 class="text-sm font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400 mb-3">
				Top gainers
			</h3>
			{#if movers.topGainers24h.length === 0}
				<p class="text-xs text-slate-500 dark:text-slate-400">
					{#if movers.has24hHistory}
						No tokens up in the last 24h.
					{:else}
						Building 24h history — refreshes as <code>sync-cauldron</code> ticks accumulate.
					{/if}
				</p>
			{:else}
				<ul class="space-y-2">
					{#each movers.topGainers24h as m (m.categoryHex)}
						<li>
							<a
								href={`/token/${m.categoryHex}`}
								class="flex items-baseline justify-between gap-3 hover:text-violet-600 dark:hover:text-violet-400"
							>
								<span class="truncate text-sm font-medium text-slate-900 dark:text-white">
									{moverLabel(m)}
								</span>
								<span class="text-sm font-mono font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
									{fmtPctSigned(m.pricePct)}
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<!-- Top losers -->
		<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<h3 class="text-sm font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-400 mb-3">
				Top losers
			</h3>
			{#if movers.topLosers24h.length === 0}
				<p class="text-xs text-slate-500 dark:text-slate-400">
					{#if movers.has24hHistory}
						No tokens down in the last 24h.
					{:else}
						Building 24h history — refreshes as <code>sync-cauldron</code> ticks accumulate.
					{/if}
				</p>
			{:else}
				<ul class="space-y-2">
					{#each movers.topLosers24h as m (m.categoryHex)}
						<li>
							<a
								href={`/token/${m.categoryHex}`}
								class="flex items-baseline justify-between gap-3 hover:text-violet-600 dark:hover:text-violet-400"
							>
								<span class="truncate text-sm font-medium text-slate-900 dark:text-white">
									{moverLabel(m)}
								</span>
								<span class="text-sm font-mono font-semibold text-rose-600 dark:text-rose-400 whitespace-nowrap">
									{fmtPctSigned(m.pricePct)}
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<!-- TVL movers (signed; biggest absolute % move) -->
		<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<h3 class="text-sm font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-400 mb-3">
				TVL movers
			</h3>
			{#if movers.topTvlMovers24h.length === 0}
				<p class="text-xs text-slate-500 dark:text-slate-400">
					{#if movers.has24hHistory}
						No measurable TVL changes in the last 24h.
					{:else}
						Building 24h history — refreshes as <code>sync-cauldron</code> ticks accumulate.
					{/if}
				</p>
			{:else}
				<ul class="space-y-2">
					{#each movers.topTvlMovers24h as m (m.categoryHex)}
						<li>
							<a
								href={`/token/${m.categoryHex}`}
								class="flex items-baseline justify-between gap-3 hover:text-violet-600 dark:hover:text-violet-400"
							>
								<span class="truncate text-sm font-medium text-slate-900 dark:text-white">
									{moverLabel(m)}
								</span>
								<span
									class={`text-sm font-mono font-semibold whitespace-nowrap ${m.tvlPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}
								>
									{fmtPctSigned(m.tvlPct)}
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
</section>
