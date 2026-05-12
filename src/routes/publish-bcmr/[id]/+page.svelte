<script lang="ts">
	// /publish-bcmr/[id] — BCMR publish wizard.
	//
	//   1 identity  — name, ticker, decimals, description
	//   2 icon      — paste an https:// or ipfs:// icon URI
	//   3 canonical — generate the canonical JSON + show the user the
	//                 bytes to host. Compute sha256 (the on-chain
	//                 content_hash).
	//   4 verify    — user posts their hosted URL, we sha256-verify the
	//                 returned bytes. Optionally submit a backup copy to
	//                 tokenstork for operator approval.            [Day 3]
	//   5 build+sign — libauth-direct unsigned tx (spend authNFT, emit
	//                  new authNFT, OP_RETURN BCMR locator), paste-hex
	//                  signing.                                    [Day 4]
	//   6 broadcast  — forward signed hex to BCHN.                 [Day 4]
	//
	// State persists via /api/bcmr/sessions/[id] PATCH on each step
	// transition. Resume-across-refresh is automatic — the SSR loader
	// hydrates everything from the session row.

	import { goto } from '$app/navigation';
	import type { BcmrPublishSession } from '$lib/server/bcmrPublishSessions';

	let { data } = $props();

	// Initial-only reads of `data` — wrapped in functions to satisfy
	// svelte-check's "state_referenced_locally" warning. The SvelteKit
	// load runs once on mount and we don't navigate inside the wizard,
	// so capturing the initial snapshot is correct.
	function initialSession() {
		return data.session;
	}
	function initialName() {
		return data.session.name ?? data.category.currentName ?? '';
	}
	function initialTicker() {
		return data.session.ticker ?? data.category.currentSymbol ?? '';
	}
	function initialDecimals() {
		return data.session.decimals ?? data.category.currentDecimals ?? 0;
	}
	function initialDescription() {
		return data.session.description ?? data.category.currentDescription ?? '';
	}
	function initialIconUri() {
		return data.session.iconUri ?? data.category.currentIconUri ?? '';
	}
	function initialStep(): number {
		const s = data.session;
		if (s.publishTxidHex) return 6;
		if (s.signedTxHex) return 5;
		if (s.publicationVerifiedAt) return 5;
		if (s.contentHashHex) return 4;
		if (s.iconUri) return 3;
		return 1;
	}

	let session = $state<BcmrPublishSession>(initialSession());

	function maxStepForState(s: BcmrPublishSession): number {
		if (s.contentHashHex) return 3;
		if (s.iconUri !== null && s.iconUri !== undefined) return 2;
		return 1;
	}

	let step = $state(initialStep());

	// Form state — prefilled from session row OR existing BCMR (update flow).
	let name = $state<string>(initialName());
	let ticker = $state<string>(initialTicker());
	let decimals = $state<number>(initialDecimals());
	let description = $state<string>(initialDescription());
	let iconUri = $state<string>(initialIconUri());

	let saveError = $state<string | null>(null);
	let saving = $state(false);
	let abandoning = $state(false);
	let abandonError = $state<string | null>(null);

	// Canonicalize result (returned by /canonicalize endpoint and persisted on session).
	let canonicalJson = $state<string | null>(null);
	let canonicalizing = $state(false);
	let canonicalizeError = $state<string | null>(null);

	const stepLabels = ['Identity', 'Icon', 'Canonicalize', 'Publish', 'Build & sign', 'Broadcast'];

	// Per-step validators.
	const step1Error = $derived.by<string | null>(() => {
		if (!name.trim()) return 'A name is required.';
		if (name.trim().length > 80) return 'Name must be 80 characters or fewer.';
		if (!ticker.trim()) return 'A ticker (symbol) is required.';
		if (ticker.trim().length > 12) return 'Ticker must be 12 characters or fewer.';
		if (!Number.isInteger(decimals) || decimals < 0 || decimals > 8) {
			return 'Decimals must be an integer in 0-8.';
		}
		if (description.length > 500) return 'Description must be 500 characters or fewer.';
		return null;
	});
	const step2Error = $derived.by<string | null>(() => {
		const trimmed = iconUri.trim();
		if (!trimmed) return null; // optional
		if (trimmed.length > 1024) return 'Icon URI must be 1024 characters or fewer.';
		if (!/^(https?|ipfs):\/\//i.test(trimmed)) {
			return 'Icon URI must start with https://, http://, or ipfs:// (or leave blank).';
		}
		return null;
	});

	async function patchSession(patch: Partial<{
		name: string | null;
		ticker: string | null;
		description: string | null;
		decimals: number | null;
		iconUri: string | null;
	}>) {
		saveError = null;
		saving = true;
		try {
			const res = await fetch(`/api/bcmr/sessions/${session.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(patch)
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { message?: string };
				saveError = body.message ?? `Save failed (HTTP ${res.status})`;
				return;
			}
			session = (await res.json()) as BcmrPublishSession;
		} catch (err) {
			saveError = (err as Error).message ?? 'Network error';
		} finally {
			saving = false;
		}
	}

	async function saveIdentityThenAdvance() {
		if (step1Error) return;
		await patchSession({
			name: name.trim(),
			ticker: ticker.trim(),
			description: description.trim() || null,
			decimals
		});
		if (saveError) return;
		step = 2;
	}

	async function saveIconThenAdvance() {
		if (step2Error) return;
		await patchSession({ iconUri: iconUri.trim() || null });
		if (saveError) return;
		step = 3;
	}

	async function runCanonicalize() {
		canonicalizing = true;
		canonicalizeError = null;
		canonicalJson = null;
		try {
			const res = await fetch(`/api/bcmr/sessions/${session.id}/canonicalize`, {
				method: 'POST'
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { message?: string };
				canonicalizeError = body.message ?? `Canonicalize failed (HTTP ${res.status})`;
				return;
			}
			const body = (await res.json()) as {
				canonical: string;
				session: BcmrPublishSession;
			};
			canonicalJson = body.canonical;
			session = body.session;
		} catch (err) {
			canonicalizeError = (err as Error).message ?? 'Network error';
		} finally {
			canonicalizing = false;
		}
	}

	function downloadJson() {
		if (!canonicalJson && !session.bcmrJson) return;
		const bytes = canonicalJson ?? JSON.stringify(session.bcmrJson, null, 2);
		const blob = new Blob([bytes], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${session.categoryHex.slice(0, 12)}-bcmr.json`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	async function copyToClipboard(text: string) {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			/* clipboard API failed — silently no-op */
		}
	}

	async function abandonDraft() {
		if (!confirm('Abandon this draft? You can start a fresh one for this category afterwards.')) return;
		abandoning = true;
		abandonError = null;
		try {
			const res = await fetch(`/api/bcmr/sessions/${session.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ state: 'abandoned' })
			});
			if (res.ok) {
				await goto('/publish-bcmr');
				return;
			}
			abandonError = `Abandon failed (HTTP ${res.status})`;
		} catch (err) {
			abandonError = (err as Error).message ?? 'Network error';
		} finally {
			abandoning = false;
		}
	}

	function jumpTo(idx: number) {
		// Only allow jumping to steps the session has progressed past.
		if (idx > maxStepForState(session) && idx !== step) return;
		step = idx;
	}
</script>

<svelte:head>
	<title>{data.isUpdate ? 'Update' : 'Publish'} BCMR — Token Stork</title>
</svelte:head>

<div class="max-w-3xl mx-auto px-4 py-8">
	<div class="mb-6">
		<a href="/publish-bcmr" class="text-violet-600 dark:text-violet-400 hover:underline text-sm">← Back to categories</a>
		<h1 class="mt-2 text-3xl font-bold ts-text-strong">
			{data.isUpdate ? 'Update' : 'Publish'} BCMR
		</h1>
		<p class="mt-1 text-sm ts-text-muted">
			Category <code class="font-mono text-xs">{session.categoryHex.slice(0, 16)}…{session.categoryHex.slice(-8)}</code>
			· <span class="capitalize">{session.state}</span>
		</p>
	</div>

	<!-- Step indicator -->
	<ol class="flex items-center justify-between mb-8 text-xs sm:text-sm">
		{#each stepLabels as label, i (label)}
			{@const idx = i + 1}
			{@const isActive = step === idx}
			{@const isComplete = step > idx}
			<li class="flex-1 flex items-center {i < stepLabels.length - 1 ? 'mr-1 sm:mr-2' : ''}">
				<button type="button" onclick={() => jumpTo(idx)} class="flex items-center gap-2 group">
					<span
						class="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full text-xs font-semibold {isActive ? 'bg-violet-600 text-white' : isComplete ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500 dark:bg-zinc-800 dark:text-zinc-300'}"
					>
						{isComplete ? '✓' : idx}
					</span>
					<span class="hidden sm:inline {isActive ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-500 dark:text-zinc-300'}">
						{label}
					</span>
				</button>
				{#if i < stepLabels.length - 1}
					<div class="flex-1 h-px mx-1 sm:mx-3 {isComplete ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-zinc-800'}"></div>
				{/if}
			</li>
		{/each}
	</ol>

	<div class="p-6 sm:p-8 rounded-xl border ts-border-subtle ts-surface-panel">
		{#if step === 1}
			<h2 class="text-xl font-semibold ts-text-strong mb-2">1. Identity</h2>
			<p class="text-sm mb-5 ts-text-muted">
				What this token is called and how it appears in wallets + explorers. These fields go into
				the BCMR JSON as the registry's <code class="text-xs">identities[category][revision]</code>
				entry.
			</p>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<label class="block">
					<span class="text-sm font-medium ts-text-strong">Name</span>
					<input
						type="text"
						maxlength="80"
						bind:value={name}
						placeholder="My Token"
						class="mt-1 w-full px-3 py-2 rounded-md border ts-border-strong ts-surface-input"
					/>
				</label>
				<label class="block">
					<span class="text-sm font-medium ts-text-strong">Ticker / symbol</span>
					<input
						type="text"
						maxlength="12"
						bind:value={ticker}
						placeholder="MYT"
						class="mt-1 w-full px-3 py-2 rounded-md border ts-border-strong ts-surface-input font-mono"
					/>
				</label>
				<label class="block">
					<span class="text-sm font-medium ts-text-strong">Decimals</span>
					<input
						type="number"
						min="0"
						max="8"
						step="1"
						bind:value={decimals}
						class="mt-1 w-full px-3 py-2 rounded-md border ts-border-strong ts-surface-input"
					/>
					<span class="block mt-1 text-xs ts-text-muted">0 for indivisible (NFT-style or whole-units), up to 8 for finely-divisible.</span>
				</label>
				<label class="block sm:col-span-2">
					<span class="text-sm font-medium ts-text-strong">Description (optional)</span>
					<textarea
						rows="3"
						maxlength="500"
						bind:value={description}
						placeholder="A brief explanation of this token's purpose."
						class="mt-1 w-full px-3 py-2 rounded-md border ts-border-strong ts-surface-input"
					></textarea>
					<span class="block mt-1 text-xs ts-text-muted">{description.length} / 500</span>
				</label>
			</div>
			{#if step1Error}
				<p class="mt-4 text-sm text-rose-600 dark:text-rose-400">{step1Error}</p>
			{/if}
		{:else if step === 2}
			<h2 class="text-xl font-semibold ts-text-strong mb-2">2. Icon URI</h2>
			<p class="text-sm mb-5 ts-text-muted">
				Where to find your token's icon image. Paste an <code class="text-xs">https://</code> URL
				or an <code class="text-xs">ipfs://&lt;cid&gt;</code> reference. The image should be a
				square PNG or WebP at 256×256 or larger. Leave blank to publish without an icon.
			</p>
			<label class="block">
				<span class="text-sm font-medium ts-text-strong">Icon URI</span>
				<input
					type="text"
					maxlength="1024"
					bind:value={iconUri}
					placeholder="ipfs://bafy… or https://…"
					class="mt-1 w-full px-3 py-2 rounded-md border ts-border-strong ts-surface-input font-mono text-sm"
				/>
			</label>
			{#if step2Error}
				<p class="mt-4 text-sm text-rose-600 dark:text-rose-400">{step2Error}</p>
			{/if}
		{:else if step === 3}
			<h2 class="text-xl font-semibold ts-text-strong mb-2">3. Canonicalize</h2>
			<p class="text-sm mb-5 ts-text-muted">
				We'll build the canonical BCMR JSON from your inputs and compute its <code class="text-xs">sha256</code> —
				that hash will be committed on-chain alongside the publication URI, so any consumer can
				verify the JSON bytes match what you intended to publish.
			</p>

			{#if !session.contentHashHex && !canonicalJson}
				<button
					type="button"
					onclick={runCanonicalize}
					disabled={canonicalizing}
					class="px-4 py-2 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50"
				>
					{canonicalizing ? 'Generating…' : 'Generate canonical JSON'}
				</button>
			{/if}

			{#if session.contentHashHex || canonicalJson}
				<div class="space-y-4">
					<div>
						<div class="text-sm font-medium ts-text-strong mb-1">Content hash (sha256)</div>
						<div class="flex items-center gap-2">
							<code class="flex-1 px-3 py-2 rounded-md bg-slate-100 dark:bg-zinc-800 font-mono text-xs break-all">
								{session.contentHashHex}
							</code>
							<button
								type="button"
								onclick={() => session.contentHashHex && copyToClipboard(session.contentHashHex)}
								class="px-3 py-2 rounded-md border ts-border-strong text-xs hover:bg-slate-50 dark:hover:bg-zinc-800"
							>
								Copy
							</button>
						</div>
					</div>

					<div>
						<div class="flex items-center justify-between mb-1">
							<div class="text-sm font-medium ts-text-strong">Canonical JSON</div>
							<button
								type="button"
								onclick={downloadJson}
								class="px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold"
							>
								Download .json
							</button>
						</div>
						<pre
							class="px-3 py-2 rounded-md bg-slate-100 dark:bg-zinc-800 font-mono text-[11px] max-h-80 overflow-auto"
						>{canonicalJson ?? JSON.stringify(session.bcmrJson, null, 2)}</pre>
					</div>

					<div class="p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 text-sm">
						<strong class="text-amber-700 dark:text-amber-300">Next step:</strong> upload these exact
						bytes to your own IPFS / web3.storage / Pinata / HTTPS host. We'll fetch your URL on
						step 4 and verify the sha256 matches before allowing the on-chain broadcast.
					</div>
				</div>
			{/if}

			{#if canonicalizeError}
				<p class="mt-4 text-sm text-rose-600 dark:text-rose-400">{canonicalizeError}</p>
			{/if}
		{:else if step === 4}
			<h2 class="text-xl font-semibold ts-text-strong mb-2">4. Publish & verify</h2>
			<p class="text-sm mb-5 ts-text-muted">
				Coming in Day 3 — paste your hosted URL here, we'll fetch + sha256-verify. You'll also have
				the option to submit a backup copy to tokenstork.com for operator approval.
			</p>
			<div class="p-3 rounded-md bg-slate-100 dark:bg-zinc-800 text-sm ts-text-muted">
				This step is not yet wired. Skip is disabled.
			</div>
		{:else if step === 5}
			<h2 class="text-xl font-semibold ts-text-strong mb-2">5. Build & sign</h2>
			<p class="text-sm mb-5 ts-text-muted">
				Coming in Day 4 — we build the authNFT-spending tx with the BCMR locator in
				<code class="text-xs">OP_RETURN</code>, you sign it in your wallet, paste the signed hex back.
			</p>
			<div class="p-3 rounded-md bg-slate-100 dark:bg-zinc-800 text-sm ts-text-muted">
				This step is not yet wired.
			</div>
		{:else if step === 6}
			<h2 class="text-xl font-semibold ts-text-strong mb-2">6. Broadcast</h2>
			<p class="text-sm mb-5 ts-text-muted">
				Coming in Day 4 — forward the signed tx to our BCHN, record the txid, transition the session
				to <code class="text-xs">broadcast</code>.
			</p>
			<div class="p-3 rounded-md bg-slate-100 dark:bg-zinc-800 text-sm ts-text-muted">
				This step is not yet wired.
			</div>
		{/if}

		{#if saveError}
			<p class="mt-4 text-sm text-rose-600 dark:text-rose-400" role="alert">{saveError}</p>
		{/if}

		<div class="mt-6 flex items-center justify-between">
			<button
				type="button"
				onclick={() => (step = Math.max(1, step - 1))}
				disabled={step === 1}
				class="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-slate-50 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed ts-text-strong ts-border-strong"
			>
				← Back
			</button>
			<div class="flex items-center gap-3">
				<button
					type="button"
					onclick={abandonDraft}
					disabled={abandoning}
					class="px-3 py-2 text-xs ts-text-muted hover:text-rose-600 disabled:opacity-50"
				>
					{abandoning ? 'Abandoning…' : 'Abandon draft'}
				</button>
				{#if step === 1}
					<button
						type="button"
						onclick={saveIdentityThenAdvance}
						disabled={!!step1Error || saving}
						class="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{saving ? 'Saving…' : 'Next →'}
					</button>
				{:else if step === 2}
					<button
						type="button"
						onclick={saveIconThenAdvance}
						disabled={!!step2Error || saving}
						class="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{saving ? 'Saving…' : 'Next →'}
					</button>
				{:else if step === 3}
					<button
						type="button"
						onclick={() => session.contentHashHex && (step = 4)}
						disabled={!session.contentHashHex}
						class="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
					>
						Next →
					</button>
				{:else}
					<button
						type="button"
						disabled
						class="px-5 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium opacity-50 cursor-not-allowed"
					>
						Not yet wired
					</button>
				{/if}
			</div>
		</div>

		{#if abandonError}
			<p class="mt-3 text-sm text-rose-600 dark:text-rose-400">{abandonError}</p>
		{/if}
	</div>
</div>
