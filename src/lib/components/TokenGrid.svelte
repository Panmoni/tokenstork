<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		getIPFSUrl,
		humanizeNumericSupply,
		formatVenuePriceUSD,
		formatVenueTvlUSD
	} from '$lib/format';
	import { bchPrice } from '$lib/stores/bchPrice';
	import FormatCategory from './FormatCategory.svelte';
	import type { TokenApiRow, TokenType } from '$lib/types';

	interface Props {
		tokens: TokenApiRow[];
		total: number;
		limit: number;
		offset: number;
	}

	let { tokens, total, limit, offset }: Props = $props();

	// Local input value, bound to the search box; URL is the source of truth.
	let searchInput = $state(page.url.searchParams.get('search') ?? '');
	let searchDebounce: ReturnType<typeof setTimeout> | null = null;

	const typeFilter = $derived<TokenType | 'all'>(
		(page.url.searchParams.get('type') as TokenType) ?? 'all'
	);
	const sort = $derived(page.url.searchParams.get('sort') ?? 'name');
	const onlyCauldron = $derived(page.url.searchParams.get('cauldron') === '1');

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
			On Cauldron
		</label>
	</div>

	<!--
		Desktop 12-col grid. Columns rebalance to fit Price + TVL:
		Token(3) Type(1) Price(2) TVL(2) Supply(1) Holders(1) NFTs(1) Category(1).
		NFTs + Holders + live-supply stats still show at col-span-1 since they're
		compact integers and the detail page is always one click away for depth.
	-->
	<div class="hidden md:block overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
		<div class="grid grid-cols-12 gap-2 px-4 py-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
			<button type="button" class="col-span-3 text-left cursor-pointer hover:text-violet-600 dark:hover:text-violet-400" onclick={() => setSort('name')}>
				Token {sort === 'name' ? '↕' : ''}
			</button>
			<div class="col-span-1">Type</div>
			<div class="col-span-2 text-right">Price</div>
			<button type="button" class="col-span-2 text-right cursor-pointer hover:text-violet-600 dark:hover:text-violet-400" onclick={() => setSort('tvl')}>
				TVL {sort === 'tvl' ? '↓' : ''}
			</button>
			<button type="button" class="col-span-1 text-right cursor-pointer hover:text-violet-600 dark:hover:text-violet-400" onclick={() => setSort('supply')}>
				Supply {sort === 'supply' ? '↓' : ''}
			</button>
			<button type="button" class="col-span-1 text-right cursor-pointer hover:text-violet-600 dark:hover:text-violet-400" onclick={() => setSort('holders')}>
				Holders {sort === 'holders' ? '↓' : ''}
			</button>
			<div class="col-span-1 text-right">NFTs</div>
			<div class="col-span-1 text-right">Category</div>
		</div>

		{#each tokens as token (token.id)}
			<div class="grid grid-cols-12 gap-2 px-4 py-4 items-center border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">
				<a href={`/token/${token.id}`} class="col-span-3 flex items-center gap-3 min-w-0 no-underline group">
					{#if token.icon}
						<img src={getIPFSUrl(token.icon)} alt="" class="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800" loading="lazy" />
					{:else}
						<div class="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden="true"></div>
					{/if}
					<div class="min-w-0">
						<div class="font-semibold text-slate-900 dark:text-white truncate group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
							{token.name || '—'}
							{#if token.symbol}<span class="ml-2 text-xs text-slate-500 font-mono">{token.symbol}</span>{/if}
						</div>
						{#if token.description}
							<div class="text-xs text-slate-500 dark:text-slate-400 truncate">{token.description.slice(0, 80)}</div>
						{/if}
					</div>
				</a>
				<div class="col-span-1 text-xs">
					<span class="px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 font-medium">
						{token.tokenType}
					</span>
				</div>
				<div class="col-span-2 text-right font-mono text-sm text-slate-700 dark:text-slate-300">
					{formatVenuePriceUSD(token.cauldronPriceSats, token.decimals, $bchPrice.bchPrice)}
				</div>
				<div class="col-span-2 text-right font-mono text-sm text-slate-700 dark:text-slate-300">
					{formatVenueTvlUSD(token.cauldronTvlSatoshis, $bchPrice.bchPrice)}
				</div>
				<div class="col-span-1 text-right font-mono text-xs text-slate-700 dark:text-slate-300">
					{humanizeNumericSupply(token.currentSupply, token.decimals)}
				</div>
				<div class="col-span-1 text-right text-xs text-slate-700 dark:text-slate-300">
					{token.holderCount ?? '-'}
				</div>
				<div class="col-span-1 text-right text-xs text-slate-700 dark:text-slate-300">
					{token.liveNftCount ?? '-'}
				</div>
				<div class="col-span-1 text-right">
					<FormatCategory category={token.id} />
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
								<div class="font-semibold text-slate-900 dark:text-white truncate">{token.name || '—'}</div>
								<div class="text-sm text-slate-500 font-mono">{token.symbol ?? ''}</div>
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
