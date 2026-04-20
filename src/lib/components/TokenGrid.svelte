<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getIPFSUrl, humanizeBigNumber } from '$lib/format';
	import FormatCategory from './FormatCategory.svelte';
	import type { TokenApiRow, TokenType } from '$lib/types';

	interface Props {
		tokens: TokenApiRow[];
		total: number;
		limit: number;
		offset: number;
	}

	let { tokens, total, limit, offset }: Props = $props();

	// Filter + sort state synced with URL.
	let search = $state(page.url.searchParams.get('search') ?? '');
	const typeFilter = $derived<TokenType | 'all'>(
		(page.url.searchParams.get('type') as TokenType) ?? 'all'
	);
	const sort = $derived(page.url.searchParams.get('sort') ?? 'name');

	const filtered = $derived.by(() => {
		if (!search) return tokens;
		const s = search.toLowerCase();
		return tokens.filter(
			(t) =>
				(t.name?.toLowerCase().includes(s) ?? false) ||
				(t.symbol?.toLowerCase().includes(s) ?? false) ||
				t.id.toLowerCase().includes(s)
		);
	});

	function decimalSupply(row: TokenApiRow): string {
		if (!row.currentSupply) return '-';
		const decimals = row.decimals ?? 0;
		if (decimals === 0) return humanizeBigNumber(Number(row.currentSupply));
		const divisor = 10 ** decimals;
		return humanizeBigNumber(Number(row.currentSupply) / divisor);
	}

	function pushParam(key: string, value: string | null) {
		const params = new URLSearchParams(page.url.searchParams);
		if (value === null || value === '') {
			params.delete(key);
		} else {
			params.set(key, value);
		}
		params.delete('offset');
		goto(`?${params.toString()}`, { keepFocus: true, noScroll: true });
	}

	function setSort(key: string) {
		pushParam('sort', key === 'name' ? null : key);
	}

	function setType(value: string) {
		pushParam('type', value === 'all' ? null : value);
	}

	function setPage(newOffset: number) {
		const params = new URLSearchParams(page.url.searchParams);
		if (newOffset <= 0) params.delete('offset');
		else params.set('offset', String(newOffset));
		goto(`?${params.toString()}`);
	}

	const hasPrev = $derived(offset > 0);
	const hasNext = $derived(offset + limit < total);
</script>

<div class="space-y-4">
	<div class="flex flex-col sm:flex-row gap-3">
		<div class="relative flex-1">
			<input
				type="text"
				placeholder="Search by name, symbol, or category..."
				bind:value={search}
				class="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all"
			/>
			<svg class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
			</svg>
		</div>
		<select
			value={typeFilter}
			onchange={(e) => setType((e.currentTarget as HTMLSelectElement).value)}
			class="px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
		>
			<option value="all">All types</option>
			<option value="FT">FT</option>
			<option value="NFT">NFT</option>
			<option value="FT+NFT">FT + NFT</option>
		</select>
	</div>

	<div class="hidden md:block overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
		<div class="grid grid-cols-12 gap-2 px-4 py-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
			<button type="button" class="col-span-4 text-left cursor-pointer hover:text-violet-600 dark:hover:text-violet-400" onclick={() => setSort('name')}>
				Token {sort === 'name' ? '↕' : ''}
			</button>
			<div class="col-span-1">Type</div>
			<button type="button" class="col-span-2 text-right cursor-pointer hover:text-violet-600 dark:hover:text-violet-400" onclick={() => setSort('supply')}>
				Supply {sort === 'supply' ? '↓' : ''}
			</button>
			<button type="button" class="col-span-2 text-right cursor-pointer hover:text-violet-600 dark:hover:text-violet-400" onclick={() => setSort('holders')}>
				Holders {sort === 'holders' ? '↓' : ''}
			</button>
			<div class="col-span-2 text-right">NFTs</div>
			<div class="col-span-1 text-right">Category</div>
		</div>

		{#each filtered as token (token.id)}
			<a
				href={`/token/${token.id}`}
				class="grid grid-cols-12 gap-2 px-4 py-4 items-center border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors group no-underline"
			>
				<div class="col-span-4 flex items-center gap-3 min-w-0">
					{#if token.icon}
						<img src={getIPFSUrl(token.icon)} alt={token.name ?? ''} class="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800" loading="lazy" />
					{:else}
						<div class="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800"></div>
					{/if}
					<div class="min-w-0">
						<div class="font-semibold text-slate-900 dark:text-white truncate group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
							{token.name ?? '—'}
							{#if token.symbol}<span class="ml-2 text-xs text-slate-500 font-mono">{token.symbol}</span>{/if}
						</div>
						{#if token.description}
							<div class="text-xs text-slate-500 dark:text-slate-400 truncate">{token.description.slice(0, 80)}</div>
						{/if}
					</div>
				</div>
				<div class="col-span-1 text-xs">
					<span class="px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 font-medium">
						{token.tokenType}
					</span>
				</div>
				<div class="col-span-2 text-right font-mono text-sm text-slate-700 dark:text-slate-300">
					{decimalSupply(token)}
				</div>
				<div class="col-span-2 text-right text-sm text-slate-700 dark:text-slate-300">
					{token.holderCount ?? '-'}
				</div>
				<div class="col-span-2 text-right text-sm text-slate-700 dark:text-slate-300">
					{token.liveNftCount ?? '-'}
				</div>
				<div class="col-span-1 text-right" onclick={(e) => e.stopPropagation()} role="presentation">
					<FormatCategory category={token.id} />
				</div>
			</a>
		{/each}
	</div>

	<!-- Mobile cards -->
	<div class="md:hidden grid gap-3">
		{#each filtered as token (token.id)}
			<a href={`/token/${token.id}`} class="block bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 hover:shadow-lg hover:border-violet-200 dark:hover:border-violet-800 transition-all no-underline">
				<div class="flex items-start justify-between mb-3">
					<div class="flex items-center gap-3 min-w-0">
						{#if token.icon}
							<img src={getIPFSUrl(token.icon)} alt={token.name ?? ''} class="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800" />
						{:else}
							<div class="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800"></div>
						{/if}
						<div class="min-w-0">
							<div class="font-semibold text-slate-900 dark:text-white truncate">{token.name ?? '—'}</div>
							<div class="text-sm text-slate-500 font-mono">{token.symbol ?? ''}</div>
						</div>
					</div>
					<span class="px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-xs font-medium">
						{token.tokenType}
					</span>
				</div>
				<div class="grid grid-cols-3 gap-2 text-sm">
					<div>
						<div class="text-xs text-slate-500 mb-1">Supply</div>
						<div class="font-mono">{decimalSupply(token)}</div>
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
		{/each}
	</div>

	{#if filtered.length === 0}
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
