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
		if (s.publishTxidHex) return 6;
		if (s.signedTxHex) return 5;
		if (s.publicationVerifiedAt) return 5;
		if (s.contentHashHex) return 4;
		if (s.iconUri !== null && s.iconUri !== undefined) return 3;
		return 2;
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

	// Step 4: publication verification + optional tokenstork backup.
	let publicationUriInput = $state<string>(initialPublicationUri());
	function initialPublicationUri() {
		return data.session.publicationUri ?? '';
	}
	let verifying = $state(false);
	let verifyResult = $state<
		| null
		| { ok: true; sizeBytes: number }
		| { ok: false; reason: string; message: string; expected?: string; observed?: string }
	>(null);
	let submitBackup = $state(false); // checkbox
	let submittingBackup = $state(false);
	let submitBackupResult = $state<null | { ok: true } | { ok: false; message: string }>(null);

	// Step 5: build tx + paste-hex sign + broadcast.
	let buildingTx = $state(false);
	let buildTxError = $state<string | null>(null);
	let buildTxSummary = $state<null | {
		feeSats: number;
		changeSats: number;
		authNftOutputSats: number;
		encodedTxBytes: number;
	}>(null);
	let signedTxHexInput = $state('');
	let broadcasting = $state(false);
	let broadcastError = $state<string | null>(null);
	let broadcastTxid = $state<string | null>(initialPublishTxid());
	function initialPublishTxid() {
		return data.session.publishTxidHex ?? null;
	}

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

	async function runVerify() {
		verifyResult = null;
		const url = publicationUriInput.trim();
		if (!url) {
			verifyResult = { ok: false, reason: 'invalid-url', message: 'Enter your URL first' };
			return;
		}
		verifying = true;
		try {
			const res = await fetch(`/api/bcmr/sessions/${session.id}/verify-uri`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ publicationUri: url })
			});
			if (res.status === 200) {
				const body = (await res.json()) as
					| { ok: true; session: BcmrPublishSession; sizeBytes: number }
					| {
							ok: false;
							reason: string;
							message: string;
							expected?: string;
							observed?: string;
					  };
				if (body.ok) {
					session = body.session;
					verifyResult = { ok: true, sizeBytes: body.sizeBytes };
				} else {
					verifyResult = body;
				}
			} else {
				const body = (await res.json().catch(() => ({}))) as { message?: string };
				verifyResult = {
					ok: false,
					reason: 'server-error',
					message: body.message ?? `Verify failed (HTTP ${res.status})`
				};
			}
		} catch (err) {
			verifyResult = {
				ok: false,
				reason: 'network',
				message: (err as Error).message ?? 'Network error'
			};
		} finally {
			verifying = false;
		}
	}

	async function runSubmitBackup() {
		submitBackupResult = null;
		submittingBackup = true;
		try {
			const res = await fetch(`/api/bcmr/sessions/${session.id}/submit-backup`, {
				method: 'POST'
			});
			if (res.ok) {
				submitBackupResult = { ok: true };
			} else {
				const body = (await res.json().catch(() => ({}))) as { message?: string };
				submitBackupResult = {
					ok: false,
					message: body.message ?? `Submit failed (HTTP ${res.status})`
				};
			}
		} catch (err) {
			submitBackupResult = {
				ok: false,
				message: (err as Error).message ?? 'Network error'
			};
		} finally {
			submittingBackup = false;
		}
	}

	async function runBuildTx() {
		buildingTx = true;
		buildTxError = null;
		try {
			const res = await fetch(`/api/bcmr/sessions/${session.id}/build-tx`, {
				method: 'POST'
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { message?: string };
				buildTxError = body.message ?? `Build failed (HTTP ${res.status})`;
				return;
			}
			const body = (await res.json()) as {
				unsignedTxHex: string;
				feeSats: number;
				changeSats: number;
				authNftOutputSats: number;
				encodedTxBytes: number;
				session: BcmrPublishSession;
				alreadyBuilt: boolean;
			};
			session = body.session;
			buildTxSummary = {
				feeSats: body.feeSats ?? 0,
				changeSats: body.changeSats ?? 0,
				authNftOutputSats: body.authNftOutputSats ?? 0,
				encodedTxBytes: body.encodedTxBytes ?? body.unsignedTxHex.length / 2
			};
		} catch (err) {
			buildTxError = (err as Error).message ?? 'Network error';
		} finally {
			buildingTx = false;
		}
	}

	async function runBroadcast() {
		const trimmed = signedTxHexInput.trim();
		if (!trimmed) {
			broadcastError = 'Paste the signed tx hex from your wallet first.';
			return;
		}
		if (!/^[0-9a-fA-F]+$/.test(trimmed) || trimmed.length % 2 !== 0) {
			broadcastError = 'Signed hex must be even-length and hex-only (0-9, a-f).';
			return;
		}
		broadcasting = true;
		broadcastError = null;
		try {
			const res = await fetch(`/api/bcmr/sessions/${session.id}/broadcast`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ signedTxHex: trimmed })
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { message?: string };
				broadcastError = body.message ?? `Broadcast failed (HTTP ${res.status})`;
				return;
			}
			const body = (await res.json()) as {
				txid: string;
				alreadyBroadcast: boolean;
				session?: BcmrPublishSession;
				persistRace?: boolean;
			};
			broadcastTxid = body.txid;
			if (body.session) session = body.session;
			step = 6;
		} catch (err) {
			broadcastError = (err as Error).message ?? 'Network error';
		} finally {
			broadcasting = false;
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
			<div class="mb-4 flex items-center gap-3">
				<label class="px-3 py-1.5 text-xs rounded border ts-border-strong hover:bg-slate-100 dark:hover:bg-zinc-900 cursor-pointer">
					📄 Upload BCMR JSON
					<input type="file" accept=".json" hidden onchange={async (e) => {
						const file = (e.currentTarget as HTMLInputElement).files?.[0];
						if (!file) return;
						try {
							const text = await file.text();
							const json = JSON.parse(text);
							const ident = json?.identities?.[Object.keys(json.identities ?? {})[0]]?.[Object.keys(json?.identities?.[Object.keys(json.identities ?? {})[0]] ?? {})[0]];
							if (ident) {
								if (ident.name) name = ident.name;
								if (ident.symbol) ticker = ident.symbol;
								if (typeof ident.decimals === 'number') decimals = ident.decimals;
								if (ident.description) description = ident.description;
								if (ident.uris?.icon) iconUri = ident.uris.icon;
							}
						} catch (err) {
							alert('Could not parse BCMR JSON: ' + (err as Error).message);
						}
					}} />
				</label>
				<span class="text-xs ts-text-muted">Pre-fills the form from an existing BCMR JSON file</span>
			</div>
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
						bytes to your own IPFS / Pinata / Lighthouse / HTTPS host. We'll fetch your URL on
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
				Upload the canonical JSON from step 3 to your own IPFS / Pinata / Lighthouse / any
				HTTPS host you control, then paste the URL here. <strong>Your own host stays the canonical
				source</strong> — it's what we'll commit on-chain.
			</p>

			<label class="block">
				<span class="text-sm font-medium ts-text-strong">Publication URL (https://)</span>
				<input
					type="url"
					maxlength="2048"
					bind:value={publicationUriInput}
					placeholder="https://your-host.example/path/to/bcmr.json"
					class="mt-1 w-full px-3 py-2 rounded-md border ts-border-strong ts-surface-input font-mono text-sm"
					disabled={!!session.publicationVerifiedAt}
				/>
				<span class="block mt-1 text-xs ts-text-muted">
					HTTPS only. If your host uses redirects, paste the final URL. Maximum 8 MiB body.
				</span>
			</label>

			<div class="mt-4 flex items-center gap-3">
				<button
					type="button"
					onclick={runVerify}
					disabled={verifying || !publicationUriInput.trim() || !!session.publicationVerifiedAt}
					class="px-4 py-2 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50"
				>
					{verifying ? 'Verifying…' : session.publicationVerifiedAt ? 'Verified ✓' : 'Verify my host'}
				</button>
				{#if session.publicationVerifiedAt}
					<span class="text-xs text-emerald-700 dark:text-emerald-400">
						Hosted bytes match the canonical content hash.
					</span>
				{/if}
			</div>

			{#if verifyResult && !verifyResult.ok}
				<div
					class="mt-4 p-3 rounded-md bg-rose-50 dark:bg-rose-950/30 text-sm text-rose-700 dark:text-rose-300"
					role="alert"
				>
					<strong>Verification failed:</strong>
					{verifyResult.message}
					{#if verifyResult.reason === 'hash-mismatch' && verifyResult.expected && verifyResult.observed}
						<div class="mt-2 font-mono text-[11px]">
							expected: {verifyResult.expected}<br />
							observed: {verifyResult.observed}
						</div>
						<div class="mt-2 text-xs">
							The bytes returned by your host don't match what step 3 canonicalized. Re-download
							the canonical JSON from step 3 and upload exactly those bytes (any whitespace
							difference changes the hash).
						</div>
					{/if}
				</div>
			{/if}

			{#if session.publicationVerifiedAt}
				<div class="mt-6 p-4 rounded-xl border ts-border-subtle bg-slate-50 dark:bg-zinc-900/50">
					<label class="flex items-start gap-3 cursor-pointer">
						<input
							type="checkbox"
							bind:checked={submitBackup}
							class="mt-0.5"
							disabled={submitBackupResult?.ok || submittingBackup}
						/>
						<span class="flex-1 text-sm">
							<strong class="ts-text-strong block">Optional: submit a backup copy to tokenstork.com.</strong>
							<span class="ts-text-muted">
								The bytes get content-addressed at
								<code class="text-xs">https://tokenstork.com/bcmr/&lt;hash&gt;.json</code> after operator
								approval, so consumers can fall back to our copy if your own host is ever unreachable.
								Your IPFS / HTTPS host remains the canonical source — this is just an additional mirror.
								Approval is operator-discretionary.
							</span>
						</span>
					</label>
					{#if submitBackup && !submitBackupResult?.ok}
						<button
							type="button"
							onclick={runSubmitBackup}
							disabled={submittingBackup}
							class="mt-3 px-3 py-1.5 rounded-md bg-slate-700 hover:bg-slate-800 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-white text-xs font-semibold disabled:opacity-50"
						>
							{submittingBackup ? 'Submitting…' : 'Submit backup for review'}
						</button>
					{/if}
					{#if submitBackupResult?.ok}
						<div class="mt-3 text-xs text-emerald-700 dark:text-emerald-400">
							✓ Backup submitted. The operator will review; approval is independent of the on-chain
							publication, which proceeds either way.
						</div>
					{:else if submitBackupResult && !submitBackupResult.ok}
						<div class="mt-3 text-xs text-rose-700 dark:text-rose-400">{submitBackupResult.message}</div>
					{/if}
				</div>
			{/if}
		{:else if step === 5}
			<h2 class="text-xl font-semibold ts-text-strong mb-2">5. Build & sign</h2>
			<p class="text-sm mb-5 ts-text-muted">
				We build the unsigned transaction that spends your category's authority NFT (at vout 0
				of the current authchain head), emits a new authority NFT to your wallet (preserving the
				NFT's commitment + capability), and attaches an
				<code class="text-xs">OP_RETURN BCMR</code>
				locator carrying your content hash + publication URL. You sign in your wallet, paste the
				signed hex back, and we broadcast.
			</p>

			{#if !session.unsignedTxHex && !buildTxSummary}
				<button
					type="button"
					onclick={runBuildTx}
					disabled={buildingTx}
					class="px-4 py-2 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50"
				>
					{buildingTx ? 'Building…' : 'Build unsigned tx'}
				</button>
			{/if}

			{#if buildTxError}
				<p class="mt-4 text-sm text-rose-600 dark:text-rose-400" role="alert">{buildTxError}</p>
			{/if}

			{#if session.unsignedTxHex || buildTxSummary}
				<div class="space-y-4">
					{#if buildTxSummary}
						<div class="p-3 rounded-md bg-slate-50 dark:bg-zinc-900/50 text-sm">
							<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
								<div>
									<div class="text-xs ts-text-muted">authNFT (new)</div>
									<div class="font-mono ts-text-strong">{buildTxSummary.authNftOutputSats} sats</div>
								</div>
								<div>
									<div class="text-xs ts-text-muted">Fee</div>
									<div class="font-mono ts-text-strong">{buildTxSummary.feeSats} sats</div>
								</div>
								<div>
									<div class="text-xs ts-text-muted">Change</div>
									<div class="font-mono ts-text-strong">{buildTxSummary.changeSats} sats</div>
								</div>
								<div>
									<div class="text-xs ts-text-muted">Tx size</div>
									<div class="font-mono ts-text-strong">{buildTxSummary.encodedTxBytes} B</div>
								</div>
							</div>
						</div>
					{/if}

					<div>
						<div class="flex items-center justify-between mb-1">
							<div class="text-sm font-medium ts-text-strong">Unsigned transaction hex</div>
							<button
								type="button"
								onclick={() => session.unsignedTxHex && copyToClipboard(session.unsignedTxHex)}
								class="px-3 py-1 rounded-md border ts-border-strong text-xs hover:bg-slate-50 dark:hover:bg-zinc-800"
							>
								Copy
							</button>
						</div>
						<pre
							class="px-3 py-2 rounded-md bg-slate-100 dark:bg-zinc-800 font-mono text-[11px] max-h-32 overflow-auto break-all"
						>{session.unsignedTxHex}</pre>
						<p class="mt-2 text-xs ts-text-muted">
							Sign this hex in your wallet (Paytaca, Electron Cash, Cashonize, etc. — any wallet that
							supports paste-and-sign). Then paste the signed hex below.
						</p>
					</div>

					<div>
						<label class="block">
							<span class="text-sm font-medium ts-text-strong">Signed transaction hex</span>
							<textarea
								rows="4"
								bind:value={signedTxHexInput}
								placeholder="Paste signed hex from your wallet here…"
								class="mt-1 w-full px-3 py-2 rounded-md border ts-border-strong ts-surface-input font-mono text-xs"
							></textarea>
						</label>
						<button
							type="button"
							onclick={runBroadcast}
							disabled={broadcasting || !signedTxHexInput.trim()}
							class="mt-3 px-4 py-2 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50"
						>
							{broadcasting ? 'Broadcasting…' : 'Broadcast →'}
						</button>
					</div>
				</div>
			{/if}

			{#if broadcastError}
				<p class="mt-4 text-sm text-rose-600 dark:text-rose-400" role="alert">{broadcastError}</p>
			{/if}
		{:else if step === 6}
			<h2 class="text-xl font-semibold ts-text-strong mb-2">6. Done — published on-chain</h2>
			{#if broadcastTxid || session.publishTxidHex}
				{@const txid = broadcastTxid ?? session.publishTxidHex}
				<div class="space-y-4">
					<div class="p-4 rounded-xl border ts-border-subtle bg-emerald-50 dark:bg-emerald-950/30">
						<div class="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
							✓ BCMR publication broadcast.
						</div>
						<p class="mt-2 text-sm ts-text-body">
							The transaction is in the mempool. Our on-chain BCMR walker runs hourly — your
							token's name, symbol, icon, and description will start appearing on the directory
							within ~1 hour of the next walker tick after this tx confirms.
						</p>
					</div>

					<div>
						<div class="text-sm font-medium ts-text-strong mb-1">Transaction ID</div>
						<div class="flex items-center gap-2">
							<code class="flex-1 px-3 py-2 rounded-md bg-slate-100 dark:bg-zinc-800 font-mono text-xs break-all">
								{txid}
							</code>
							<button
								type="button"
								onclick={() => txid && copyToClipboard(txid)}
								class="px-3 py-2 rounded-md border ts-border-strong text-xs hover:bg-slate-50 dark:hover:bg-zinc-800"
							>
								Copy
							</button>
						</div>
					</div>

					<div class="flex items-center gap-3 flex-wrap text-sm">
						<a
							href={`/token/${session.categoryHex}`}
							class="px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-700 text-white font-semibold"
						>
							View your token →
						</a>
						<a href="/publish-bcmr" class="text-violet-600 dark:text-violet-400 hover:underline">
							Publish for another category
						</a>
						<a href="/faq#faq-bcmr-publish" class="ml-auto text-xs ts-text-muted hover:text-violet-600">
							How this works ↗
						</a>
					</div>
				</div>
			{:else}
				<p class="text-sm ts-text-muted">
					This step shows after a successful broadcast. Complete step 5 first.
				</p>
			{/if}
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
				{:else if step === 4}
					<button
						type="button"
						onclick={() => session.publicationVerifiedAt && (step = 5)}
						disabled={!session.publicationVerifiedAt}
						class="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
					>
						Next →
					</button>
				{:else if step === 5}
					<!-- Step 5 advances via the broadcast button itself (which jumps to step 6 on success); no separate Next button needed -->
					<span></span>
				{:else if step === 6}
					<!-- Final step; advance UX is the "View your token" link in the success card -->
					<span></span>
				{/if}
			</div>
		</div>

		{#if abandonError}
			<p class="mt-3 text-sm text-rose-600 dark:text-rose-400">{abandonError}</p>
		{/if}
	</div>
</div>
