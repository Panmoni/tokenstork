<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { iconHrefFor } from '$lib/icons';
	import * as m from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';

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
						await goto(localizeHref(`/publish-bcmr/${draft.id}`));
						return;
					}
				}
				const body = (await res.json().catch(() => ({}))) as { message?: string };
				createError = body.message ?? m.pubbcmr_err_start_session({ status: res.status });
				creatingFor = null;
				return;
			}
			const session = (await res.json()) as { id: string };
			await goto(localizeHref(`/publish-bcmr/${session.id}`));
		} catch (err) {
			createError = (err as Error).message ?? m.error_network();
			creatingFor = null;
		}
	}

	async function abandonDraft(id: string) {
		if (!confirm(m.pubbcmr_abandon_confirm())) return;
		const res = await fetch(`/api/bcmr/sessions/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ state: 'abandoned' })
		});
		if (res.ok) await invalidateAll();
	}
</script>

<svelte:head>
	<title>{m.pubbcmr_meta_title()}</title>
	<meta
		name="description"
		content={m.pubbcmr_meta_description()}
	/>
</svelte:head>

<div class="max-w-4xl mx-auto px-4 py-8">
	<header class="mb-8">
		<h1 class="text-3xl font-bold ts-text-strong">{m.pubbcmr_h1()}</h1>
		<p class="mt-2 ts-text-muted">
			{m.pubbcmr_intro_before()}
			<strong>{m.pubbcmr_authority_nft()}</strong>
			{m.pubbcmr_intro_after()}
		</p>
		<p class="mt-2 ts-text-muted">
			<a href={localizeHref('/faq#faq-bcmr-publish')} class="text-violet-600 dark:text-violet-400 hover:underline">
				{m.pubbcmr_read_how()} →
			</a>
		</p>
	</header>

	{#if data.utxoFetchError}
		<div
			class="mb-6 p-4 rounded-xl border ts-border-subtle bg-amber-50 dark:bg-amber-950/30 text-sm"
		>
			<strong class="text-amber-700 dark:text-amber-300">{m.pubbcmr_indexer_err_title()}</strong>
			{m.pubbcmr_indexer_err_body()}
			<div class="mt-1 font-mono text-xs ts-text-muted">{data.utxoFetchError}</div>
		</div>
	{/if}

	{#if data.drafts.length > 0}
		<section class="mb-8">
			<h2 class="text-lg font-semibold ts-text-strong mb-3">{m.pubbcmr_resume_draft()}</h2>
			<div class="rounded-xl border ts-border-subtle overflow-hidden ts-surface-panel">
				<table class="w-full text-sm">
					<thead
						class="text-xs font-semibold uppercase tracking-wider ts-text-muted border-b ts-border-subtle bg-slate-50 dark:bg-zinc-900/50"
					>
						<tr>
							<th class="text-left px-4 py-3">{m.pubbcmr_th_category()}</th>
							<th class="text-left px-4 py-3">{m.pubbcmr_th_name()}</th>
							<th class="text-left px-4 py-3">{m.pubbcmr_th_state()}</th>
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
										href={localizeHref(`/publish-bcmr/${d.id}`)}
										class="text-violet-600 dark:text-violet-400 hover:underline mr-3"
									>{m.pubbcmr_resume()} →</a>
									<button
										type="button"
										onclick={() => abandonDraft(d.id)}
										class="text-xs ts-text-muted hover:text-rose-600"
									>{m.pubbcmr_abandon()}</button>
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
				{m.pubbcmr_eligible_count({ count: data.eligible.length })}
			{:else}
				{m.pubbcmr_no_eligible()}
			{/if}
		</h2>

		{#if data.eligible.length === 0 && !data.utxoFetchError}
			<div class="rounded-xl border ts-border-subtle p-6 ts-surface-panel">
				<p class="ts-text-muted text-sm mb-3">
					{m.pubbcmr_no_eligible_body1()}
				</p>
				<p class="ts-text-muted text-sm">
					{m.pubbcmr_no_eligible_body2_before()}
					<a href={localizeHref('/mint')} class="text-violet-600 dark:text-violet-400 hover:underline">{m.pubbcmr_mint_a_new_one()}</a>
					{m.pubbcmr_no_eligible_body2_after()}
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
									· <span class="text-emerald-700 dark:text-emerald-400">{m.pubbcmr_already_registered()}</span>
								{:else}
									· <span class="text-amber-700 dark:text-amber-400">{m.pubbcmr_no_bcmr_yet()}</span>
								{/if}
							</div>
							<div class="mt-3">
								<button
									type="button"
									onclick={() => startWizard(cat.categoryHex)}
									disabled={creatingFor === cat.categoryHex}
									class="px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold disabled:opacity-50 disabled:cursor-wait"
								>
									{cat.hasBcmr ? m.pubbcmr_update_bcmr() : m.pubbcmr_publish_bcmr()}
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
