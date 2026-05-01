<script lang="ts">
	import { page } from '$app/state';

	// Pre-curated landing spots. Beats a generic "go home" link — most 404s
	// are mistyped category hexes or stale links to features we've moved.
	// Surfacing the directory + the high-traffic inner pages catches
	// almost every "oh that's where I meant to be" case.
	const suggestions = [
		{ href: '/', label: 'Tokens directory', kind: 'Browse the full CashTokens index' },
		{ href: '/arbitrage', label: 'Arbitrage', kind: 'Cross-venue spreads (Cauldron / Fex / Tapswap)' },
		{ href: '/blocks', label: 'Blocks', kind: 'Per-block chain economics dashboard' },
		{ href: '/stats', label: 'Stats', kind: 'Ecosystem aggregates + venue overlap' },
		{ href: '/learn', label: 'Learn', kind: 'CashTokens primer' },
		{ href: '/faq', label: 'FAQ', kind: 'Common questions about the data' }
	];

	const headline = $derived(
		page.status === 404
			? 'Page not found'
			: page.status === 410
				? 'Token hidden'
				: page.status >= 500
					? 'Something broke on our side'
					: 'Something went wrong'
	);

	const subline = $derived(
		page.status === 404
			? "The URL you tried doesn't match anything on the site. If you pasted a category hex, double-check the 64 characters — one wrong digit is a different token."
			: page.status === 410
				? 'This token category was removed from the directory by moderation. We keep the list of removals public on /moderated for transparency.'
				: page.status >= 500
					? "Something went wrong on our end. We're probably already looking at it; if not, refresh in a minute."
					: 'Unexpected error rendering this page.'
	);
</script>

<svelte:head>
	<title>{page.status} — Token Stork</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
	<p class="text-sm text-violet-600 dark:text-violet-400 font-mono uppercase tracking-wider mb-3">
		Error {page.status}
	</p>
	<h1 class="text-4xl sm:text-5xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent mb-4">
		{headline}
	</h1>
	<p class="text-slate-700 dark:text-zinc-200 mb-6 max-w-2xl">
		{subline}
	</p>

	{#if page.error?.message && page.error.message !== headline}
		<pre class="text-xs font-mono text-slate-500 dark:text-zinc-400 bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-lg px-3 py-2 mb-8 overflow-x-auto">{page.error.message}</pre>
	{/if}

	<div class="mb-8">
		<h2 class="text-xs uppercase tracking-wider text-slate-500 dark:text-zinc-300 mb-3 font-semibold">
			Try one of these
		</h2>
		<ul class="grid sm:grid-cols-2 gap-2">
			{#each suggestions as s (s.href)}
				<li>
					<a
						href={s.href}
						class="block p-3 rounded-lg border border-slate-200 dark:border-zinc-800 hover:border-violet-400 dark:hover:border-violet-600 hover:bg-violet-50/40 dark:hover:bg-violet-950/20 transition-colors no-underline"
					>
						<div class="font-semibold text-slate-900 dark:text-white">{s.label}</div>
						<div class="text-xs text-slate-500 dark:text-zinc-300 mt-0.5">{s.kind}</div>
					</a>
				</li>
			{/each}
		</ul>
	</div>

	{#if page.status === 410}
		<p class="text-sm text-slate-600 dark:text-zinc-300">
			See <a href="/moderated" class="text-violet-600 dark:text-violet-400 hover:underline">/moderated</a>
			for the full list of hidden categories with reason and date.
		</p>
	{/if}
</main>
