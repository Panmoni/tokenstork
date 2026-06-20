<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { REPORT_REASON_LABELS } from '$lib/moderation';

	let { data } = $props();

	let busy = $state<number | null>(null);
	let error = $state<string | null>(null);

	const STATES = ['new', 'reviewed', 'actioned', 'dismissed', 'all'] as const;

	async function setStatus(id: number, status: string, promptNote: boolean) {
		let note: string | null = null;
		if (promptNote) {
			note = prompt('Optional note (audit trail; not shown to the reporter):', '') ?? '';
			note = note.trim() || null;
		}
		busy = id;
		error = null;
		try {
			const res = await fetch(`/api/admin/reports/${id}/status`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ status, note })
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { message?: string };
				error = body.message ?? `Update failed (HTTP ${res.status})`;
				return;
			}
			await invalidateAll();
		} catch (err) {
			error = (err as Error).message ?? 'Network error';
		} finally {
			busy = null;
		}
	}

	// Hide / un-hide the reported token via token_moderation. Hiding passes
	// the report's own reason + reportId so the same call also closes the
	// report (→ actioned) atomically. The buttons elsewhere only set triage
	// labels; THIS is the only control that actually removes a token.
	async function moderate(
		report: { id: number; categoryHex: string; reason: string },
		action: 'hide' | 'unhide'
	) {
		let note: string | null = null;
		if (action === 'hide') {
			const input = prompt(
				'Moderator note (audit trail; not shown to the reporter):',
				`hidden per report #${report.id}`
			);
			if (input === null) return; // cancelled
			note = input.trim() || null;
		} else if (!confirm('Un-hide this token? It will reappear across the site.')) {
			return;
		}
		busy = report.id;
		error = null;
		try {
			const res = await fetch(`/api/admin/tokens/${report.categoryHex}/moderate`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(
					action === 'hide'
						? { action: 'hide', reason: report.reason, note, reportId: report.id }
						: { action: 'unhide' }
				)
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { message?: string };
				error = body.message ?? `${action} failed (HTTP ${res.status})`;
				return;
			}
			await invalidateAll();
		} catch (err) {
			error = (err as Error).message ?? 'Network error';
		} finally {
			busy = null;
		}
	}

	function tone(status: string): string {
		if (status === 'actioned')
			return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300';
		if (status === 'dismissed')
			return 'bg-slate-200 dark:bg-zinc-700 text-slate-600 dark:text-slate-300';
		if (status === 'reviewed')
			return 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300';
		return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
	}

	function reasonLabel(reason: string): string {
		return (REPORT_REASON_LABELS as Record<string, string>)[reason] ?? reason;
	}
</script>

<svelte:head>
	<title>Token reports (admin) — Token Stork</title>
</svelte:head>

