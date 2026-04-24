<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		getIPFSUrl,
		humanizeNumericSupply,
		formatVenuePriceUSD,
		formatVenueTvlUSD,
		stripEmoji
	} from '$lib/format';
	import { bchPrice } from '$lib/stores/bchPrice';
	import FormatCategory from './FormatCategory.svelte';
	import Sparkline from './Sparkline.svelte';
	import type { TokenApiRow, TokenType } from '$lib/types';

	interface Props {
		tokens: TokenApiRow[];
		total: number;
		limit: number;
		offset: number;
		// Server-computed gate (satoshis): tokens whose Cauldron TVL is below
		// this value have their MCap cell blanked. See issue #8 — low-TVL
		// tokens otherwise produce nonsense caps that pollute the rankings.
		mcapTvlThresholdSats: number;
	}

	let { tokens, total, limit, offset, mcapTvlThresholdSats }: Props = $props();

	// Format a % change as "+1.23%" / "-4.56%". Rounded to 2dp; "—" for null
	// windows (insufficient history). Color is applied by the caller via
	// pctColor() so tests/exports can re-use the formatting alone.
	function fmtPct(n: number | null): string {
		if (n == null || !Number.isFinite(n)) return '—';
		const sign = n > 0 ? '+' : '';
		return `${sign}${n.toFixed(2)}%`;
	}
	function pctColor(n: number | null): string {
		if (n == null || !Number.isFinite(n)) return 'text-slate-400 dark:text-slate-500';
		if (n > 0) return 'text-emerald-600 dark:text-emerald-400';
		if (n < 0) return 'text-rose-600 dark:text-rose-400';
		return 'text-slate-500 dark:text-slate-400';
	}

	// Market cap = cauldron price (sats per smallest unit) × circulating
	// supply (raw smallest units) × bchUSD / 1e8. The `decimals` factor
	// cancels out because price is per-smallest-unit and supply is in
	// smallest units. `currentSupply` is a NUMERIC(78,0) string; Number()
	// is safe up to ~2^53 which comfortably covers realistic market caps.
	// Returns null when the token's Cauldron TVL is below the low-liquidity
	// gate: such caps are derived from negligible on-venue depth and skew
	// rankings.
	function marketCapUSD(
		priceSats: number | null,
		supplyRaw: string | null,
		_decimals: number,
		bchUSD: number | null,
		tvlSats: number | null,
		tvlThresholdSats: number
	): number | null {
		if (priceSats == null || supplyRaw == null || !bchUSD) return null;
		if (tvlSats == null || tvlSats < tvlThresholdSats) return null;
		const supply = Number(supplyRaw);
		if (!Number.isFinite(supply) || supply <= 0) return null;
		return (priceSats * supply * bchUSD) / 1e8;
	}

	function compactUSD(n: number | null): string {
		if (n == null || !Number.isFinite(n) || n <= 0) return '—';
		if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
		if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
		if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}k`;
		if (n >= 1) return `$${n.toFixed(2)}`;
		return `$${n.toFixed(4)}`;
	}

// Local input value, bound to the search box; URL is the source of truth.
	let searchInput = $state(page.url.searchParams.get('search') ?? '');
	let searchDebounce: ReturnType<typeof setTimeout> | null = null;

	const typeFilter = $derived<TokenType | 'all'>(
		(page.url.searchParams.get('type') as TokenType) ?? 'all'
	);
	const sort = $derived(page.url.searchParams.get('sort') ?? 'name');
	const onlyCauldron = $derived(page.url.searchParams.get('cauldron') === '1');
	const onlyTapswap = $derived(page.url.searchParams.get('tapswap') === '1');

	function navigateWith(mutate: (params: URLSearchParams) => void) {
		const params = new URLSearchParams(page.url.searchParams);
		mutate(params);
		// Build an absolute-path URL explicitly. `goto('?foo=bar')` worked in
		// older SvelteKit but in 5.x / Svelte 5 the query-only form is
		// inconsistent — it sometimes no-ops without re-running the server
		// load. Passing `${pathname}?${query}` is unambiguous. `invalidateAll`
		// guarantees the +page.server.ts load re-runs.
		const qs = params.toString();
		const url = qs ? `${page.url.pathname}?${qs}` : page.url.pathname;
		goto(url, { keepFocus: true, noScroll: true, invalidateAll: true });
	}

	function pushParam(key: string, value: string | null) {
		navigateWith((p) => {
			if (value === null || value === '') p.delete(key);
			else p.set(key, value);
			p.delete('offset');
		});
	}

	function onSearchInput() {
		if (searchDebounce) clearTimeout(searchDebounce);
		searchDebounce = setTimeout(() => {
			pushParam('search', searchInput.trim() || null);
		}, 250);
	}

	function setSort(key: string) {
		pushParam('sort', key === 'name' ? null : key);
	}

	function setType(value: string) {
		pushParam('type', value === 'all' ? null : value);
	}

	function toggleTapswap(checked: boolean) {
		pushParam('tapswap', checked ? '1' : null);
	}

	function toggleCauldron(checked: boolean) {
		pushParam('cauldron', checked ? '1' : null);
	}

	function setPage(newOffset: number) {
		navigateWith((p) => {
			if (newOffset <= 0) p.delete('offset');
			else p.set('offset', String(newOffset));
		});
	}

	const hasPrev = $derived(offset > 0);
	const hasNext = $derived(offset + limit < total);
</script>

<div class="space-y-4">
	<div class="flex flex-col sm:flex-row gap-3">
		<div class="relative flex-1">
			<input
				type="search"
				placeholder="Search name, symbol, description, or category..."
				bind:value={searchInput}
				oninput={onSearchInput}
				class="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all"
				aria-label="Search tokens"
			/>
			<svg class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
			</svg>
		</div>
		<select
			value={typeFilter}
			onchange={(e) => setType((e.currentTarget as HTMLSelectElement).value)}
			class="px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
			aria-label="Filter by type"
		>
			<option value="all">All types</option>
			<option value="FT">FT</option>
			<option value="NFT">NFT</option>
			<option value="FT+NFT">FT + NFT</option>
		</select>
		<label
			class="flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-300 cursor-pointer select-none hover:border-violet-500 transition-colors"
			title="Only show tokens currently listed on the Cauldron DEX"
		>
			<input
				type="checkbox"
				checked={onlyCauldron}
				onchange={(e) => toggleCauldron((e.currentTarget as HTMLInputElement).checked)}
				class="w-4 h-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
			/>
			<img src="/cauldron-logo.png" alt="Cauldron" class="h-5 w-5" />
			<span>Cauldron</span>
		</label>
		<label
			class="flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-300 cursor-pointer select-none hover:border-emerald-500 transition-colors"
			title="Only show tokens with open P2P listings on Tapswap"
		>
			<input
				type="checkbox"
				checked={onlyTapswap}
				onchange={(e) => toggleTapswap((e.currentTarget as HTMLInputElement).checked)}
				class="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
			/>
			<img src="/tapswap-logo.png" alt="Tapswap" class="h-5 w-5" />
			<span>Tapswap</span>
		</label>
	</div>

	<!--
		Desktop grid. Explicit grid-template-columns so the % columns stay
		narrow and the sparkline has real pixels to paint in. Layout:
		  Token(3fr) Price(1.2fr) 1h(0.8fr) 24h(0.8fr) 7d(0.8fr)
		  MCap(1.2fr) TVL(1.2fr) Supply(1fr) Spark(1.2fr)
		Type (FT/NFT) + Cauldron/Tapswap venue badges collapse into the
		Token cell alongside name+symbol; holder count, NFT count, and
		truncated category stay on the token detail page.
	-->
	<div class="hidden md:block overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
		<div
			class="grid grid-cols-[4.5fr_1.2fr_0.8fr_0.8fr_0.8fr_1.2fr_1.2fr_1fr_1.2fr] gap-2 px-4 py-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider items-center"
		>
			<button type="button" class="text-left cursor-pointer hover:text-violet-600 dark:hover:text-violet-400" onclick={() => setSort('name')}>
				Token {sort === 'name' ? '↕' : ''}
			</button>
			<div class="text-right">Price</div>
			<div class="text-right" title="Price change vs. the nearest history point ≥1h old. Cauldron syncs every 4h, so this often reflects the ~4h mark.">1h</div>
			<div class="text-right" title="Price change vs. the nearest history point ≥24h old">24h</div>
			<div class="text-right" title="Price change vs. the nearest history point ≥7d old">7d</div>
			<div class="text-right" title="Price × circulating supply. Hidden for tokens whose Cauldron TVL is below the average TVL of the top half of listed tokens — those caps are derived from negligible liquidity and would skew rankings.">MCap</div>
			<button type="button" class="text-right cursor-pointer hover:text-violet-600 dark:hover:text-violet-400" onclick={() => setSort('tvl')}>
				TVL {sort === 'tvl' ? '↓' : ''}
			</button>
			<button type="button" class="text-right cursor-pointer hover:text-violet-600 dark:hover:text-violet-400" onclick={() => setSort('supply')}>
				Supply {sort === 'supply' ? '↓' : ''}
			</button>
			<div class="text-right" title="Price over the last 7 days">Last 7d</div>
		</div>

		{#each tokens as token (token.id)}
			<div
				class="grid grid-cols-[4.5fr_1.2fr_0.8fr_0.8fr_0.8fr_1.2fr_1.2fr_1fr_1.2fr] gap-2 px-4 py-4 items-center border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors"
			>
				<a href={`/token/${token.id}`} class="flex items-center gap-3 min-w-0 no-underline group">
					{#if token.icon}
						<img src={getIPFSUrl(token.icon)} alt="" class="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800" loading="lazy" />
					{:else}
						<div class="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden="true"></div>
					{/if}
					<div class="min-w-0">
						<div class="font-semibold text-slate-900 dark:text-white truncate group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
							{stripEmoji(token.name) || '—'}
							{#if token.symbol}<span class="ml-2 text-xs text-slate-500 font-mono">{stripEmoji(token.symbol)}</span>{/if}
							<span class="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" title="Token type">{token.tokenType}</span>
							{#if token.cauldronPriceSats != null}
								<img src="/cauldron-logo.png" alt="Cauldron" title="Listed on Cauldron (AMM)" class="ml-1 inline-block h-4 w-4 align-text-bottom" />
							{/if}
							{#if token.tapswapListingCount > 0}
								<img src="/tapswap-logo.png" alt="Tapswap" title="{token.tapswapListingCount} open listing{token.tapswapListingCount === 1 ? '' : 's'} on Tapswap (P2P)" class="ml-1 inline-block h-4 w-4 align-text-bottom" />
							{/if}
						</div>
						{#if token.description}
							<div class="text-xs text-slate-500 dark:text-slate-400 truncate">{stripEmoji(token.description).slice(0, 80)}</div>
						{/if}
					</div>
				</a>
				<div class="text-right font-mono text-sm text-slate-700 dark:text-slate-300">
					{formatVenuePriceUSD(token.cauldronPriceSats, token.decimals, $bchPrice.bchPrice)}
				</div>
				<div class={`text-right font-mono text-xs ${pctColor(token.priceChange1hPct)}`}>
					{fmtPct(token.priceChange1hPct)}
				</div>
				<div class={`text-right font-mono text-xs ${pctColor(token.priceChange24hPct)}`}>
					{fmtPct(token.priceChange24hPct)}
				</div>
				<div class={`text-right font-mono text-xs ${pctColor(token.priceChange7dPct)}`}>
					{fmtPct(token.priceChange7dPct)}
				</div>
				<div class="text-right font-mono text-sm text-slate-700 dark:text-slate-300">
					{compactUSD(marketCapUSD(token.cauldronPriceSats, token.currentSupply, token.decimals, $bchPrice.bchPrice, token.cauldronTvlSatoshis, mcapTvlThresholdSats))}
				</div>
				<div class="text-right font-mono text-sm text-slate-700 dark:text-slate-300">
					{formatVenueTvlUSD(token.cauldronTvlSatoshis, $bchPrice.bchPrice)}
				</div>
				<div class="text-right font-mono text-xs text-slate-700 dark:text-slate-300">
					{humanizeNumericSupply(token.currentSupply, token.decimals)}
				</div>
				<div class="text-right">
					<Sparkline points={token.sparklinePoints} />
				</div>
			</div>
		{/each}
	</div>

	<!-- Mobile card layout — Price + TVL shown only when relevant (listed). -->
	<div class="md:hidden grid gap-3">
		{#each tokens as token (token.id)}
			<div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 hover:shadow-lg hover:border-violet-200 dark:hover:border-violet-800 transition-all">
				<a href={`/token/${token.id}`} class="block no-underline">
					<div class="flex items-start justify-between mb-3">
						<div class="flex items-center gap-3 min-w-0">
							{#if token.icon}
								<img src={getIPFSUrl(token.icon)} alt="" class="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800" />
							{:else}
								<div class="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden="true"></div>
							{/if}
							<div class="min-w-0">
								<div class="font-semibold text-slate-900 dark:text-white truncate">{stripEmoji(token.name) || '—'}</div>
								<div class="text-sm text-slate-500 font-mono">{stripEmoji(token.symbol)}</div>
							</div>
						</div>
						<span class="px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-xs font-medium">
							{token.tokenType}
						</span>
					</div>
					{#if token.cauldronPriceSats != null}
						<div class="grid grid-cols-2 gap-2 text-sm mb-2">
							<div>
								<div class="text-xs text-slate-500 mb-1">Price</div>
								<div class="font-mono">{formatVenuePriceUSD(token.cauldronPriceSats, token.decimals, $bchPrice.bchPrice)}</div>
							</div>
							<div>
								<div class="text-xs text-slate-500 mb-1">TVL</div>
								<div class="font-mono">{formatVenueTvlUSD(token.cauldronTvlSatoshis, $bchPrice.bchPrice)}</div>
							</div>
						</div>
					{/if}
					<div class="grid grid-cols-3 gap-2 text-sm">
						<div>
							<div class="text-xs text-slate-500 mb-1">Supply</div>
							<div class="font-mono">{humanizeNumericSupply(token.currentSupply, token.decimals)}</div>
						</div>
						<div>
							<div class="text-xs text-slate-500 mb-1">Holders</div>
							<div>{token.holderCount ?? '-'}</div>
						</div>
						<div>
							<div class="text-xs text-slate-500 mb-1">NFTs</div>
							<div>{token.liveNftCount ?? '-'}</div>
						</div>
					</div>
				</a>
				<div class="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end">
					<FormatCategory category={token.id} />
				</div>
			</div>
		{/each}
	</div>

	{#if tokens.length === 0}
		<div class="text-center py-12">
			<div class="text-slate-400 dark:text-slate-500 text-lg mb-2">No tokens found</div>
			<div class="text-slate-500 dark:text-slate-400 text-sm">
				Try a different search or filter.
			</div>
		</div>
	{/if}

	{#if total > limit}
		<div class="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
			<div>
				Showing {offset + 1}&ndash;{Math.min(offset + limit, total)} of {total}
			</div>
			<div class="flex gap-2">
				<button
					type="button"
					class="px-3 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
					disabled={!hasPrev}
					onclick={() => setPage(Math.max(0, offset - limit))}
				>
					Prev
				</button>
				<button
					type="button"
					class="px-3 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
					disabled={!hasNext}
					onclick={() => setPage(offset + limit)}
				>
					Next
				</button>
			</div>
		</div>
	{/if}
</div>
