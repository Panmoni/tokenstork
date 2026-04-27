<script lang="ts">
	import { humanizeNumericSupply, formatMarketCap, stripEmoji } from '$lib/format';
	import { iconHrefFor } from '$lib/icons';
	import {
		REPORT_REASONS,
		REPORT_REASON_LABELS,
		type ReportReason
	} from '$lib/moderation';
	import FormatCategory from '$lib/components/FormatCategory.svelte';
	import PriceChart from '$lib/components/PriceChart.svelte';
	import StarButton from '$lib/components/StarButton.svelte';

	let { data } = $props();

	// Well-known BCMR URI keys → inline SVG icons. Paths copied from the
	// Footer's social-icon block so the brand marks stay consistent
	// across the site. Anything not listed here renders with the generic
	// link icon + the key name as a label.
	type IconSpec = { viewBox: string; paths: string[]; label: string };
	const URI_ICONS: Record<string, IconSpec> = {
		web: {
			viewBox: '0 0 24 24',
			label: 'Website',
			paths: [
				'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
				'M3.6 9h16.8',
				'M3.6 15h16.8',
				'M11.5 3a17 17 0 0 0 0 18',
				'M12.5 3a17 17 0 0 1 0 18'
			]
		},
		x: {
			viewBox: '0 0 1200 1227',
			label: 'X (Twitter)',
			paths: [
				'M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.826Z'
			]
		},
		twitter: {
			viewBox: '0 0 1200 1227',
			label: 'Twitter',
			paths: [
				'M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.826Z'
			]
		},
		github: {
			viewBox: '0 0 24 24',
			label: 'GitHub',
			paths: [
				'M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z'
			]
		},
		telegram: {
			viewBox: '0 0 32 32',
			label: 'Telegram',
			paths: [
				'M22.122 10.040c0.006-0 0.014-0 0.022-0 0.209 0 0.403 0.065 0.562 0.177l-0.003-0.002c0.116 0.101 0.194 0.243 0.213 0.403l0 0.003c0.020 0.122 0.031 0.262 0.031 0.405 0 0.065-0.002 0.129-0.007 0.193l0-0.009c-0.225 2.369-1.201 8.114-1.697 10.766-0.21 1.123-0.623 1.499-1.023 1.535-0.869 0.081-1.529-0.574-2.371-1.126-1.318-0.865-2.063-1.403-3.342-2.246-1.479-0.973-0.52-1.51 0.322-2.384 0.221-0.23 4.052-3.715 4.127-4.031 0.004-0.019 0.006-0.040 0.006-0.062 0-0.078-0.029-0.149-0.076-0.203l0 0c-0.052-0.034-0.117-0.053-0.185-0.053-0.045 0-0.088 0.009-0.128 0.024l0.002-0.001q-0.198 0.045-6.316 4.174c-0.445 0.351-1.007 0.573-1.619 0.599l-0.006 0c-0.867-0.105-1.654-0.298-2.401-0.573l0.074 0.024c-0.938-0.306-1.683-0.467-1.619-0.985q0.051-0.404 1.114-0.827 6.548-2.853 8.733-3.761c1.607-0.853 3.47-1.555 5.429-2.010l0.157-0.031zM15.93 1.025c-8.302 0.020-15.025 6.755-15.025 15.060 0 8.317 6.742 15.060 15.060 15.060s15.060-6.742 15.060-15.060c0-8.305-6.723-15.040-15.023-15.060h-0.002q-0.035-0 -0.070 0z'
			]
		},
		reddit: {
			viewBox: '0 0 24 24',
			label: 'Reddit',
			paths: [
				'M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12ZM18.4065 11.2154C18.5682 11.446 18.6597 11.7185 18.67 12C18.6743 12.2755 18.6005 12.5467 18.4571 12.782C18.3138 13.0174 18.1068 13.2073 17.86 13.33C17.8713 13.4765 17.8713 13.6236 17.86 13.77C17.86 16.01 15.25 17.83 12.03 17.83C8.80999 17.83 6.19999 16.01 6.19999 13.77C6.18873 13.6236 6.18873 13.4765 6.19999 13.33C6.00765 13.2416 5.83683 13.1125 5.69935 12.9515C5.56188 12.7906 5.46105 12.6017 5.40384 12.3979C5.34664 12.1941 5.33443 11.9803 5.36807 11.7713C5.4017 11.5623 5.48038 11.3632 5.59864 11.1876C5.71689 11.0121 5.87191 10.8643 6.05294 10.7546C6.23397 10.645 6.43669 10.5759 6.64705 10.5524C6.8574 10.5288 7.07036 10.5513 7.27117 10.6182C7.47198 10.6852 7.65583 10.795 7.80999 10.94C8.96227 10.1585 10.3179 9.73099 11.71 9.71L12.45 6.24C12.4583 6.19983 12.4745 6.16171 12.4977 6.12784C12.5208 6.09398 12.5505 6.06505 12.5849 6.04272C12.6193 6.0204 12.6578 6.00513 12.6981 5.99779C12.7385 5.99046 12.7799 5.99121 12.82 6L15.27 6.49C15.3896 6.28444 15.5786 6.12825 15.8031 6.04948C16.0275 5.9707 16.2726 5.9745 16.4945 6.06019C16.7164 6.14587 16.9005 6.30784 17.0137 6.51701C17.1269 6.72617 17.1619 6.96885 17.1123 7.20147C17.0627 7.4341 16.9319 7.64143 16.7432 7.78627C16.5545 7.9311 16.3204 8.00394 16.0829 7.99172C15.8453 7.9795 15.6199 7.88301 15.4471 7.71958C15.2743 7.55615 15.1654 7.33648 15.14 7.1L13 6.65L12.35 9.77C13.7252 9.7995 15.0624 10.2267 16.2 11C16.4032 10.805 16.6585 10.6729 16.9351 10.6196C17.2117 10.5664 17.4978 10.5943 17.7589 10.7C18.0199 10.8057 18.2449 10.9847 18.4065 11.2154Z'
			]
		},
		youtube: {
			viewBox: '0 0 512 512',
			label: 'YouTube',
			paths: [
				'M508.64,148.79c0-45-33.1-81.2-74-81.2C379.24,65,322.74,64,265,64H247c-57.6,0-114.2,1-169.6,3.6-40.8,0-73.9,36.4-73.9,81.4C1,184.59-.06,220.19,0,255.79q-.15,53.4,3.4,106.9c0,45,33.1,81.5,73.9,81.5,58.2,2.7,117.9,3.9,178.6,3.8q91.2.3,178.6-3.8c40.9,0,74-36.5,74-81.5,2.4-35.7,3.5-71.3,3.4-107Q512.24,202.29,508.64,148.79ZM207,353.89V157.39l145,98.2Z'
			]
		},
		instagram: {
			viewBox: '0 0 24 24',
			label: 'Instagram',
			paths: [
				'M12.315 2c2.43 0 2.784.013 3.808.06 1.064.049 1.791.218 2.427.465a4.902 4.902 0 011.772 1.153 4.902 4.902 0 011.153 1.772c.247.636.416 1.363.465 2.427.048 1.067.06 1.407.06 4.123v.08c0 2.643-.012 2.987-.06 4.043-.049 1.064-.218 1.791-.465 2.427a4.902 4.902 0 01-1.153 1.772 4.902 4.902 0 01-1.772 1.153c-.636.247-1.363.416-2.427.465-1.067.048-1.407.06-4.123.06h-.08c-2.643 0-2.987-.012-4.043-.06-1.064-.049-1.791-.218-2.427-.465a4.902 4.902 0 01-1.772-1.153 4.902 4.902 0 01-1.153-1.772c-.247-.636-.416-1.363-.465-2.427-.047-1.024-.06-1.379-.06-3.808v-.63c0-2.43.013-2.784.06-3.808.049-1.064.218-1.791.465-2.427a4.902 4.902 0 011.153-1.772A4.902 4.902 0 015.45 2.525c.636-.247 1.363-.416 2.427-.465C8.901 2.013 9.256 2 11.685 2h.63zm-.081 1.802h-.468c-2.456 0-2.784.011-3.807.058-.975.045-1.504.207-1.857.344-.467.182-.8.398-1.15.748-.35.35-.566.683-.748 1.15-.137.353-.3.882-.344 1.857-.047 1.023-.058 1.351-.058 3.807v.468c0 2.456.011 2.784.058 3.807.045.975.207 1.504.344 1.857.182.466.399.8.748 1.15.35.35.683.566 1.15.748.353.137.882.3 1.857.344 1.054.048 1.37.058 4.041.058h.08c2.597 0 2.917-.01 3.96-.058.976-.045 1.505-.207 1.858-.344.466-.182.8-.398 1.15-.748.35-.35.566-.683.748-1.15.137-.353.3-.882.344-1.857.048-1.055.058-1.37.058-4.041v-.08c0-2.597-.01-2.917-.058-3.96-.045-.976-.207-1.505-.344-1.858a3.097 3.097 0 00-.748-1.15 3.098 3.098 0 00-1.15-.748c-.353-.137-.882-.3-1.857-.344-1.023-.047-1.351-.058-3.807-.058zM12 6.865a5.135 5.135 0 110 10.27 5.135 5.135 0 010-10.27zm0 1.802a3.333 3.333 0 100 6.666 3.333 3.333 0 000-6.666zm5.338-3.205a1.2 1.2 0 110 2.4 1.2 1.2 0 010-2.4z'
			]
		}
	};

	// Generic "link" icon used for BCMR URI keys we don't have a brand
	// mark for (wiki, paper, chat, forum, tiktok, discord, linkedin, …).
	const GENERIC_LINK_ICON: IconSpec = {
		viewBox: '0 0 24 24',
		label: 'Link',
		paths: [
			'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
			'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'
		]
	};

	// Map a BCMR URI key to its icon + a human label. Case-insensitive
	// match. "icon" and "image" are suppressed entirely — the token's
	// hero image already uses them.
	function uriSpec(key: string): IconSpec | null {
		const k = key.toLowerCase();
		if (k === 'icon' || k === 'image') return null;
		return URI_ICONS[k] ?? { ...GENERIC_LINK_ICON, label: key };
	}

	// Only render URIs whose scheme is in the safelist. Same pattern the
	// previous BCMR section used; prevents `javascript:` / `data:` / `file:`
	// from being rendered as clickable.
	function safeUri(v: string): boolean {
		return /^(https?|ipfs|mailto):/i.test(v);
	}

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
	<title>{stripEmoji(token.name) || token.id.slice(0, 10)} — Token Stork</title>
	{#if token.description}
		<meta name="description" content={stripEmoji(token.description).slice(0, 160)} />
	{/if}
</svelte:head>

<main class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<div class="flex items-start gap-4 mb-6">
		<img src={iconHrefFor(token.icon, token.iconClearedHash)} alt={token.name ?? ''} class="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800" />
		<div class="flex-1 min-w-0">
			<h1 class="text-3xl font-bold text-slate-900 dark:text-white truncate flex items-center gap-2">
				<StarButton categoryHex={token.id} size="md" />
				<span class="truncate">
					{stripEmoji(token.name) || '—'}
					{#if token.symbol}<span class="ml-3 text-lg text-slate-500 font-mono font-normal">{stripEmoji(token.symbol)}</span>{/if}
				</span>
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
		<p class="text-slate-600 dark:text-slate-300 mb-6">{stripEmoji(token.description)}</p>
	{/if}

	<!--
		Compact BCMR info bar right under the description. Icon-first row
		for URIs (Web / X / GitHub / Telegram / …) + status pill + tags +
		splitId link. Heavy technical bits (NFT types JSON, extensions
		JSON) stay in the lower "BCMR technical" section so this strip
		stays glanceable.
	-->
	{#if data.bcmr}
		{@const bcmr = data.bcmr}
		{@const uriEntries = bcmr.uris
			? Object.entries(bcmr.uris).filter(([k, v]) => uriSpec(k) !== null && safeUri(v))
			: []}
		{@const hasCompact =
			bcmr.status ||
			bcmr.splitId ||
			uriEntries.length > 0 ||
			(bcmr.tags && bcmr.tags.length > 0)}
		{#if hasCompact}
			<div class="mb-8 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center gap-x-5 gap-y-3">
				{#if uriEntries.length > 0}
					<div class="flex flex-wrap items-center gap-2">
						{#each uriEntries as [key, value] (key)}
							{@const spec = uriSpec(key)}
							{#if spec}
								<a
									href={value}
									target="_blank"
									rel="noopener noreferrer"
									class="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 hover:bg-violet-100 dark:bg-slate-800 dark:hover:bg-violet-900/30 text-slate-600 hover:text-violet-700 dark:text-slate-300 dark:hover:text-violet-300 transition-colors"
									title={`${spec.label}: ${value}`}
									aria-label={spec.label}
								>
									<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox={spec.viewBox} fill="currentColor" stroke="currentColor" stroke-width={spec.viewBox === '0 0 24 24' && (key === 'web' || spec.label === 'Link') ? '2' : '0'} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
										{#each spec.paths as d (d)}
											<path {d} fill={key === 'web' || spec.label === 'Link' ? 'none' : 'currentColor'} />
										{/each}
									</svg>
								</a>
							{/if}
						{/each}
					</div>
				{/if}

				{#if bcmr.tags && bcmr.tags.length > 0}
					<div class="flex flex-wrap gap-1.5">
						{#each bcmr.tags as tag (tag)}
							<span class="px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-xs">
								{tag}
							</span>
						{/each}
					</div>
				{/if}

				{#if bcmr.status}
					<div class="flex items-center gap-1.5 text-xs">
						<span class="text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</span>
						<span class="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium">{bcmr.status}</span>
					</div>
				{/if}

				{#if bcmr.splitId}
					{@const validSplitId = /^[0-9a-f]{64}$/i.test(bcmr.splitId)}
					<div class="flex items-center gap-1.5 text-xs min-w-0">
						<span class="text-slate-500 dark:text-slate-400 uppercase tracking-wider flex-shrink-0">Split from</span>
						{#if validSplitId}
							<a
								href={`/token/${bcmr.splitId.toLowerCase()}`}
								class="font-mono text-violet-600 dark:text-violet-400 hover:underline truncate"
								title={bcmr.splitId}
							>
								{bcmr.splitId.slice(0, 10)}…{bcmr.splitId.slice(-6)}
							</a>
						{:else}
							<span class="font-mono text-slate-500 dark:text-slate-400 truncate" title="Invalid hex splitId — not rendered as link">
								{bcmr.splitId.slice(0, 10)}… <em class="not-italic">(invalid)</em>
							</span>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
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
		{#if marketCapUSD > 0 && data.tvlUSD >= data.mcapTvlThresholdUSD}
			<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 col-span-2 md:col-span-1">
				<div class="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1" title="Hidden for tokens whose Cauldron TVL is below the average TVL of the top half of listed tokens — caps derived from negligible liquidity would skew rankings.">Market cap</div>
				<div class="text-xl font-mono">{formatMarketCap(marketCapUSD.toString())}</div>
			</div>
		{/if}
		<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800">
			<div class="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Genesis block</div>
			<div class="text-xl font-mono">
				<a
					href={`https://explorer.salemkode.com/block/${token.genesisBlock}`}
					target="_blank"
					rel="noopener noreferrer"
					title="View block on SalemKode Explorer"
					class="hover:text-violet-600"
				>
					{token.genesisBlock.toLocaleString()}
				</a>
			</div>
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

	{#if data.priceUSD > 0 || data.fexPriceUSD > 0}
		<!--
			Venue comparison. Renders only when at least one AMM has data;
			always shows both columns (Cauldron + Fex) when either fires so
			the visual is symmetrical and the user can spot the absent venue
			at a glance. Spread % shown on the cheaper side — the arb-
			visibility surface the plan calls out.
		-->
		{@const cauldronPx = data.priceUSD}
		{@const fexPx = data.fexPriceUSD}
		{@const bothPresent = cauldronPx > 0 && fexPx > 0}
		{@const spreadPct =
			bothPresent && Math.min(cauldronPx, fexPx) > 0
				? ((Math.max(cauldronPx, fexPx) - Math.min(cauldronPx, fexPx)) /
						Math.min(cauldronPx, fexPx)) *
					100
				: null}
		<section class="mb-8">
			<h2 class="text-xl font-bold text-slate-900 dark:text-white mb-3">AMM venues</h2>
			<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
				<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 {cauldronPx > 0 ? '' : 'opacity-60'}">
					<div class="flex items-center justify-between mb-2">
						<div class="flex items-center gap-2">
							<img src="/cauldron-logo.png" alt="" class="h-5 w-5 rounded-full bg-slate-900 p-0.5" />
							<span class="font-semibold">Cauldron</span>
						</div>
						<div class="flex items-center gap-2">
							{#if bothPresent && spreadPct != null && cauldronPx < fexPx}
								<span class="text-xs px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300" title="Cheaper side — Cauldron's price is {spreadPct.toFixed(2)}% below Fex">−{spreadPct.toFixed(2)}%</span>
							{/if}
							{#if cauldronPx > 0}
								<a
									href={`https://app.cauldron.quest/swap/${token.id}`}
									target="_blank"
									rel="noopener noreferrer"
									class="text-xs text-violet-600 hover:underline"
								>
									View on Cauldron →
								</a>
							{/if}
						</div>
					</div>
					<div class="grid grid-cols-2 gap-2 text-sm">
						<div>
							<div class="text-xs text-slate-500 mb-1">Price</div>
							<div class="font-mono">{cauldronPx > 0 ? (cauldronPx >= 1 ? `$${cauldronPx.toFixed(2)}` : `$${cauldronPx.toFixed(6)}`) : '—'}</div>
						</div>
						<div>
							<div class="text-xs text-slate-500 mb-1">TVL</div>
							<div class="font-mono">{data.tvlUSD > 0 ? formatMarketCap(data.tvlUSD.toString()) : '—'}</div>
						</div>
					</div>
				</div>
				<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 {fexPx > 0 ? '' : 'opacity-60'}">
					<div class="flex items-center justify-between mb-2">
						<div class="flex items-center gap-2">
							<img src="/fex-logo.png" alt="" class="h-5 w-5 rounded-full" />
							<span class="font-semibold">Fex.cash</span>
						</div>
						{#if bothPresent && spreadPct != null && fexPx < cauldronPx}
							<span class="text-xs px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300" title="Cheaper side — Fex's price is {spreadPct.toFixed(2)}% below Cauldron">−{spreadPct.toFixed(2)}%</span>
						{/if}
					</div>
					<div class="grid grid-cols-2 gap-2 text-sm">
						<div>
							<div class="text-xs text-slate-500 mb-1">Price</div>
							<div class="font-mono">{fexPx > 0 ? (fexPx >= 1 ? `$${fexPx.toFixed(2)}` : `$${fexPx.toFixed(6)}`) : '—'}</div>
						</div>
						<div>
							<div class="text-xs text-slate-500 mb-1">TVL</div>
							<div class="font-mono">{data.fexTvlUSD > 0 ? formatMarketCap(data.fexTvlUSD.toString()) : '—'}</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	{/if}

	<!--
		Price + volume chart. Data comes from `token_price_history`,
		bucketed server-side per the active range. URL-driven range
		toggles below the chart let the user widen/narrow without
		page state — `?range=24h|7d|30d|90d|1y|all` is bookmarkable.
	-->
	<section class="mb-8" id="chart">
		<div class="flex items-baseline justify-between mb-3 flex-wrap gap-y-2">
			<h2 class="text-xl font-bold text-slate-900 dark:text-white">
				Price &amp; volume
				<span class="ml-2 text-sm font-normal text-slate-500">Cauldron · {data.priceChart.rangeLabel}</span>
			</h2>
			<div class="flex flex-wrap gap-1 text-xs">
				{#each [
					{ key: '24h', label: '24h' },
					{ key: '7d',  label: '7d' },
					{ key: '30d', label: '30d' },
					{ key: '90d', label: '90d' },
					{ key: '1y',  label: '1y' },
					{ key: 'all', label: 'All' }
				] as r (r.key)}
					{@const active = data.priceChart.range === r.key}
					<a
						href={`?range=${r.key}#chart`}
						class={`px-2.5 py-1 rounded-md font-medium transition-colors ${
							active
								? 'bg-violet-600 text-white'
								: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
						}`}
						aria-current={active ? 'page' : undefined}
					>
						{r.label}
					</a>
				{/each}
			</div>
		</div>
		<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<PriceChart
				buckets={data.priceChart.buckets}
				decimals={data.token.decimals}
				bchPriceUSD={data.bchPriceUSD}
				rangeLabel={data.priceChart.rangeLabel}
			/>
		</div>
		<p class="mt-2 text-xs text-slate-500 dark:text-slate-400">
			Volume is a lower-bound estimate from |TVL deltas| between consecutive snapshots —
			within-bucket round-trip activity isn't visible at our 4 h sync cadence (10 min fast-pass
			for already-listed tokens). Price is the per-bucket mean.
		</p>
	</section>

	{#if data.tapswapOffers.length > 0}
		<section class="mb-8">
			<div class="flex items-baseline justify-between mb-4">
				<h2 class="text-xl font-bold text-slate-900 dark:text-white">
					Open listings on Tapswap (P2P)
					<span class="ml-2 text-sm font-normal text-slate-500">{data.tapswapOffers.length}</span>
				</h2>
				<a
					href={`https://tapswap.cash/trade/${token.id}`}
					target="_blank"
					rel="noopener noreferrer"
					class="text-sm text-violet-600 hover:underline"
				>
					View on Tapswap →
				</a>
			</div>
			<div class="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
				<table class="w-full text-sm">
					<thead class="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
						<tr>
							<th class="text-left px-4 py-3">Offering</th>
							<th class="text-right px-4 py-3">Asking</th>
							<th class="text-right px-4 py-3">USD</th>
							<th class="text-left px-4 py-3">Maker</th>
						</tr>
					</thead>
					<tbody>
						{#each data.tapswapOffers as offer (offer.id)}
							{@const wantSatsNum = Number(offer.wantSats)}
							{@const wantBch = Number.isFinite(wantSatsNum) ? wantSatsNum / 1e8 : 0}
							{@const wantUsd = wantBch * (data.bchPriceUSD ?? 0)}
							<tr class="border-b border-slate-100 dark:border-slate-800/50">
								<td class="px-4 py-3 font-mono text-xs">
									{#if offer.hasCommitment}
										NFT <span class="text-slate-500">{offer.hasCommitment.slice(0, 16)}…</span>
									{:else if offer.hasAmount}
										{humanizeNumericSupply(offer.hasAmount, token.decimals)}
										{#if token.symbol}<span class="text-slate-500 ml-1">{stripEmoji(token.symbol)}</span>{/if}
									{:else}
										—
									{/if}
								</td>
								<td class="px-4 py-3 text-right font-mono">
									{#if wantBch >= 0.01}
										{wantBch.toFixed(4)} BCH
									{:else}
										{wantSatsNum.toLocaleString()} sats
									{/if}
								</td>
								<td class="px-4 py-3 text-right font-mono text-slate-700 dark:text-slate-300">
									{wantUsd > 0 ? `$${wantUsd < 1 ? wantUsd.toFixed(4) : wantUsd.toFixed(2)}` : '—'}
								</td>
								<td class="px-4 py-3 font-mono text-xs text-slate-500" title="Maker public-key hash (raw bytes; cashaddr rendering deferred)">
									{offer.makerPkhHex.slice(0, 10)}…{offer.makerPkhHex.slice(-6)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="mt-2 text-xs text-slate-500 dark:text-slate-400">
				Listings aggregated from on-chain MPSW OP_RETURNs via our own BCHN —
				not from Tapswap's API. Close events (sale / cancellation) are not
				tracked yet; a stale listing that's already been taken will drop off
				once that enhancement ships.
			</p>
		</section>
	{/if}

	<!--
		BCMR technical bits — NFT types schema + extensions — as collapsible
		JSON dumps. URIs / status / tags / splitId already surface in the
		compact bar near the top; this section is strictly the power-user
		payload and only renders if either dump exists.
	-->
	{#if data.bcmr}
		{@const bcmr = data.bcmr}
		{@const extEntries = bcmr.extensions ? Object.entries(bcmr.extensions) : []}
		{@const nftEntries = bcmr.nftTypes ? Object.entries(bcmr.nftTypes) : []}
		{#if bcmr.nftsDescription || nftEntries.length > 0 || extEntries.length > 0}
			<section class="mb-8">
				<h2 class="text-xl font-bold text-slate-900 dark:text-white mb-4">
					BCMR technical
					<span class="ml-2 text-sm font-normal text-slate-500">NFT schema + extensions</span>
				</h2>
				<div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-800">
					{#if bcmr.nftsDescription || nftEntries.length > 0}
						<div class="p-5">
							<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">NFTs</div>
							{#if bcmr.nftsDescription}
								<p class="text-sm text-slate-700 dark:text-slate-300 mb-3">{bcmr.nftsDescription}</p>
							{/if}
							{#if nftEntries.length > 0}
								<details class="text-sm">
									<summary class="cursor-pointer text-violet-600 dark:text-violet-400 hover:underline select-none">
										{nftEntries.length} NFT type{nftEntries.length === 1 ? '' : 's'} defined — show raw
									</summary>
									<pre class="mt-3 p-3 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono overflow-auto max-h-96">{JSON.stringify(bcmr.nftTypes, null, 2)}</pre>
								</details>
							{/if}
						</div>
					{/if}

					{#if extEntries.length > 0}
						<div class="p-5">
							<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Extensions</div>
							<details class="text-sm">
								<summary class="cursor-pointer text-violet-600 dark:text-violet-400 hover:underline select-none">
									{extEntries.length} extension{extEntries.length === 1 ? '' : 's'} — show raw
								</summary>
								<pre class="mt-3 p-3 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono overflow-auto max-h-96">{JSON.stringify(bcmr.extensions, null, 2)}</pre>
							</details>
						</div>
					{/if}
				</div>
			</section>
		{/if}
	{/if}

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
