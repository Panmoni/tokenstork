<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { iconHrefFor } from '$lib/icons';

	let { data } = $props();

	let creatingFor = $state<string | null>(null);
	let createError = $state<string | null>(null);

	async function startWizard(categoryHex: string) {
		creatingFor = categoryHex;
		createError = null;
		try {
			const res = await fetch('/api/bcmr/sessions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ categoryHex })
			});
			if (!res.ok) {
				if (res.status === 409) {
					// User already has a drafting session for this category — find
					// and route to it.
					const draft = data.drafts.find((d) => d.categoryHex === categoryHex);
					if (draft) {
						await goto(`/publish-bcmr/${draft.id}`);
						return;
					}
				}
				const body = (await res.json().catch(() => ({}))) as { message?: string };
				createError = body.message ?? `Couldn't start a session (HTTP ${res.status})`;
				creatingFor = null;
				return;
			}
			const session = (await res.json()) as { id: string };
			await goto(`/publish-bcmr/${session.id}`);
		} catch (err) {
			createError = (err as Error).message ?? 'Network error';
			creatingFor = null;
		}
	}

	async function abandonDraft(id: string) {
		if (!confirm('Abandon this draft? You can always start a new one.')) return;
		const res = await fetch(`/api/bcmr/sessions/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ state: 'abandoned' })
		});
		if (res.ok) await invalidateAll();
	}
</script>

<svelte:head>
	<title>Publish BCMR — Token Stork</title>
	<meta
		name="description"
		content="Publish or update a Bitcoin Cash Metadata Registry (BCMR) entry for a CashToken category whose authority NFT you hold."
	/>
</svelte:head>

<div class="max-w-4xl mx-auto px-4 py-8">
	<header class="mb-8">
		<h1 class="text-3xl font-bold ts-text-strong">Publish BCMR</h1>
		<p class="mt-2 ts-text-muted">
			Give your CashToken a name, symbol, icon, and description by publishing a Bitcoin Cash Metadata
			Registry entry on-chain. Only the wallet holding a category's
			<strong>authority NFT</strong>
			can publish — that's how the protocol prevents impersonation.
		</p>
		<p class="mt-2 ts-text-muted">
			<a href="/faq#faq-bcmr-publish" class="text-violet-600 dark:text-violet-400 hover:underline">
				Read how this works →
			</a>
		</p>
	</header>

	{#if data.utxoFetchError}
		<div
			class="mb-6 p-4 rounded-xl border ts-border-subtle bg-amber-50 dark:bg-amber-950/30 text-sm"
		>
			<strong class="text-amber-700 dark:text-amber-300">Couldn't reach the indexer.</strong>
			We use it to find which categories your wallet can publish for. Refresh to retry — this usually
			clears in seconds.
			<div class="mt-1 font-mono text-xs ts-text-muted">{data.utxoFetchError}</div>
		</div>
	{/if}

	{#if data.drafts.length > 0}
		<section class="mb-8">
			<h2 class="text-lg font-semibold ts-text-strong mb-3">Resume a draft</h2>
			<div class="rounded-xl border ts-border-subtle overflow-hidden ts-surface-panel">
				<table class="w-full text-sm">
					<thead
						class="text-xs font-semibold uppercase tracking-wider ts-text-muted border-b ts-border-subtle bg-slate-50 dark:bg-zinc-900/50"
					>
						<tr>
							<th class="text-left px-4 py-3">Category</th>
							<th class="text-left px-4 py-3">Name</th>
							<th class="text-left px-4 py-3">State</th>
							<th class="text-right px-4 py-3"></th>
						</tr>
					</thead>
					<tbody>
						{#each data.drafts as d (d.id)}
							<tr
								class="border-b border-slate-100 dark:border-zinc-800/50 last:border-0 hover:bg-slate-50 dark:hover:bg-zinc-900/40"
							>
								<td class="px-4 py-3 font-mono text-xs">{d.categoryHex.slice(0, 16)}…</td>
								<td class="px-4 py-3">{d.name ?? '—'}</td>
								<td class="px-4 py-3">
									<span
										class="px-2 py-0.5 rounded text-[11px] font-semibold bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300"
									>{d.state}</span>
								</td>
								<td class="px-4 py-3 text-right">
									<a
										href={`/publish-bcmr/${d.id}`}
										class="text-violet-600 dark:text-violet-400 hover:underline mr-3"
									>Resume →</a>
									<button
										type="button"
										onclick={() => abandonDraft(d.id)}
										class="text-xs ts-text-muted hover:text-rose-600"
									>abandon</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	<section>
		<h2 class="text-lg font-semibold ts-text-strong mb-3">
			{#if data.eligible.length > 0}
				Categories you can publish for ({data.eligible.length})
			{:else}
				No eligible categories
			{/if}
		</h2>

		{#if data.eligible.length === 0 && !data.utxoFetchError}
			<div class="rounded-xl border ts-border-subtle p-6 ts-surface-panel">
				<p class="ts-text-muted text-sm mb-3">
					This wallet doesn't currently hold the authority NFT for any category we've indexed.
				</p>
				<p class="ts-text-muted text-sm">
					If you just minted a token, give the indexer a moment to pick it up and refresh. Or
					<a href="/mint" class="text-violet-600 dark:text-violet-400 hover:underline">mint a new one</a>
					— after minting, return here to publish its BCMR.
				</p>
			</div>
		{:else if data.eligible.length > 0}
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				{#each data.eligible as cat (cat.categoryHex)}
					<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel flex items-start gap-3">
						{#if cat.iconClearedHash}
							<img
								src={iconHrefFor(cat.iconUri, cat.iconClearedHash)}
								alt=""
								width="40"
								height="40"
								class="w-10 h-10 rounded-md flex-shrink-0 ts-surface-chip"
								loading="lazy"
							/>
						{:else}
							<div
								class="w-10 h-10 rounded-md bg-slate-100 dark:bg-zinc-800 flex-shrink-0"
							></div>
						{/if}
						<div class="flex-1 min-w-0">
							<div class="font-semibold ts-text-strong truncate">
								{cat.name ?? cat.categoryHex.slice(0, 12) + '…'}
								{#if cat.symbol}
									<span class="ts-text-muted text-xs ml-1">{cat.symbol}</span>
								{/if}
							</div>
							<div class="font-mono text-[11px] ts-text-muted truncate">
								{cat.categoryHex.slice(0, 24)}…
							</div>
							<div class="mt-1 text-[11px] ts-text-muted">
								{cat.tokenType}{#if cat.hasBcmr}
									· <span class="text-emerald-700 dark:text-emerald-400">already registered</span>
								{:else}
									· <span class="text-amber-700 dark:text-amber-400">no BCMR yet</span>
								{/if}
							</div>
							<div class="mt-3">
								<button
									type="button"
									onclick={() => startWizard(cat.categoryHex)}
									disabled={creatingFor === cat.categoryHex}
									class="px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold disabled:opacity-50 disabled:cursor-wait"
								>
									{cat.hasBcmr ? 'Update BCMR' : 'Publish BCMR'}
									{creatingFor === cat.categoryHex ? '…' : '→'}
								</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		{#if createError}
			<div
				class="mt-4 p-3 rounded-xl border bg-rose-50 dark:bg-rose-950/30 text-sm text-rose-700 dark:text-rose-300"
			>{createError}</div>
		{/if}
	</section>
</div>
