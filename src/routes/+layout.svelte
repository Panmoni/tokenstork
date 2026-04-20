<script lang="ts">
	import '../app.css';
	import { env } from '$env/dynamic/public';
	let { children } = $props();
</script>

<svelte:head>
	<title>Token Stork: Discover, Track and Analyze BCH Cash Tokens (0.0.1 beta)</title>
	<meta
		name="description"
		content="Track BCH CashTokens market cap and more with TokenStork."
	/>
	<meta name="theme-color" content="#4f359b" />

	<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
	<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
	<link rel="shortcut icon" href="/favicon.ico" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	<link rel="manifest" href="/site.webmanifest" />

	<meta property="og:title" content="Token Stork: Discover, Track and Analyze BCH Cash Tokens (0.0.1 beta)" />
	<meta property="og:description" content="Track BCH CashTokens market cap and more with TokenStork." />
	<meta property="og:site_name" content="Token Stork" />
	<meta property="og:url" content="https://tokenstork.com/" />
	<meta property="og:locale" content="en_US" />
	<meta property="og:type" content="website" />
	<meta property="og:image" content="https://tokenstork.com/fb.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content="Token Stork" />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="Token Stork: Discover, Track and Analyze BCH Cash Tokens" />
	<meta name="twitter:description" content="Track BCH CashTokens market cap and more with TokenStork." />
	<meta name="twitter:creator" content="@bitcoincashsite" />
	<meta name="twitter:image" content="https://tokenstork.com/tw.png" />
	<meta name="twitter:image:alt" content="Token Stork" />

	{#if env.PUBLIC_BEAM_ANALYTICS_TOKEN}
		<script
			src="https://beamanalytics.b-cdn.net/beam.min.js"
			data-token={env.PUBLIC_BEAM_ANALYTICS_TOKEN}
			async
		></script>
	{/if}
</svelte:head>

<div class="bg-white dark:bg-slate-950 min-h-screen">
	{@render children()}
</div>
