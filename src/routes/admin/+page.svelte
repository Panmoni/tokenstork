<script lang="ts">
	let { data } = $props();

	const queues = $derived([
		{
			href: '/admin/reports',
			title: 'Token reports',
			blurb: 'User-submitted abuse reports from the “report this token” form.',
			pending: data.reports.pending,
			total: data.reports.total,
			pendingLabel: 'new'
		},
		{
			href: '/admin/icons',
			title: 'Icon review',
			blurb: 'Icons the NSFW gate flagged for a hand decision — clear or block.',
			pending: data.icons.pending,
			total: data.icons.total,
			pendingLabel: 'to review'
		},
		{
			href: '/admin/bcmr-submissions',
			title: 'BCMR submissions',
			blurb: 'Operator-approval queue for the tokenstork-hosted BCMR backup.',
			pending: data.submissions.pending,
			total: data.submissions.total,
			pendingLabel: 'pending'
		}
	]);
</script>

<svelte:head>
	<title>Admin — Token Stork</title>
</svelte:head>

<div class="max-w-4xl mx-auto px-4 py-8">
	<header class="mb-6">
		<h1 class="text-3xl font-bold ts-text-strong">Admin</h1>
		<p class="mt-1 text-sm ts-text-muted">Operator queues.</p>
		<p class="mt-2 text-xs ts-text-muted">Signed in as <code class="font-mono">{data.me}</code></p>
	</header>

	<div class="grid gap-4 sm:grid-cols-2">
		{#each queues as q (q.href)}
			<a
				href={q.href}
				data-sveltekit-preload-data="hover"
				class="block rounded-xl border ts-border-subtle ts-surface-panel p-4 hover:border-violet-500 transition-colors"
			>
				<div class="flex items-center justify-between gap-2">
					<h2 class="font-semibold ts-text-strong">{q.title}</h2>
					{#if q.pending > 0}
						<span
							class="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
						>{q.pending} {q.pendingLabel}</span>
					{:else}
						<span class="px-2 py-0.5 rounded text-[11px] font-semibold ts-text-muted">clear</span>
					{/if}
				</div>
				<p class="mt-1 text-sm ts-text-muted">{q.blurb}</p>
				<p class="mt-2 text-xs ts-text-muted">{q.total} total</p>
			</a>
		{/each}
	</div>
</div>
