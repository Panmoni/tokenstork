<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>{page.status} — Token Stork</title>
</svelte:head>

<main class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
	<p class="text-sm text-violet-600 dark:text-violet-400 font-mono uppercase tracking-wider mb-4">
		Error {page.status}
	</p>
	<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent mb-6">
		{page.status === 404
			? 'Page not found'
			: page.status === 410
				? 'Token hidden'
				: 'Something went wrong'}
	</h1>
	{#if page.error?.message}
		<p class="text-slate-600 dark:text-slate-300 mb-6">{page.error.message}</p>
	{/if}
	<p class="text-slate-500 dark:text-slate-400">
		<a href="/" class="text-violet-600 hover:underline">← Back to the directory</a>
	</p>
</main>