<div class="max-w-6xl mx-auto px-4 py-8">
	<header class="mb-6">
		<h1 class="text-3xl font-bold ts-text-strong">Token report queue</h1>
		<p class="mt-1 text-sm ts-text-muted">
			User-submitted reports from the “report this token” form. Triage each: mark
			<strong>Reviewed</strong> (seen, no action), <strong>Actioned</strong> (hidden via moderation),
			or <strong>Dismissed</strong> (not a problem). Hiding a token is a separate step — open the
			token to action it, then mark the report here.
		</p>
		<p class="mt-2 text-xs ts-text-muted">Signed in as <code class="font-mono">{data.me}</code></p>
	</header>

	<nav class="mb-6 flex items-center gap-2 text-sm flex-wrap">
		<span class="ts-text-muted">Filter:</span>
		{#each STATES as f (f)}
			<a
				href={`?state=${f}`}
				class={`px-3 py-1 rounded-md border ${
					data.state === f
						? 'bg-violet-600 text-white border-violet-600'
						: 'ts-border-subtle hover:bg-slate-50 dark:hover:bg-zinc-800'
				}`}
			>{f} <span class="opacity-70">({data.counts[f]})</span></a>
		{/each}
	</nav>

	{#if error}
		<div
			class="mb-4 p-3 rounded-md bg-rose-50 dark:bg-rose-950/30 text-sm text-rose-700 dark:text-rose-300"
		>{error}</div>
	{/if}

	{#if data.reports.length === 0}
		<div class="rounded-xl border ts-border-subtle p-8 text-center ts-surface-panel">
			<p class="ts-text-muted">No reports in <code class="font-mono">{data.state}</code> state.</p>
		</div>
	{:else}
		<div class="space-y-4">
			{#each data.reports as r (r.id)}
				<div class="rounded-xl border ts-border-subtle ts-surface-panel p-4">
					<div class="flex items-start justify-between mb-3 gap-3">
						<div class="flex-1 min-w-0">
							<div class="ts-text-strong font-semibold">
								{r.tokenName ?? 'Unknown token'}
								{#if r.tokenSymbol}<span class="ts-text-muted font-normal">({r.tokenSymbol})</span>{/if}
								<span
									class="ml-2 align-middle px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300"
								>{reasonLabel(r.reason)}</span>
							</div>
							<div class="font-mono text-xs ts-text-muted mt-1">
								report #{r.id} · category {r.categoryHex.slice(0, 24)}…
							</div>
							<div class="text-xs ts-text-muted">
								{new Date(r.createdAt * 1000).toLocaleString()}
								{#if r.reporterEmail}
									· contact <code class="font-mono">{r.reporterEmail}</code>
								{/if}
							</div>
						</div>
						<div class="flex flex-col items-end gap-1 shrink-0">
							<span class={`px-2 py-0.5 rounded text-[11px] font-semibold ${tone(r.status)}`}>
								{r.status}
							</span>
							{#if r.hidden}
								<span
									class="px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-600 text-white"
								>token hidden</span>
							{/if}
						</div>
					</div>

					{#if r.details}
						<div class="mb-3 p-3 rounded-md bg-slate-100 dark:bg-zinc-800 text-sm ts-text-strong whitespace-pre-wrap break-words">
							{r.details}
						</div>
					{/if}

					{#if r.moderatorNote}
						<div class="mb-3 text-xs ts-text-muted">
							<strong>Note:</strong> {r.moderatorNote}
						</div>
					{/if}

					<div class="flex items-center gap-2 flex-wrap">
						<button
							type="button"
							onclick={() => setStatus(r.id, 'reviewed', false)}
							disabled={busy === r.id || r.status === 'reviewed'}
							class="px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold disabled:opacity-50"
						>Reviewed</button>
						<button
							type="button"
							onclick={() => setStatus(r.id, 'actioned', true)}
							disabled={busy === r.id || r.status === 'actioned'}
							class="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50"
						>Actioned</button>
						<button
							type="button"
							onclick={() => setStatus(r.id, 'dismissed', true)}
							disabled={busy === r.id || r.status === 'dismissed'}
							class="px-3 py-1.5 rounded-md bg-slate-600 hover:bg-slate-700 text-white text-xs font-semibold disabled:opacity-50"
						>Dismiss</button>
						{#if r.status !== 'new'}
							<button
								type="button"
								onclick={() => setStatus(r.id, 'new', false)}
								disabled={busy === r.id}
								class="px-3 py-1.5 rounded-md border ts-border-subtle text-xs font-semibold hover:bg-slate-50 dark:hover:bg-zinc-800 disabled:opacity-50"
							>Reopen</button>
						{/if}
						<span class="mx-1 ts-text-muted">·</span>
						{#if r.hidden}
							<button
								type="button"
								onclick={() => moderate(r, 'unhide')}
								disabled={busy === r.id}
								class="px-3 py-1.5 rounded-md border border-rose-400 text-rose-700 dark:text-rose-300 text-xs font-semibold hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-50"
							>Unhide token</button>
						{:else}
							<button
								type="button"
								onclick={() => moderate(r, 'hide')}
								disabled={busy === r.id}
								class="px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold disabled:opacity-50"
								title="Removes the token from the site and marks this report actioned"
							>Hide token</button>
						{/if}
						<a
							href={`/token/${r.categoryHex}`}
							data-sveltekit-preload-data="hover"
							class="ml-auto text-xs ts-text-muted hover:text-violet-600"
							target="_blank"
							rel="noopener noreferrer"
						>View token →</a>
					</div>
				</div>
			{/each}
		</div>

		<nav class="mt-6 flex justify-between text-sm">
			{#if data.offset > 0}
				<a
					href={`?state=${data.state}&offset=${Math.max(0, data.offset - data.pageSize)}`}
					class="text-violet-600 dark:text-violet-400 hover:underline"
				>← Newer</a>
			{:else}<span></span>{/if}
			{#if data.hasMore}
				<a
					href={`?state=${data.state}&offset=${data.offset + data.pageSize}`}
					class="text-violet-600 dark:text-violet-400 hover:underline"
				>Older →</a>
			{/if}
		</nav>
	{/if}
</div>
