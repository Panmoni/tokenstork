<script lang="ts">
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';

	// Pre-curated landing spots. Beats a generic "go home" link — most 404s
	// are mistyped category hexes or stale links to features we've moved.
	// Surfacing the directory + the high-traffic inner pages catches
	// almost every "oh that's where I meant to be" case. `href` stays
	// canonical; it's localized at render via localizeHref.
	const suggestions = $derived([
		{ href: '/', label: m.error_sug_tokens_label(), kind: m.error_sug_tokens_kind() },
		{ href: '/arbitrage', label: m.error_sug_arbitrage_label(), kind: m.error_sug_arbitrage_kind() },
		{ href: '/blocks', label: m.error_sug_blocks_label(), kind: m.error_sug_blocks_kind() },
		{ href: '/stats', label: m.error_sug_stats_label(), kind: m.error_sug_stats_kind() },
		{ href: '/learn', label: m.error_sug_learn_label(), kind: m.error_sug_learn_kind() },
		{ href: '/faq', label: m.error_sug_faq_label(), kind: m.error_sug_faq_kind() }
	]);

	const headline = $derived(
		page.status === 404
			? m.error_404_headline()
			: page.status === 410
				? m.error_410_headline()
				: page.status >= 500
					? m.error_500_headline()
					: m.error_generic_headline()
	);

	const subline = $derived(
		page.status === 404
			? m.error_404_subline()
			: page.status === 410
				? m.error_410_subline()
				: page.status >= 500
					? m.error_500_subline()
					: m.error_generic_subline()
	);
</script>

<svelte:head>
	<title>{page.status} — Token Stork</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
	<p class="text-sm text-violet-600 dark:text-violet-400 font-mono uppercase tracking-wider mb-3">
		{m.error_label()} {page.status}
	</p>
	<h1 class="text-4xl sm:text-5xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent mb-4">
		{headline}
	</h1>
	<p class="mb-6 max-w-2xl ts-text-strong">
		{subline}
	</p>

	{#if page.error?.message && page.error.message !== headline}
		<pre class="text-xs font-mono bg-slate-100 dark:bg-zinc-900 border rounded-lg px-3 py-2 mb-8 overflow-x-auto ts-text-faint ts-border-subtle">{page.error.message}</pre>
	{/if}

	<div class="mb-8">
		<h2 class="text-xs uppercase tracking-wider mb-3 font-semibold ts-text-muted">
			{m.error_try_one()}
		</h2>
		<ul class="grid sm:grid-cols-2 gap-2">
			{#each suggestions as s (s.href)}
				<li>
					<a
						href={localizeHref(s.href)}
						class="block p-3 rounded-lg border hover:border-violet-400 dark:hover:border-violet-600 hover:bg-violet-50/40 dark:hover:bg-violet-950/20 transition-colors no-underline ts-border-subtle"
					>
						<div class="font-semibold text-slate-900 dark:text-white">{s.label}</div>
						<div class="text-xs mt-0.5 ts-text-muted">{s.kind}</div>
					</a>
				</li>
			{/each}
		</ul>
	</div>

	{#if page.status === 410}
		<p class="text-sm ts-text-muted">
			{m.error_410_footer_before()} <a href={localizeHref('/moderated')} class="text-violet-600 dark:text-violet-400 hover:underline">/moderated</a>
			{m.error_410_footer_after()}
		</p>
	{/if}
</main>
