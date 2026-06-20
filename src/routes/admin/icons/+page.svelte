<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { OPERATOR_BLOCK_REASONS } from '$lib/iconModeration';

	let { data } = $props();

	let busy = $state<string | null>(null);
	let error = $state<string | null>(null);

	// Bulk-approve selection. A row is "clearable" iff it has a file on disk
	// and isn't already cleared — only those can be approved (Clear requires
	// the WebP present), so Select-all and the checkboxes target that set.
	let selected = $state<Set<string>>(new Set());
	let bulkNote = $state('');
	let bulkBusy = $state(false);
	let bulkResult = $state<string | null>(null);

	type Row = (typeof data.rows)[number];
	function isClearable(row: Row): boolean {
		return row.hasFile && row.state !== 'cleared';
	}
	const clearableRows = $derived(data.rows.filter(isClearable));
	const selectedCount = $derived(selected.size);

	function toggleSelect(hash: string) {
		const next = new Set(selected);
		if (next.has(hash)) next.delete(hash);
		else next.add(hash);
		selected = next;
	}
	function selectAllClearable() {
		selected = new Set(clearableRows.map((r) => r.contentHashHex));
	}
	function deselectAll() {
		selected = new Set();
	}

	async function approveSelected() {
		// Submit only hashes still clearable on the current page (the set may
		// hold stragglers after an invalidate).
		const live = new Set(clearableRows.map((r) => r.contentHashHex));
		const hashes = [...selected].filter((h) => live.has(h));
		if (hashes.length === 0) return;
		if (
			!confirm(
				`Approve (Clear) ${hashes.length} icon${hashes.length === 1 ? '' : 's'}? They will be served publicly.`
			)
		)
			return;
		bulkBusy = true;
		error = null;
		bulkResult = null;
		try {
			const res = await fetch('/api/admin/icons/bulk-clear', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ hashes, note: bulkNote.trim() || null })
			});
			const b = (await res.json().catch(() => ({}))) as {
				message?: string;
				cleared?: string[];
				skipped?: { hash: string; reason: string }[];
			};
			if (!res.ok) {
				error = b.message ?? `Bulk approve failed (HTTP ${res.status})`;
				return;
			}
			const cleared = b.cleared?.length ?? 0;
			const skip = b.skipped?.length ?? 0;
			bulkResult = `Approved ${cleared} icon${cleared === 1 ? '' : 's'}${skip ? ` · ${skip} skipped` : ''}.`;
			selected = new Set();
			bulkNote = '';
			await invalidateAll();
		} catch (err) {
			error = (err as Error).message ?? 'Network error';
		} finally {
			bulkBusy = false;
		}
	}

	// Images in the review queue are, by definition, borderline (the NSFW
	// gate scored them between block + review thresholds). Blur every
	// preview by default and require an explicit click to reveal, so the
	// operator is never ambushed by explicit content.
	let revealed = $state<Set<string>>(new Set());
	function toggleReveal(hash: string) {
		const next = new Set(revealed);
		if (next.has(hash)) next.delete(hash);
		else next.add(hash);
		revealed = next;
	}

	// Per-card block reason. Defaults to 'adult' (the most common manual
	// block); the operator can change it before clicking Block.
	let reasonByHash = $state<Record<string, string>>({});
	function reasonFor(hash: string): string {
		return reasonByHash[hash] ?? 'adult';
	}

	async function post(url: string, body: unknown): Promise<boolean> {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!res.ok) {
			const b = (await res.json().catch(() => ({}))) as { message?: string };
			error = b.message ?? `Request failed (HTTP ${res.status})`;
			return false;
		}
		return true;
	}

	async function clearIcon(hash: string) {
		const note = prompt('Optional note (audit trail; not shown to users):', '') ?? '';
		busy = hash;
		error = null;
		try {
			if (await post(`/api/admin/icons/${hash}/clear`, { note: note || null })) {
				await invalidateAll();
			}
		} catch (err) {
			error = (err as Error).message ?? 'Network error';
		} finally {
			busy = null;
		}
	}

	async function blockIcon(hash: string) {
		const reason = reasonFor(hash);
		const note = prompt(`Block as "${reason}". Optional note (audit trail):`, '') ?? '';
		busy = hash;
		error = null;
		try {
			if (await post(`/api/admin/icons/${hash}/block`, { reason, note: note || null })) {
				await invalidateAll();
			}
		} catch (err) {
			error = (err as Error).message ?? 'Network error';
		} finally {
			busy = null;
		}
	}

	function tone(state: string): string {
		if (state === 'cleared')
			return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300';
		if (state === 'blocked')
			return 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300';
		if (state === 'review')
			return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
		return 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300';
	}

	function fmtBytes(n: number | null): string {
		if (n == null) return '—';
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KiB`;
		return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
	}

	function pct(score: number | null): string {
		return score == null ? '—' : `${(score * 100).toFixed(0)}%`;
	}

	const FILTERS: Array<{ key: string; label: string }> = [
		{ key: 'review', label: 'In review' },
		{ key: 'pending', label: 'Pending' },
		{ key: 'cleared', label: 'Cleared' },
		{ key: 'blocked', label: 'Blocked' },
		{ key: 'all', label: 'All' }
	];

	function countFor(key: string): number | null {
		if (key === 'all') return null;
		return (data.counts as Record<string, number>)[key] ?? 0;
	}
</script>

<svelte:head>
	<title>Icon review (admin) — Token Stork</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="max-w-6xl mx-auto px-4 py-8">
	<header class="mb-6">
		<h1 class="text-3xl font-bold ts-text-strong">Icon review queue</h1>
		<p class="mt-1 text-sm ts-text-muted">
			Operator review of BCMR token icons in the safety pipeline.
			<strong>Clear</strong> serves the image at <code class="text-xs">/icons/&lt;hash&gt;.webp</code>;
			<strong>Block</strong> deletes the on-disk WebP and records the reason. Each row is one unique
			image hash — clearing or blocking it applies to every token that uses it. To work the queue
			fast: <strong>Select all</strong>, uncheck the bad ones, then <strong>Approve selected</strong>
			to clear the rest in one click. Block the bad ones individually.
		</p>
		<p class="mt-2 text-xs ts-text-muted">Signed in as <code class="font-mono">{data.me}</code></p>
	</header>

	<nav class="mb-6 flex flex-wrap items-center gap-2 text-sm">
		<span class="ts-text-muted">Filter:</span>
		{#each FILTERS as f (f.key)}
			<a
				href={`?state=${f.key}`}
				class={`px-3 py-1 rounded-md border ${
					data.state === f.key
						? 'bg-violet-600 text-white border-violet-600'
						: 'ts-border-subtle hover:bg-slate-50 dark:hover:bg-zinc-800'
				}`}
			>
				{f.label}{#if countFor(f.key) !== null}<span class="ml-1 opacity-70">({countFor(f.key)})</span>{/if}
			</a>
		{/each}
	</nav>

	{#if error}
		<div
			class="mb-4 p-3 rounded-md bg-rose-50 dark:bg-rose-950/30 text-sm text-rose-700 dark:text-rose-300"
		>{error}</div>
	{/if}

	{#if data.rows.length === 0}
		<div class="rounded-xl border ts-border-subtle p-8 text-center ts-surface-panel">
			<p class="ts-text-muted">No icons in <code class="font-mono">{data.state}</code> state.</p>
		</div>
	{:else}
		<!-- Bulk-approve toolbar. Sticky so it stays reachable while scrolling
		     a long queue: select all (or all-then-deselect-the-bad-ones), add
		     an optional inline note, approve the lot in one click. -->
		<div
			class="sticky top-0 z-20 mb-4 flex flex-wrap items-center gap-2 rounded-lg border ts-border-subtle ts-surface-panel shadow-sm px-3 py-2 text-sm"
		>
			<button
				type="button"
				onclick={selectAllClearable}
				disabled={clearableRows.length === 0}
				class="px-2.5 py-1 rounded-md border ts-border-subtle hover:bg-slate-50 dark:hover:bg-zinc-800 disabled:opacity-40"
			>
				Select all ({clearableRows.length})
			</button>
			<button
				type="button"
				onclick={deselectAll}
				disabled={selectedCount === 0}
				class="px-2.5 py-1 rounded-md border ts-border-subtle hover:bg-slate-50 dark:hover:bg-zinc-800 disabled:opacity-40"
			>
				Deselect
			</button>
			<span class="ts-text-muted tabular-nums">{selectedCount} selected</span>
			<input
				type="text"
				bind:value={bulkNote}
				placeholder="Optional note (audit trail; not shown to users)"
				class="flex-1 min-w-[12rem] rounded-md border ts-border-subtle bg-transparent px-2 py-1 text-xs ts-text-strong"
			/>
			<button
				type="button"
				onclick={approveSelected}
				disabled={selectedCount === 0 || bulkBusy}
				class="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-40"
			>
				{bulkBusy ? 'Approving…' : `Approve selected (${selectedCount})`}
			</button>
		</div>

		{#if bulkResult}
			<div
				class="mb-4 p-3 rounded-md bg-emerald-50 dark:bg-emerald-950/30 text-sm text-emerald-700 dark:text-emerald-300"
			>
				{bulkResult}
			</div>
		{/if}

		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each data.rows as row (row.contentHashHex)}
				<div
					class={`rounded-xl border ts-surface-panel p-3 flex flex-col ${
						selected.has(row.contentHashHex)
							? 'ring-2 ring-emerald-500 border-emerald-500'
							: 'ts-border-subtle'
					}`}
				>
					<!-- Preview -->
					<div class="relative aspect-square rounded-lg overflow-hidden bg-slate-100 dark:bg-zinc-800 mb-3">
						{#if row.hasFile}
							{#if revealed.has(row.contentHashHex)}
								<img
									src={`/icons/${row.contentHashHex}.webp`}
									alt="token icon under review"
									class="w-full h-full object-contain"
									loading="lazy"
								/>
								<button
									type="button"
									onclick={() => toggleReveal(row.contentHashHex)}
									class="absolute bottom-1 right-1 px-2 py-0.5 rounded bg-black/60 text-white text-[10px]"
								>Hide</button>
							{:else}
								<button
									type="button"
									onclick={() => toggleReveal(row.contentHashHex)}
									class="absolute inset-0 w-full h-full flex flex-col items-center justify-center gap-1 text-xs ts-text-muted"
								>
									<img
										src={`/icons/${row.contentHashHex}.webp`}
										alt=""
										aria-hidden="true"
										class="absolute inset-0 w-full h-full object-contain blur-xl scale-110"
										loading="lazy"
									/>
									<span class="relative z-10 px-2 py-1 rounded bg-black/60 text-white font-medium">
										Reveal (may be explicit)
									</span>
								</button>
							{/if}
						{:else}
							<div class="absolute inset-0 flex items-center justify-center text-xs ts-text-muted text-center px-2">
								No image on disk{#if row.state === 'blocked'} (blocked){/if}
							</div>
						{/if}
						<span
							class={`absolute top-1 left-1 px-2 py-0.5 rounded text-[11px] font-semibold ${tone(row.state)}`}
						>
							{row.state}{#if row.blockReason} · {row.blockReason}{/if}
						</span>
						{#if isClearable(row)}
							<label
								class="absolute top-1 right-1 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[11px] cursor-pointer select-none"
							>
								<input
									type="checkbox"
									checked={selected.has(row.contentHashHex)}
									onchange={() => toggleSelect(row.contentHashHex)}
									class="accent-emerald-500"
								/>
								select
							</label>
						{/if}
					</div>

					<!-- Metadata -->
					<dl class="text-[11px] ts-text-muted space-y-0.5 mb-2">
						<div class="flex justify-between gap-2">
							<dt>NSFW score</dt>
							<dd class="font-mono">{pct(row.nsfwScore)}</dd>
						</div>
						<div class="flex justify-between gap-2">
							<dt>Size</dt>
							<dd class="font-mono">{fmtBytes(row.bytesSize)}</dd>
						</div>
						<div class="flex justify-between gap-2">
							<dt>Used by</dt>
							<dd class="font-mono">{row.tokenCount} token{row.tokenCount === 1 ? '' : 's'} · {row.urlCount} url{row.urlCount === 1 ? '' : 's'}</dd>
						</div>
					</dl>

					{#if row.sampleUri}
						<div class="text-[10px] ts-text-muted font-mono break-all mb-1" title={row.sampleUri}>
							{row.sampleUri.length > 80 ? row.sampleUri.slice(0, 80) + '…' : row.sampleUri}
						</div>
					{/if}
					<div class="text-[10px] ts-text-muted font-mono break-all mb-2" title={row.contentHashHex}>
						{row.contentHashHex.slice(0, 16)}…{row.contentHashHex.slice(-8)}
					</div>

					{#if row.decidedBy}
						<div class="text-[10px] ts-text-muted mb-2">
							decided by <code>{row.decidedBy.slice(0, 14)}…</code>
							{#if row.decidedAt}· {new Date(row.decidedAt * 1000).toLocaleString()}{/if}
							{#if row.moderatorNote}<div class="italic">“{row.moderatorNote}”</div>{/if}
						</div>
					{/if}

					<!-- Actions -->
					<div class="mt-auto flex items-center gap-1.5 pt-1">
						<button
							type="button"
							onclick={() => clearIcon(row.contentHashHex)}
							disabled={busy === row.contentHashHex || row.state === 'cleared' || !row.hasFile}
							class="px-2.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-40"
							title={!row.hasFile ? 'No image on disk — cannot clear' : 'Clear (serve publicly)'}
						>
							{busy === row.contentHashHex ? '…' : 'Clear'}
						</button>
						<select
							bind:value={reasonByHash[row.contentHashHex]}
							class="text-[11px] rounded-md border ts-border-subtle bg-transparent px-1 py-1 ts-text-strong"
							aria-label="block reason"
						>
							{#each OPERATOR_BLOCK_REASONS as r (r)}
								<option value={r} selected={r === 'adult'}>{r}</option>
							{/each}
						</select>
						<button
							type="button"
							onclick={() => blockIcon(row.contentHashHex)}
							disabled={busy === row.contentHashHex}
							class="px-2.5 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold disabled:opacity-40"
						>
							Block
						</button>
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
