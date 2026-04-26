<script lang="ts">
	import { getIPFSUrl, stripEmoji, formatVenuePriceUSD, formatVenueTvlUSD } from '$lib/format';
	import { bchPrice } from '$lib/stores/bchPrice';
	import StarButton from '$lib/components/StarButton.svelte';

	let { data } = $props();

	function fmtRelativeTime(unixSec: number): string {
		const diff = Date.now() / 1000 - unixSec;
		if (diff < 60) return 'just now';
		if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
		if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
		const months = Math.floor(diff / (86400 * 30));
		return `${months}mo ago`;
	}
</script>

<svelte:head>
	<title>Watchlist — Token Stork</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent mb-3">
		Watchlist
	</h1>
	<p class="text-slate-600 dark:text-slate-400 mb-8 max-w-prose">
		Tokens you're tracking, scoped to the BCH wallet you signed in with.
		Click the star on any token in the directory or detail page to add
		or remove.
	</p>

	{#if data.unauthenticated}
		<!-- Sign-in CTA. Designed to be hospitable; no shame in browsing
		     anonymously. -->
		<section class="p-8 rounded-xl border border-violet-200 dark:border-violet-900/50 bg-violet-50/40 dark:bg-violet-950/20 text-center">
			<h2 class="text-xl font-semibold text-slate-900 dark:text-white mb-2">
				Sign in with your BCH wallet to start tracking
			</h2>
			<p class="text-slate-600 dark:text-slate-400 mb-6 max-w-md mx-auto">
				The watchlist is scoped to the wallet address you sign in with — no email, no password,
				no recovery phrase to lose. Cross-device by design: sign in from any browser with the
				same wallet and your watchlist follows.
			</p>
			<a
				href="/login?return=/watchlist"
				class="inline-block px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-medium transition-colors"
			>
				Sign in
			</a>
		</section>
	{:else if data.rows.length === 0}
		<section class="p-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-center">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				class="w-10 h-10 mx-auto mb-3 text-slate-400 dark:text-slate-600"
				aria-hidden="true"
			>
				<path
					stroke-linejoin="round"
					d="M12 2.5l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.42l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95L12 2.5z"
				/>
			</svg>
			<h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-1">
				Nothing tracked yet
			</h2>
			<p class="text-sm text-slate-600 dark:text-slate-400 mb-4 max-w-sm mx-auto">
				Click the star icon next to any token in the
				<a href="/" class="text-violet-600 dark:text-violet-400 hover:underline">directory</a>
				or on a token's detail page to add it here.
			</p>
		</section>
	{:else}
		<div class="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
			<div class="grid grid-cols-[2fr_0.8fr_0.8fr_0.8fr_0.5fr] gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
				<div>Token</div>
				<div class="text-right">Cauldron</div>
				<div class="text-right">Fex</div>
				<div class="text-right">Tapswap</div>
				<div class="text-right">Added</div>
			</div>
			{#each data.rows as r (r.id)}
				<div class="grid grid-cols-[2fr_0.8fr_0.8fr_0.8fr_0.5fr] gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-800 last:border-b-0 items-center hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition-colors">
					<div class="flex items-center gap-2 min-w-0">
						<StarButton categoryHex={r.id} />
						<a href={`/token/${r.id}`} class="flex items-center gap-3 min-w-0 no-underline group flex-1">
							{#if r.icon}
								<img src={getIPFSUrl(r.icon)} alt="" class="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 shrink-0" loading="lazy" />
							{:else}
								<div class="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 shrink-0" aria-hidden="true"></div>
							{/if}
							<div class="min-w-0">
								<div class="font-semibold text-slate-900 dark:text-white truncate group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
									{stripEmoji(r.name) || '—'}
									{#if r.symbol}<span class="ml-2 text-xs text-slate-500 font-mono">{stripEmoji(r.symbol)}</span>{/if}
									<span class="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{r.tokenType}</span>
								</div>
							</div>
						</a>
					</div>
					<div class="text-right font-mono text-sm text-slate-700 dark:text-slate-300">
						{#if r.cauldronPriceSats != null}
							<div>{formatVenuePriceUSD(r.cauldronPriceSats, r.decimals, $bchPrice.bchPrice)}</div>
							<div class="text-xs text-slate-400">{formatVenueTvlUSD(r.cauldronTvlSatoshis, $bchPrice.bchPrice)}</div>
						{:else}
							<span class="text-slate-400">—</span>
						{/if}
					</div>
					<div class="text-right font-mono text-sm text-slate-700 dark:text-slate-300">
						{#if r.fexPriceSats != null}
							<div>{formatVenuePriceUSD(r.fexPriceSats, r.decimals, $bchPrice.bchPrice)}</div>
							<div class="text-xs text-slate-400">{formatVenueTvlUSD(r.fexTvlSatoshis, $bchPrice.bchPrice)}</div>
						{:else}
							<span class="text-slate-400">—</span>
						{/if}
					</div>
					<div class="text-right font-mono text-sm text-slate-700 dark:text-slate-300">
						{#if r.tapswapListingCount > 0}
							<span title="open Tapswap listings">{r.tapswapListingCount}</span>
						{:else}
							<span class="text-slate-400">—</span>
						{/if}
					</div>
					<div class="text-right text-xs text-slate-500 dark:text-slate-400" title={new Date(r.addedAt * 1000).toISOString()}>
						{fmtRelativeTime(r.addedAt)}
					</div>
				</div>
			{/each}
		</div>
		<p class="mt-4 text-xs text-slate-500 dark:text-slate-400">
			Tracking {data.rows.length} {data.rows.length === 1 ? 'token' : 'tokens'}.
		</p>
	{/if}
</main>
