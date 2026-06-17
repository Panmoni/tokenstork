<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	let busy = $state<string | null>(null);
	let error = $state<string | null>(null);

	async function approve(contentHash: string) {
		const note = prompt('Optional moderator note (audit trail; not shown to user):', '') ?? '';
		busy = contentHash;
		error = null;
		try {
			const res = await fetch(`/api/admin/bcmr-submissions/${contentHash}/approve`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ note: note || null })
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { message?: string };
				error = body.message ?? `Approve failed (HTTP ${res.status})`;
				return;
			}
			await invalidateAll();
		} catch (err) {
			error = (err as Error).message ?? 'Network error';
		} finally {
			busy = null;
		}
	}

	async function reject(contentHash: string) {
		const note = prompt('Reason for rejection (audit trail; required):', '');
		if (!note || !note.trim()) return;
		busy = contentHash;
		error = null;
		try {
			const res = await fetch(`/api/admin/bcmr-submissions/${contentHash}/reject`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ note: note.trim() })
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { message?: string };
				error = body.message ?? `Reject failed (HTTP ${res.status})`;
				return;
			}
			await invalidateAll();
		} catch (err) {
			error = (err as Error).message ?? 'Network error';
		} finally {
			busy = null;
		}
	}

	function tone(state: string): string {
		if (state === 'approved')
			return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300';
		if (state === 'rejected')
			return 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300';
		return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
	}
</script>

<svelte:head>
	<title>BCMR Submissions (admin) — Token Stork</title>
</svelte:head>

<div class="max-w-6xl mx-auto px-4 py-8">
	<header class="mb-6">
		<h1 class="text-3xl font-bold ts-text-strong">BCMR submission queue</h1>
		<p class="mt-1 text-sm ts-text-muted">
			Operator approval queue for tokenstork-hosted BCMR backups.
			Approving writes the JSON to <code class="text-xs">/var/lib/tokenstork/bcmr/&lt;hash&gt;.json</code>
			for Caddy to serve at <code class="text-xs">/bcmr/&lt;hash&gt;.json</code>.
			The on-chain publication is independent of approval; only the tokenstork-hosted mirror is gated.
		</p>
		<p class="mt-2 text-xs ts-text-muted">Signed in as <code class="font-mono">{data.me}</code></p>
	</header>

	<nav class="mb-6 flex items-center gap-2 text-sm">
		<span class="ts-text-muted">Filter:</span>
		{#each ['pending', 'approved', 'rejected', 'all'] as f (f)}
			<a
				href={`?state=${f}`}
				class={`px-3 py-1 rounded-md border ${
					data.state === f
						? 'bg-violet-600 text-white border-violet-600'
						: 'ts-border-subtle hover:bg-slate-50 dark:hover:bg-zinc-800'
				}`}
			>{f}</a>
		{/each}
	</nav>

	{#if error}
		<div
			class="mb-4 p-3 rounded-md bg-rose-50 dark:bg-rose-950/30 text-sm text-rose-700 dark:text-rose-300"
		>{error}</div>
	{/if}

	{#if data.submissions.length === 0}
		<div class="rounded-xl border ts-border-subtle p-8 text-center ts-surface-panel">
			<p class="ts-text-muted">No submissions in <code class="font-mono">{data.state}</code> state.</p>
		</div>
	{:else}
		<div class="space-y-4">
			{#each data.submissions as s (s.contentHashHex)}
				<div class="rounded-xl border ts-border-subtle ts-surface-panel p-4">
					<div class="flex items-center justify-between mb-3">
						<div class="flex-1 min-w-0">
							<div class="font-mono text-xs ts-text-muted">
								category: {s.categoryHex.slice(0, 24)}…
							</div>
							<div class="font-mono text-xs ts-text-muted">
								hash: {s.contentHashHex}
							</div>
							<div class="text-xs ts-text-muted mt-1">
								submitted by <code class="font-mono">{s.cashaddr.slice(0, 16)}…</code> at
								{new Date(s.submittedAt * 1000).toLocaleString()}
							</div>
						</div>
						<span class={`px-2 py-0.5 rounded text-[11px] font-semibold ${tone(s.reviewState)}`}>
							{s.reviewState}
						</span>
					</div>

					<details class="mb-3">
						<summary class="cursor-pointer text-xs font-medium ts-text-strong">JSON body</summary>
						<pre
							class="mt-2 p-3 rounded-md bg-slate-100 dark:bg-zinc-800 font-mono text-[11px] max-h-96 overflow-auto"
						>{s.jsonBodyPreview}</pre>
					</details>

					{#if s.moderatorNote}
						<div class="mb-3 text-xs ts-text-muted">
							<strong>Note:</strong> {s.moderatorNote}
							{#if s.reviewerCashaddr}
								<span> · by {s.reviewerCashaddr.slice(0, 12)}…</span>
							{/if}
						</div>
					{/if}

					{#if s.reviewState === 'pending'}
						<div class="flex items-center gap-2">
							<button
								type="button"
								onclick={() => approve(s.contentHashHex)}
								disabled={busy === s.contentHashHex}
								class="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50"
							>
								{busy === s.contentHashHex ? 'Approving…' : 'Approve'}
							</button>
							<button
								type="button"
								onclick={() => reject(s.contentHashHex)}
								disabled={busy === s.contentHashHex}
								class="px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold disabled:opacity-50"
							>
								Reject
							</button>
							<a
								href={`/token/${s.categoryHex}`}
								data-sveltekit-preload-data="hover"
								class="ml-auto text-xs ts-text-muted hover:text-violet-600"
								target="_blank"
								rel="noopener noreferrer"
							>View token →</a>
						</div>
					{/if}
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
