<script lang="ts">
	import { getIPFSUrl, humanizeNumericSupply, formatMarketCap } from '$lib/format';
	import {
		REPORT_REASONS,
		REPORT_REASON_LABELS,
		type ReportReason
	} from '$lib/moderation';
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

	// Report form — closed by default; opens inline on click. No modal, no
	// extra deps. URL is the source of truth elsewhere; here the form is
	// purely local state so it doesn't survive navigation.
	let showReport = $state(false);
	let reportReason = $state<ReportReason>('offensive');
	let reportDetails = $state('');
	let reportEmail = $state('');
	let reportStatus = $state<'idle' | 'submitting' | 'ok' | 'ratelimited' | 'error'>('idle');

	async function submitReport(e: SubmitEvent) {
		e.preventDefault();
		if (reportStatus === 'submitting' || reportStatus === 'ok') return;
		reportStatus = 'submitting';
		try {
			const res = await fetch(`/api/tokens/${token.id}/report`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					reason: reportReason,
					details: reportDetails.trim() || undefined,
					reporter_email: reportEmail.trim() || undefined
				})
			});
			if (res.status === 204) {
				reportStatus = 'ok';
			} else if (res.status === 429) {
				reportStatus = 'ratelimited';
			} else {
				reportStatus = 'error';
			}
		} catch {
			reportStatus = 'error';
		}
	}
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

	<div class="flex items-center justify-between text-sm mt-8 pt-6 border-t border-slate-100 dark:border-slate-800">
		<a href="/" class="text-violet-600 hover:underline">← All tokens</a>
		{#if !showReport && reportStatus !== 'ok'}
			<button
				type="button"
				onclick={() => (showReport = true)}
				class="text-xs text-slate-500 hover:text-violet-600 dark:text-slate-400 dark:hover:text-violet-400"
			>
				Report this token
			</button>
		{/if}
	</div>

	{#if showReport || reportStatus === 'ok'}
		<section
			class="mt-6 p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30"
			aria-label="Report this token"
		>
			{#if reportStatus === 'ok'}
				<h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-2">
					Thanks — we'll review it.
				</h2>
				<p class="text-sm text-slate-600 dark:text-slate-400">
					Your report has been recorded. The operator will triage it shortly.
				</p>
			{:else}
				<h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-1">
					Report this token
				</h2>
				<p class="text-xs text-slate-500 dark:text-slate-400 mb-4">
					Flag content you believe violates good-faith use of the directory.
					Your report is anonymous by default; leave an email only if you'd
					like a follow-up.
				</p>
				<form onsubmit={submitReport} class="space-y-3">
					<div>
						<label for="report-reason" class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
							Reason
						</label>
						<select
							id="report-reason"
							bind:value={reportReason}
							disabled={reportStatus === 'submitting'}
							class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
						>
							{#each REPORT_REASONS as r (r)}
								<option value={r}>{REPORT_REASON_LABELS[r]}</option>
							{/each}
						</select>
					</div>
					<div>
						<label for="report-details" class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
							Details <span class="text-slate-400 font-normal">(optional)</span>
						</label>
						<textarea
							id="report-details"
							bind:value={reportDetails}
							disabled={reportStatus === 'submitting'}
							maxlength={2000}
							rows={4}
							placeholder="Why is this token problematic? Any context you can share helps us triage."
							class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-y"
						></textarea>
					</div>
					<div>
						<label for="report-email" class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
							Your email <span class="text-slate-400 font-normal">(optional; for follow-up only)</span>
						</label>
						<input
							id="report-email"
							type="email"
							bind:value={reportEmail}
							disabled={reportStatus === 'submitting'}
							maxlength={200}
							placeholder="you@example.com"
							class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
						/>
					</div>
					{#if reportStatus === 'ratelimited'}
						<p class="text-sm text-amber-600 dark:text-amber-400">
							You've submitted several reports recently. Please wait a bit before sending another.
						</p>
					{:else if reportStatus === 'error'}
						<p class="text-sm text-red-600 dark:text-red-400">
							Couldn't submit right now. Please try again in a moment.
						</p>
					{/if}
					<div class="flex items-center gap-3 pt-1">
						<button
							type="submit"
							disabled={reportStatus === 'submitting'}
							class="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
						>
							{reportStatus === 'submitting' ? 'Sending…' : 'Submit report'}
						</button>
						<button
							type="button"
							onclick={() => {
								showReport = false;
								reportStatus = 'idle';
							}}
							disabled={reportStatus === 'submitting'}
							class="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 disabled:opacity-50"
						>
							Cancel
						</button>
					</div>
				</form>
			{/if}
		</section>
	{/if}
</main>
