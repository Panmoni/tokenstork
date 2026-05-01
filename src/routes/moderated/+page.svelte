<script lang="ts">
	import { REPORT_REASON_LABELS, type ReportReason } from '$lib/moderation';

	let { data } = $props();

	const fmt = (n: number) => n.toLocaleString('en-US');
	const totalIconBlocked = $derived(
		data.iconStats
			? data.iconStats.blockedAdult +
				data.iconStats.blockedOversize +
				data.iconStats.blockedUnsupported +
				data.iconStats.blockedCsam
			: 0
	);

	const fmtDate = (unix: number): string => {
		const d = new Date(unix * 1000);
		return d.toISOString().slice(0, 10); // YYYY-MM-DD
	};

	const shortId = (id: string): string => `${id.slice(0, 8)}…${id.slice(-8)}`;

	// Reason → tailwind classes for the pill. Kept in one place so adding
	// a new reason in $lib/moderation only needs a single entry here.
	const reasonClasses: Record<ReportReason, string> = {
		spam: 'bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200',
		phishing: 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300',
		offensive: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
		fraud: 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300',
		illegal: 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300',
		other: 'bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200'
	};
</script>

<svelte:head>
	<title>Moderated tokens — Token Stork</title>
	<meta
		name="description"
		content="Public list of CashTokens hidden from the Token Stork directory, with the reason and date for each."
	/>
	<!-- This page exists for transparency, not discovery. Keep it out of
	     search results so the moderated category IDs don't get re-promoted
	     by the very list that documents their removal. -->
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<div class="mb-8">
		<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent">
			Moderated tokens
		</h1>
		<p class="text-slate-600 dark:text-zinc-300 mt-2 max-w-3xl">
			These categories are hidden from the directory, the public API, and the stats counters.
			Direct URLs return <span class="font-mono text-xs">410 Gone</span>. We list them here so you
			can see what we filter and why. To report a token, use the report link on its detail page.
		</p>
	</div>

	{#if data.iconStats && data.iconStats.totalUrls > 0}
		<!--
			Image-safety transparency card. Counts are per UNIQUE IMAGE HASH
			(issuers reuse icons across categories). The bigger
			"tokensWithClearedIcon" footer shows the per-token rollup.
			Deliberately does NOT list individual blocked icons — the goal is
			a summary, not a directory of removed content.
		-->
		<section id="image-safety" class="mb-8 scroll-mt-20">
			<h2 class="text-2xl font-bold text-slate-900 dark:text-white">Image safety</h2>
			<p class="text-slate-600 dark:text-zinc-300 mt-2 mb-4 max-w-3xl text-sm">
				Every token icon is fetched, hashed, and scanned before it's served. We block adult
				content and CSAM (the latter via Cloudflare's edge-resident NCMEC/IWF hash matcher),
				reject oversize files (&gt; 2 MiB) and non-raster formats (SVG, AVIF, ICO, …), and route
				borderline scores to an operator review queue. Cleared icons are transcoded to static
				WebP and served from our origin — never hot-linked from issuer-controlled URLs. See the
				<a href="/faq#faq-icons" class="text-violet-600 dark:text-violet-400 hover:underline"
					>FAQ entry</a
				> for the full pipeline.
			</p>
			<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
				<div class="p-4 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
					<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-zinc-300">Cleared</div>
					<div class="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
						{fmt(data.iconStats.cleared)}
					</div>
					<div class="text-xs text-slate-500 dark:text-zinc-300 mt-1">unique images on disk</div>
				</div>
				<div class="p-4 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
					<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-zinc-300">Blocked: adult</div>
					<div class="text-2xl font-bold text-rose-600 dark:text-rose-400">
						{fmt(data.iconStats.blockedAdult)}
					</div>
					<div class="text-xs text-slate-500 dark:text-zinc-300 mt-1">NSFW score &ge; 0.9</div>
				</div>
				<div class="p-4 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
					<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-zinc-300">Blocked: CSAM</div>
					<div class="text-2xl font-bold text-rose-600 dark:text-rose-400">
						{fmt(data.iconStats.blockedCsam)}
					</div>
					<div class="text-xs text-slate-500 dark:text-zinc-300 mt-1">edge-detected by Cloudflare</div>
				</div>
				<div class="p-4 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
					<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-zinc-300">Blocked: oversize</div>
					<div class="text-2xl font-bold text-amber-600 dark:text-amber-400">
						{fmt(data.iconStats.blockedOversize)}
					</div>
					<div class="text-xs text-slate-500 dark:text-zinc-300 mt-1">over 2 MiB cap</div>
				</div>
				<div class="p-4 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
					<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-zinc-300">Blocked: format</div>
					<div class="text-2xl font-bold text-amber-600 dark:text-amber-400">
						{fmt(data.iconStats.blockedUnsupported)}
					</div>
					<div class="text-xs text-slate-500 dark:text-zinc-300 mt-1">SVG / AVIF / ICO / corrupt</div>
				</div>
				<div class="p-4 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
					<div class="text-xs uppercase tracking-wider text-slate-500 dark:text-zinc-300">In review</div>
					<div class="text-2xl font-bold text-violet-600 dark:text-violet-400">
						{fmt(data.iconStats.review)}
					</div>
					<div class="text-xs text-slate-500 dark:text-zinc-300 mt-1">awaiting operator decision</div>
				</div>
			</div>
			<p class="text-xs text-slate-500 dark:text-zinc-300 mt-3">
				{fmt(data.iconStats.tokensWithClearedIcon)} tokens render a real WebP in the directory
				today; {fmt(totalIconBlocked)} unique images blocked total ({fmt(
					data.iconStats.pendingUrls
				)} URLs still pending fetch / retry).
			</p>
		</section>
	{/if}

	{#if data.error}
		<div class="text-center py-12">
			<div class="text-red-500 text-lg mb-2">{data.error}</div>
			<div class="text-slate-500 dark:text-zinc-300">Please try again in a moment.</div>
		</div>
	{:else if data.rows.length === 0}
		<div class="p-8 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-center">
			<div class="text-lg text-slate-700 dark:text-zinc-200">No tokens are currently moderated.</div>
			<div class="mt-1 text-sm text-slate-500 dark:text-zinc-300">
				Spot something that should be? Use the report link on any token detail page.
			</div>
		</div>
	{:else}
		<p class="text-sm text-slate-500 dark:text-zinc-300 mb-3">
			{fmt(data.rows.length)} {data.rows.length === 1 ? 'token' : 'tokens'} hidden, newest first.
		</p>
		<div class="overflow-x-auto rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
			<table class="min-w-full text-sm">
				<thead class="bg-slate-50 dark:bg-zinc-900/60 text-xs uppercase tracking-wider text-slate-500 dark:text-zinc-300">
					<tr>
						<th class="text-left font-medium px-4 py-3">Name</th>
						<th class="text-left font-medium px-4 py-3">Symbol</th>
						<th class="text-left font-medium px-4 py-3">Type</th>
						<th class="text-left font-medium px-4 py-3">Reason</th>
						<th class="text-left font-medium px-4 py-3">Hidden</th>
						<th class="text-left font-medium px-4 py-3">Category ID</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-200 dark:divide-zinc-800">
					{#each data.rows as row (row.id)}
						<tr>
							<td class="px-4 py-3 text-slate-900 dark:text-zinc-100">
								{row.name ?? '—'}
							</td>
							<td class="px-4 py-3 font-mono text-xs text-slate-700 dark:text-zinc-200">
								{row.symbol ?? '—'}
							</td>
							<td class="px-4 py-3 text-xs text-slate-500 dark:text-zinc-300">
								{row.tokenType}
							</td>
							<td class="px-4 py-3">
								<span class="px-2 py-0.5 rounded text-xs font-medium {reasonClasses[row.reason]}">
									{REPORT_REASON_LABELS[row.reason]}
								</span>
							</td>
							<td class="px-4 py-3 font-mono text-xs text-slate-500 dark:text-zinc-300">
								{fmtDate(row.hiddenAt)}
							</td>
							<td class="px-4 py-3 font-mono text-xs text-slate-500 dark:text-zinc-300" title={row.id}>
								{shortId(row.id)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</main>
