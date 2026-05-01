<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	// Legacy route. The Terms of Service and Privacy Policy live at /terms
	// and /privacy now; this page exists only to keep external links working.
	// We do the redirect client-side (not via a server `redirect()`) because
	// HTTP redirects can't see the URL fragment — `/tos#privacy` would lose
	// its hash on a server-side 308 and land at /terms#privacy (a non-anchor
	// on the wrong page) instead of /privacy.
	onMount(() => {
		const target = window.location.hash === '#privacy' ? '/privacy' : '/terms';
		goto(target, { replaceState: true });
	});
</script>

<svelte:head>
	<title>Redirecting… — Token Stork</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
	<p class="text-slate-600 dark:text-zinc-200">
		This page has moved. Continue to the <a href="/terms" class="text-violet-600 hover:underline"
			>Terms of Service</a
		>
		or the <a href="/privacy" class="text-violet-600 hover:underline">Privacy Policy</a>.
	</p>
</main>
