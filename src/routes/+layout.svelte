<script lang="ts">
	import '../app.css';
	import { onMount, type Snippet } from 'svelte';
	import { navigating, page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import { locales, baseLocale, getLocale, localizeHref, deLocalizeHref } from '$lib/paraglide/runtime';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import MetricsBar from '$lib/components/MetricsBar.svelte';
	import CTA from '$lib/components/CTA.svelte';
	import { TooltipProvider } from '$lib/components/ui/tooltip';
	import { bchPrice } from '$lib/stores/bchPrice';

	interface Props {
		data: {
			tokensTracked: number;
			tailLastBlock: number | null;
			newIn24h: number;
			totalTvlSats: number;
			listedCount: number;
			tokenTxs24h: number;
		};
		children: Snippet;
	}

	let { data, children }: Props = $props();

	onMount(() => {
		bchPrice.start();
		return () => bchPrice.stop();
	});

	// SEO: canonical + per-locale hreflang alternates. Built from the
	// canonical (de-localized) path so every locale variant of THIS page is
	// advertised, plus an x-default pointing at the base locale. Absolute
	// URLs use the request origin (tokenstork.com in production).
	const canonicalPath = $derived(deLocalizeHref(page.url.pathname));
	const origin = $derived(page.url.origin);
	const canonicalUrl = $derived(origin + localizeHref(canonicalPath, { locale: getLocale() }));
	const alternates = $derived(
		locales.map((locale) => ({
			locale,
			href: origin + localizeHref(canonicalPath, { locale })
		}))
	);
	const xDefaultUrl = $derived(origin + localizeHref(canonicalPath, { locale: baseLocale }));

	// og:locale wants a BCP-47 territory form (en_US). Fall back to the bare
	// locale code for locales without a mapping.
	const OG_LOCALE: Record<string, string> = { en: 'en_US', es: 'es_ES' };
	const ogLocale = $derived(OG_LOCALE[getLocale()] ?? getLocale());
</script>

<svelte:head>
	<title>{m.meta_title()}</title>
	<meta name="description" content={m.meta_description()} />
	<meta name="theme-color" content="#4f359b" />

	<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
	<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
	<link rel="shortcut icon" href="/favicon.ico" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	<link rel="manifest" href="/site.webmanifest" />

	<!-- Canonical + per-locale alternates so search engines index each
	     language variant of this page and serve the right one. -->
	<link rel="canonical" href={canonicalUrl} />
	{#each alternates as alt (alt.locale)}
		<link rel="alternate" hreflang={alt.locale} href={alt.href} />
	{/each}
	<link rel="alternate" hreflang="x-default" href={xDefaultUrl} />

	<meta property="og:title" content={m.meta_title()} />
	<meta property="og:description" content={m.meta_description()} />
	<meta property="og:site_name" content="Token Stork" />
	<meta property="og:url" content={canonicalUrl} />
	<meta property="og:locale" content={ogLocale} />
	<meta property="og:type" content="website" />
	<meta property="og:image" content="https://tokenstork.com/fb.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content="Token Stork" />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={m.meta_title()} />
	<meta name="twitter:description" content={m.meta_description()} />
	<meta name="twitter:creator" content="@bitcoincashsite" />
	<meta name="twitter:image" content="https://tokenstork.com/tw.png" />
	<meta name="twitter:image:alt" content="Token Stork" />
</svelte:head>


<TooltipProvider>
	<div class="min-h-screen ts-surface-page">
		{#if navigating.to}
			<div class="fixed top-0 left-0 right-0 z-[9999] h-0.5 bg-violet-200/30 dark:bg-violet-800/30">
				<div class="h-full bg-violet-600 dark:bg-violet-400 animate-nav-progress"></div>
			</div>
		{/if}
		<MetricsBar
			tokensTracked={data.tokensTracked}
			tailLastBlock={data.tailLastBlock}
			newIn24h={data.newIn24h}
			totalTvlSats={data.totalTvlSats}
			listedCount={data.listedCount}
			tokenTxs24h={data.tokenTxs24h}
		/>
		<Header />
		{@render children()}
		<CTA />
		<Footer />
	</div>
</TooltipProvider>

<style>
	@keyframes nav-progress {
		0%   { width: 0%; margin-left: 0%; }
		30%  { width: 40%; margin-left: 0%; }
		60%  { width: 60%; margin-left: 30%; }
		90%  { width: 30%; margin-left: 70%; }
		100% { width: 0%; margin-left: 100%; }
	}
	.animate-nav-progress {
		animation: nav-progress 2s ease-in-out infinite;
	}
</style>
