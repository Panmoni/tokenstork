<script lang="ts">
	// 24h movers — three top-5 cards (gainers / losers / TVL movers).
	// Used by /stats and the homepage; data comes from
	// $lib/server/movers.ts#getMovers24h.

	import type { MoverDisplay, MoversResult } from '$lib/server/movers';
	import { stripEmoji } from '$lib/format';
	import InfoTooltip from '$lib/components/InfoTooltip.svelte';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';

	interface Props {
		movers: MoversResult;
	}

	let { movers }: Props = $props();

	function fmtPctSigned(p: number): string {
		const sign = p > 0 ? '+' : p < 0 ? '' : '';
		return `${sign}${p.toLocaleString(getLocale(), {
			minimumFractionDigits: 1,
			maximumFractionDigits: 1
		})}%`;
	}

	// Token label fallback ladder: symbol → name → 8-char hex prefix. The
	// latter is a last-resort identifier for tokens whose BCMR has no
	// non-empty symbol or name fields. Each candidate is stripped of
	// emoji + zero-width characters so a token whose symbol is purely
	// emoji ("🔥🐶🌭") doesn't render as an empty string and to keep the
	// directory's anti-spoofing rule (FAQ #faq-emoji) consistent here.
	function moverLabel(m: MoverDisplay | (MoverDisplay & { tvlPct: number })): string {
		const sym = stripEmoji(m.symbol).trim();
		if (sym) return sym;
		const name = stripEmoji(m.name).trim();
		if (name) return name;
		return `${m.categoryHex.slice(0, 8)}…`;
	}
</script>

<section class="mb-8">
	<div class="flex items-center gap-1.5 mb-3">
		<h2 class="text-xl font-semibold text-slate-900 dark:text-white">{m.movers_h2()}</h2>
		<InfoTooltip
			label={m.movers_tip_label()}
			text={m.movers_tip_text()}
		/>
	</div>
	<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
		<!-- Top gainers -->
		<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
			<h3 class="text-sm font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400 mb-3">
				{m.movers_top_gainers()}
			</h3>
			{#if movers.topGainers24h.length === 0}
				<p class="text-xs ts-text-muted">
					{#if movers.has24hHistory}
						{m.movers_none_up()}
					{:else}
						{m.movers_building_1()} <code>sync-cauldron</code> {m.movers_building_2()}
					{/if}
				</p>
			{:else}
				<ul class="space-y-2">
					{#each movers.topGainers24h as m (m.categoryHex)}
						<li>
							<a
								href={`/token/${m.categoryHex}`}
								data-sveltekit-preload-data="hover"
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
		<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
			<h3 class="text-sm font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-400 mb-3">
				{m.movers_top_losers()}
			</h3>
			{#if movers.topLosers24h.length === 0}
				<p class="text-xs ts-text-muted">
					{#if movers.has24hHistory}
						{m.movers_none_down()}
					{:else}
						{m.movers_building_1()} <code>sync-cauldron</code> {m.movers_building_2()}
					{/if}
				</p>
			{:else}
				<ul class="space-y-2">
					{#each movers.topLosers24h as m (m.categoryHex)}
						<li>
							<a
								href={`/token/${m.categoryHex}`}
								data-sveltekit-preload-data="hover"
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
		<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
			<h3 class="text-sm font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-400 mb-3">
				{m.movers_tvl_movers()}
			</h3>
			{#if movers.topTvlMovers24h.length === 0}
				<p class="text-xs ts-text-muted">
					{#if movers.has24hHistory}
						{m.movers_none_tvl()}
					{:else}
						{m.movers_building_1()} <code>sync-cauldron</code> {m.movers_building_2()}
					{/if}
				</p>
			{:else}
				<ul class="space-y-2">
					{#each movers.topTvlMovers24h as m (m.categoryHex)}
						<li>
							<a
								href={`/token/${m.categoryHex}`}
								data-sveltekit-preload-data="hover"
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
