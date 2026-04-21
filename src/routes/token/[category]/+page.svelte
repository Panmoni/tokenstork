<script lang="ts">
	import { getIPFSUrl, humanizeNumericSupply, formatMarketCap } from '$lib/format';
	import FormatCategory from '$lib/components/FormatCategory.svelte';

	let { data } = $props();

	const token = $derived(data.token);
	const decimalSupply = $derived(
		humanizeNumericSupply(token.currentSupply, token.decimals)
	);
	const marketCapUSD = $derived.by(() => {
		if (!token.currentSupply || data.priceUSD === 0) return 0;
		// Integer-shift in BigInt space to keep the integer part exact for supplies > 2^53.
		try {
			const base = BigInt(token.currentSupply);
			const divisor = 10n ** BigInt(Math.max(0, Math.min(8, token.decimals)));
			const whole = Number(base / divisor);
			const frac = Number(base % divisor) / Number(divisor);
			return (whole + frac) * data.priceUSD;
		} catch {
			return 0;
		}
	});
</script>

<svelte:head>
	<title>{token.name ?? token.id.slice(0, 10)} — Token Stork</title>
	{#if token.description}
		<meta name="description" content={token.description.slice(0, 160)} />
	{/if}
</svelte:head>

<main class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<div class="flex items-start gap-4 mb-6">
		{#if token.icon}
			<img src={getIPFSUrl(token.icon)} alt={token.name ?? ''} class="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800" />
		{:else}
			<div class="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800"></div>
		{/if}
		<div class="flex-1 min-w-0">
			<h1 class="text-3xl font-bold text-slate-900 dark:text-white truncate">
				{token.name ?? '—'}
				{#if token.symbol}<span class="ml-3 text-lg text-slate-500 font-mono font-normal">{token.symbol}</span>{/if}
			</h1>
			<div class="mt-2 flex items-center gap-3">
				<span class="px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-xs font-medium">
					{token.tokenType}
				</span>
				{#if token.isVerifiedOnchain}
					<span class="text-xs text-emerald-600 dark:text-emerald-400">✓ Verified on-chain</span>
				{/if}
				{#if token.isFullyBurned}
					<span class="text-xs text-red-600">Fully burned</span>
				{/if}
				{#if token.hasActiveMinting}
					<span class="text-xs text-amber-600">Minting open</span>
				{/if}
				<FormatCategory category={token.id} />
			</div>
		</div>
	</div>

	{#if token.description}
		<p class="text-slate-600 dark:text-slate-300 mb-8">{token.description}</p>
	{/if}

	<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
		<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800">
			<div class="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Supply</div>
			<div class="text-xl font-mono">{decimalSupply}</div>
		</div>
		<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800">
			<div class="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Holders</div>
			<div class="text-xl">{token.holderCount ?? '—'}</div>
		</div>
		<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800">
			<div class="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Price (USD)</div>
			<div class="text-xl font-mono">
				{#if data.priceUSD > 0}
					${data.priceUSD >= 1 ? data.priceUSD.toFixed(2) : data.priceUSD.toFixed(6)}
				{:else}
					—
				{/if}
			</div>
		</div>
		<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800">
			<div class="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">TVL (USD)</div>
			<div class="text-xl font-mono">
				{data.tvlUSD > 0 ? formatMarketCap(data.tvlUSD.toString()) : '—'}
			</div>
		</div>
		{#if marketCapUSD > 0}
			<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 col-span-2 md:col-span-1">
				<div class="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Market cap</div>
				<div class="text-xl font-mono">{formatMarketCap(marketCapUSD.toString())}</div>
			</div>
		{/if}
		<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800">
			<div class="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Genesis block</div>
			<div class="text-xl font-mono">{token.genesisBlock.toLocaleString()}</div>
		</div>
		<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800">
			<div class="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Live UTXOs</div>
			<div class="text-xl font-mono">{token.liveUtxoCount ?? '—'}</div>
		</div>
		<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800">
			<div class="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Live NFTs</div>
			<div class="text-xl font-mono">{token.liveNftCount ?? '—'}</div>
		</div>
	</div>

	{#if data.holders.length > 0}
		<section class="mb-8">
			<h2 class="text-xl font-bold text-slate-900 dark:text-white mb-4">Top holders</h2>
			<div class="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
				<table class="w-full text-sm">
					<thead class="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
						<tr>
							<th class="text-left px-4 py-3">Address</th>
							<th class="text-right px-4 py-3">Balance</th>
							<th class="text-right px-4 py-3">NFTs</th>
						</tr>
					</thead>
					<tbody>
						{#each data.holders as holder, i (holder.address)}
							<tr class="border-b border-slate-100 dark:border-slate-800/50">
								<td class="px-4 py-3 font-mono text-xs truncate max-w-xs">
									<span class="text-slate-400 mr-2">{i + 1}.</span>{holder.address}
								</td>
								<td class="px-4 py-3 text-right font-mono">
									{humanizeNumericSupply(holder.balance, token.decimals)}
								</td>
								<td class="px-4 py-3 text-right">{holder.nftCount}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	<div class="text-sm">
		<a href="/" class="text-violet-600 hover:underline">← All tokens</a>
	</div>
</main>
