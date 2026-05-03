<script lang="ts">
	// Airdrop wizard — full flow.
	//
	//   1 source  — pick the token to airdrop (defaults from ?source=).
	//   2 target  — pick the recipient token (its holders are the recipients).
	//   3 amount  — total + split mode (equal / weighted) + advanced dust.
	//   4 review  — server returns first chunk's unsigned hex; preview cost.
	//   5 sign    — wallet signs each chunk (paste-signed-hex), tx broadcasts,
	//               wizard auto-advances to next chunk until done.
	//
	// Architectural pattern (chunk-then-sign loop, OP_RETURN audit prefix)
	// derived from mainnet-pat/dropship.cash analysis — pattern only, no
	// source copied. Tx construction is libauth-direct via our own
	// /api/airdrops endpoint; the browser only signs + posts.

	import { goto } from '$app/navigation';
	import { iconHrefFor } from '$lib/icons';

	let { data } = $props();
	type MyToken = (typeof data.myTokens)[number];
	type SearchHit = {
		categoryHex: string;
		tokenType: 'FT' | 'NFT' | 'FT+NFT';
		name: string | null;
		symbol: string | null;
		decimals: number;
		iconUri: string | null;
		iconClearedHash: string | null;
		holderCount: number | null;
	};

	type Step = 1 | 2 | 3 | 4 | 5;
	// Initial-only reads of data — the SvelteKit load runs once on
	// mount and we don't navigate inside the wizard. Wrapped in
	// helper functions to satisfy svelte-check's "did you mean a
	// derived?" warning.
	function initialSource() {
		return data.preselectedSource;
	}
	function initialRecipient() {
		return data.preselectedRecipient;
	}
	// Starting step:
	//   - both preselected → 3 (skip both pickers)
	//   - source only      → 2 (recipient picker)
	//   - recipient only   → 1 (source picker — most common, from the
	//                            "Airdrop to holders" CTA)
	//   - neither          → 1
	let step = $state<Step>(
		initialSource() && initialRecipient() ? 3 : initialSource() ? 2 : 1
	);

	// Step 1: source token (the one being airdropped).
	let sourceCategoryHex = $state(initialSource()?.categoryHex ?? '');
	let sourceName = $state<string | null>(initialSource()?.name ?? null);
	let sourceSymbol = $state<string | null>(initialSource()?.symbol ?? null);
	let sourceDecimals = $state(initialSource()?.decimals ?? 0);
	let sourceBalanceBaseUnits = $state(initialSource()?.balance ?? '0');
	let sourceLookupError = $state<string | null>(null);

	// Step 2: recipient token (whose holders receive). Pre-filled when
	// the user arrived from a /token/<hex> "Airdrop to holders" CTA;
	// otherwise filled by the search-bar typeahead.
	let recipientCategoryHex = $state(initialRecipient()?.categoryHex ?? '');
	let recipientName = $state<string | null>(initialRecipient()?.name ?? null);
	let recipientSymbol = $state<string | null>(initialRecipient()?.symbol ?? null);
	let recipientHolderCount = $state<number | null>(
		initialRecipient()?.holderCount ?? null
	);
	let recipientLookupError = $state<string | null>(null);
	let recipientSearchTerm = $state('');
	let recipientSearchHits = $state<SearchHit[]>([]);
	let recipientSearchBusy = $state(false);
	let recipientSearchDebounce: ReturnType<typeof setTimeout> | null = null;

	// Step 3: amount + split mode.
	let mode = $state<'equal' | 'weighted'>('equal');
	let totalDisplay = $state('');
	let outputValueSats = $state(800);
	let advancedOpen = $state(false);

	// Step 4-5: server build + per-chunk signing.
	type ChunkPayload = {
		txIndex: number;
		unsignedTxHex: string;
		sourceOutputs: unknown[];
		feeSats: number;
		recipientCount: number;
		encodedTxBytes: number;
	};
	let airdropId = $state<string | null>(null);
	let txCount = $state(0);
	let activeChunk = $state<ChunkPayload | null>(null);
	let signedHexInput = $state('');
	let broadcasting = $state(false);
	let broadcastError = $state<string | null>(null);
	let creating = $state(false);
	let createError = $state<string | null>(null);
	const chunksDone = $state<{ txIndex: number; txid: string }[]>([]);

	// Helpers
	const totalBaseUnits = $derived.by(() => {
		const t = totalDisplay.trim();
		if (!t) return 0n;
		try {
			const [whole, frac = ''] = t.split('.');
			const padded = (frac + '0'.repeat(sourceDecimals)).slice(0, sourceDecimals);
			const composed = (whole || '0') + padded;
			return BigInt(composed);
		} catch {
			return 0n;
		}
	});

	const totalExceedsBalance = $derived(totalBaseUnits > BigInt(sourceBalanceBaseUnits));
	const sourceBalanceDisplay = $derived(formatBaseUnits(sourceBalanceBaseUnits, sourceDecimals));

	function formatBaseUnits(baseUnits: string | bigint, dec: number): string {
		const big = typeof baseUnits === 'bigint' ? baseUnits : BigInt(baseUnits);
		if (dec === 0) return big.toString();
		const s = big.toString().padStart(dec + 1, '0');
		const whole = s.slice(0, -dec);
		const frac = s.slice(-dec).replace(/0+$/, '');
		return frac.length === 0 ? whole : `${whole}.${frac}`;
	}

	function pickSource(t: MyToken) {
		sourceLookupError = null;
		sourceCategoryHex = t.categoryHex;
		sourceName = t.name;
		sourceSymbol = t.symbol;
		sourceDecimals = t.decimals;
		sourceBalanceBaseUnits = t.balance;
		// If recipient is already pre-selected (came from a /token/<hex>
		// "Airdrop to holders" CTA), skip step 2 entirely and land on
		// the amount-picker.
		step = recipientCategoryHex ? 3 : 2;
	}

	function pickRecipient(hit: SearchHit) {
		recipientLookupError = null;
		recipientCategoryHex = hit.categoryHex;
		recipientName = hit.name;
		recipientSymbol = hit.symbol;
		recipientHolderCount = hit.holderCount ?? null;
		recipientSearchHits = [];
		recipientSearchTerm = hit.symbol ?? hit.name ?? hit.categoryHex.slice(0, 16) + '…';
	}

	function onRecipientSearchInput(value: string) {
		recipientSearchTerm = value;
		// Clearing the box also clears the previous selection.
		if (value.trim().length === 0) {
			recipientCategoryHex = '';
			recipientName = null;
			recipientSymbol = null;
			recipientHolderCount = null;
			recipientSearchHits = [];
			return;
		}
		if (recipientSearchDebounce) clearTimeout(recipientSearchDebounce);
		recipientSearchDebounce = setTimeout(async () => {
			const term = value.trim();
			if (term.length < 2) {
				recipientSearchHits = [];
				return;
			}
			recipientSearchBusy = true;
			try {
				const res = await fetch(
					`/api/tokens/search?q=${encodeURIComponent(term)}`
				);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const body = await res.json();
				recipientSearchHits = body.tokens ?? [];
			} catch (err) {
				recipientLookupError = (err as Error).message;
				recipientSearchHits = [];
			} finally {
				recipientSearchBusy = false;
			}
		}, 250);
	}

	async function createAirdrop() {
		creating = true;
		createError = null;
		try {
			const res = await fetch('/api/airdrops', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					sourceCategory: sourceCategoryHex,
					recipientCategory: recipientCategoryHex,
					mode,
					totalAmount: totalBaseUnits.toString(),
					outputValueSats
				})
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.message ?? `HTTP ${res.status}`);
			}
			const body = await res.json();
			airdropId = body.airdropId;
			txCount = body.txCount;
			activeChunk = body.firstChunk;
			step = 5;
		} catch (err) {
			createError = (err as Error).message;
		} finally {
			creating = false;
		}
	}

	async function broadcastChunk() {
		if (!activeChunk || !airdropId) return;
		broadcasting = true;
		broadcastError = null;
		const hex = signedHexInput.trim().toLowerCase();
		if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) {
			broadcastError = 'Signed hex must be even-length hex.';
			broadcasting = false;
			return;
		}
		try {
			const res = await fetch(`/api/airdrops/${airdropId}/broadcast`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ txIndex: activeChunk.txIndex, signedHex: hex })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.message ?? `HTTP ${res.status}`);
			}
			const body = await res.json();
			chunksDone.push({ txIndex: activeChunk.txIndex, txid: body.txid });
			signedHexInput = '';
			if (body.snapshotAdvanced) {
				broadcastError = 'Recipient holder set changed mid-airdrop. Halting; visit the receipt page to redraft remaining chunks.';
				activeChunk = null;
				return;
			}
			if (body.nextChunk) {
				activeChunk = body.nextChunk;
			} else {
				// All done — go to receipt page.
				goto(`/airdrops/${airdropId}`);
			}
		} catch (err) {
			broadcastError = (err as Error).message;
		} finally {
			broadcasting = false;
		}
	}

	function step1Valid() {
		return /^[0-9a-fA-F]{64}$/.test(sourceCategoryHex) && BigInt(sourceBalanceBaseUnits) > 0n;
	}
	function step2Valid() {
		return /^[0-9a-fA-F]{64}$/.test(recipientCategoryHex) && (recipientHolderCount ?? 0) > 0;
	}
	function step3Valid() {
		return totalBaseUnits > 0n && !totalExceedsBalance;
	}
</script>

<svelte:head>
	<title>Airdrop — Token Stork</title>
</svelte:head>

<div class="max-w-3xl mx-auto px-4 py-8">
	<h1 class="text-3xl font-bold mb-1 text-slate-900 dark:text-white">
		Airdrop CashTokens
	</h1>
	<p class="ts-text-muted mb-6">
		Send tokens you hold to every wallet that holds another token. Equal split or proportional to
		recipient holdings. Built on local <code>token_holders</code> data — no third-party indexer
		queries.
	</p>

	<!-- Alpha-tooling disclaimer (rendered every step). -->
	<div
		class="mb-4 px-4 py-3 rounded-lg border bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/40 text-sm text-amber-800 dark:text-amber-200"
		role="note"
	>
		<strong>Alpha tooling — use at your own risk.</strong> Airdrops construct + broadcast real BCH
		transactions through libauth-direct code that has not been independently audited. Test with a
		low-stakes source token + a small recipient set first; verify every output in your wallet's
		pre-sign review; accept that bugs are possible. The operator makes no warranty as to correctness
		or against partial-broadcast outcomes. See the
		<a href="/terms#tools-alpha" class="underline">Terms</a> for the full disclaimer.
	</div>

	<!-- Privacy disclosure (rendered every step). -->
	<div
		class="mb-6 px-3 py-2 rounded-lg border ts-border-subtle bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-200"
		role="note"
	>
		<strong>Heads up:</strong> the airdrop transaction reveals your wallet to every recipient via
		the tx-input. Your sender PKH is visible in any block explorer. This is how UTXO transactions
		work; we just want you to know.
	</div>

	<!-- Step indicator. -->
	<ol class="flex items-center text-xs mb-6 gap-1 ts-text-muted">
		{#each [1, 2, 3, 4, 5] as n (n)}
			<li
				class={`flex items-center gap-1 ${n === step ? 'text-violet-600 dark:text-violet-400 font-semibold' : ''}`}
			>
				<span
					class={`inline-flex items-center justify-center w-5 h-5 rounded-full border ${n <= step ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/40' : 'border-slate-300 dark:border-zinc-700'}`}
				>{n}</span>
				<span class="hidden sm:inline">{['Source', 'Target', 'Amount', 'Review', 'Sign'][n - 1]}</span>
				{#if n < 5}<span class="px-1">→</span>{/if}
			</li>
		{/each}
	</ol>

	{#if step === 1}
		<section class="rounded-xl border ts-border-subtle p-5 ts-surface-panel">
			<h2 class="text-lg font-semibold mb-3 ts-text-strong">1. Source token</h2>
			<p class="text-sm ts-text-muted mb-3">Which of YOUR tokens are you airdropping?</p>

			{#if data.myTokens.length === 0}
				<div class="px-4 py-3 rounded-lg border ts-border-subtle text-sm ts-text-muted">
					Your wallet doesn't currently hold any non-moderated CashTokens. Receive
					some on this address (or wait for the next 6h enrich tick if you just
					received a token) and come back.
				</div>
			{:else}
				<p class="text-xs ts-text-muted mb-2">
					{data.myTokens.length} category{data.myTokens.length === 1 ? '' : 's'} in your
					wallet. Click one to airdrop:
				</p>
				<div class="rounded border ts-border-subtle max-h-96 overflow-y-auto">
					<ul class="divide-y ts-border-subtle">
						{#each data.myTokens as t (t.categoryHex)}
							<li>
								<button
									type="button"
									class="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-zinc-900/50 flex items-center gap-3"
									onclick={() => pickSource(t)}
								>
									<img
										src={iconHrefFor(t.iconUri, t.iconClearedHash)}
										alt=""
										class="w-7 h-7 rounded-full ts-surface-chip flex-none"
										loading="lazy"
									/>
									<div class="min-w-0 flex-1">
										<div class="text-sm font-semibold truncate">
											{t.name ?? t.symbol ?? t.categoryHex.slice(0, 16) + '…'}
											{#if t.symbol && t.name}<span class="ml-2 text-xs ts-text-muted font-mono">{t.symbol}</span>{/if}
										</div>
										<div class="text-xs ts-text-muted font-mono truncate">{t.categoryHex.slice(0, 32)}…</div>
									</div>
									<div class="text-right text-xs flex-none">
										<div class="font-mono">
											{(() => {
												const big = BigInt(t.balance);
												if (t.decimals === 0) return big.toLocaleString('en-US');
												const padded = big.toString().padStart(t.decimals + 1, '0');
												const whole = padded.slice(0, -t.decimals);
												const frac = padded.slice(-t.decimals).replace(/0+$/, '');
												return frac.length === 0 ? whole : `${whole}.${frac.slice(0, 4)}`;
											})()}
										</div>
										<div class="ts-text-muted">
											{t.tokenType}{t.nftCount > 0 ? ` · ${t.nftCount} NFT${t.nftCount === 1 ? '' : 's'}` : ''}
										</div>
									</div>
								</button>
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			<details class="mt-4 text-xs ts-text-muted">
				<summary class="cursor-pointer">Or paste a category hex directly</summary>
				<div class="mt-2 flex gap-2">
					<input
						type="text"
						class="flex-1 px-3 py-2 rounded border ts-border-subtle font-mono text-sm bg-white dark:bg-zinc-900"
						bind:value={sourceCategoryHex}
						placeholder="64-character hex"
					/>
					<button
						type="button"
						class="px-3 py-2 rounded bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50"
						disabled={!/^[0-9a-fA-F]{64}$/.test(sourceCategoryHex.trim())}
						onclick={async () => {
							sourceLookupError = null;
							const hex = sourceCategoryHex.trim().toLowerCase();
							try {
								const res = await fetch(`/api/tokens/${hex}/eligibility`);
								if (res.status === 410) {
									sourceLookupError = "You don't currently hold this token.";
									return;
								}
								if (!res.ok) throw new Error(`HTTP ${res.status}`);
								const body = await res.json();
								sourceName = body.name;
								sourceSymbol = body.symbol;
								sourceDecimals = body.decimals ?? 0;
								sourceBalanceBaseUnits = body.balance;
								sourceCategoryHex = hex;
								step = 2;
							} catch (err) {
								sourceLookupError = (err as Error).message;
							}
						}}
					>
						Use →
					</button>
				</div>
				{#if sourceLookupError}
					<p class="mt-2 text-rose-600 dark:text-rose-400">{sourceLookupError}</p>
				{/if}
			</details>
		</section>
	{:else if step === 2}
		<section class="rounded-xl border ts-border-subtle p-5 ts-surface-panel">
			<h2 class="text-lg font-semibold mb-3 ts-text-strong">2. Recipient token</h2>
			<p class="text-sm ts-text-muted mb-3">
				Source: <span class="font-mono text-xs">{sourceSymbol ?? sourceName ?? sourceCategoryHex.slice(0, 16) + '…'}</span>
				· your balance: <span class="font-mono">{sourceBalanceDisplay}</span>
			</p>
			<p class="text-sm ts-text-muted mb-3">
				Whose holders should receive? Type a name, symbol, or paste a category hex.
				They'll all get a share of your tokens.
			</p>
			<label class="block text-xs font-medium ts-text-muted mb-1" for="rcpt">Search by name, symbol, or hex</label>
			<input
				id="rcpt"
				type="text"
				class="w-full px-3 py-2 rounded border ts-border-subtle text-sm bg-white dark:bg-zinc-900"
				value={recipientSearchTerm}
				oninput={(e) => onRecipientSearchInput((e.currentTarget as HTMLInputElement).value)}
				placeholder="e.g. CASHEX, GRIM, 4091f9a6…"
				autocomplete="off"
			/>
			{#if recipientSearchBusy}
				<p class="mt-1 text-xs ts-text-muted">Searching…</p>
			{/if}
			{#if recipientSearchHits.length > 0}
				<div class="mt-2 rounded border ts-border-subtle max-h-72 overflow-y-auto">
					<ul class="divide-y ts-border-subtle">
						{#each recipientSearchHits as hit (hit.categoryHex)}
							<li>
								<button
									type="button"
									class="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-zinc-900/50 flex items-center gap-3"
									onclick={() => pickRecipient(hit)}
								>
									<img
										src={iconHrefFor(hit.iconUri, hit.iconClearedHash)}
										alt=""
										class="w-7 h-7 rounded-full ts-surface-chip flex-none"
										loading="lazy"
									/>
									<div class="min-w-0 flex-1">
										<div class="text-sm font-semibold truncate">
											{hit.name ?? hit.symbol ?? hit.categoryHex.slice(0, 16) + '…'}
											{#if hit.symbol && hit.name}<span class="ml-2 text-xs ts-text-muted font-mono">{hit.symbol}</span>{/if}
										</div>
										<div class="text-xs ts-text-muted font-mono truncate">{hit.categoryHex.slice(0, 32)}…</div>
									</div>
									<div class="text-right text-xs flex-none">
										<div class="font-mono">{hit.holderCount?.toLocaleString() ?? '—'} holders</div>
										<div class="ts-text-muted">{hit.tokenType}</div>
									</div>
								</button>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
			{#if recipientCategoryHex && recipientHolderCount != null}
				<div class="mt-3 p-3 rounded border ts-border-subtle bg-slate-50 dark:bg-zinc-900/30 text-sm">
					Selected: <strong>{recipientName ?? recipientSymbol ?? recipientCategoryHex.slice(0, 16) + '…'}</strong>
					· {recipientHolderCount.toLocaleString()} holders will receive
				</div>
			{/if}
			{#if recipientLookupError}
				<p class="mt-2 text-sm text-rose-600 dark:text-rose-400">{recipientLookupError}</p>
			{/if}
			<div class="mt-4 flex justify-between">
				<button type="button" class="px-3 py-2 text-sm ts-text-muted" onclick={() => (step = 1)}>← Back</button>
				<button
					type="button"
					class="px-4 py-2 rounded bg-violet-600 hover:bg-violet-700 text-white font-semibold disabled:opacity-50"
					disabled={!step2Valid()}
					onclick={() => (step = 3)}
				>
					Continue →
				</button>
			</div>
		</section>
	{:else if step === 3}
		<section class="rounded-xl border ts-border-subtle p-5 ts-surface-panel">
			<h2 class="text-lg font-semibold mb-3 ts-text-strong">3. Amount + split</h2>

			<label class="block text-xs font-medium ts-text-muted mb-1" for="ad-total">Total to airdrop</label>
			<div class="flex gap-2 items-center mb-1">
				<input
					id="ad-total"
					type="text"
					class="flex-1 px-3 py-2 rounded border ts-border-subtle font-mono text-sm bg-white dark:bg-zinc-900"
					bind:value={totalDisplay}
					placeholder="0.0"
				/>
				<span class="text-sm ts-text-muted">{sourceSymbol ?? 'tokens'}</span>
			</div>
			<p class="text-xs ts-text-muted mb-3">
				Your balance: <span class="font-mono">{sourceBalanceDisplay}</span>
				· Recipients: <span class="font-mono">{recipientHolderCount}</span>
				{#if totalExceedsBalance}<span class="ml-2 text-rose-600 dark:text-rose-400">exceeds balance</span>{/if}
			</p>

			<fieldset class="mb-3">
				<legend class="block text-xs font-medium ts-text-muted mb-1">Split mode</legend>
				<div class="flex gap-2">
					<label class="flex-1" for="ad-mode-equal">
						<input id="ad-mode-equal" type="radio" bind:group={mode} value="equal" class="sr-only" />
						<div
							class={`px-3 py-2 rounded border cursor-pointer ${mode === 'equal' ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/40' : 'ts-border-subtle'}`}
						>
							<div class="text-sm font-semibold">Equal</div>
							<div class="text-xs ts-text-muted">Every holder gets the same amount.</div>
						</div>
					</label>
					<label class="flex-1" for="ad-mode-weighted">
						<input id="ad-mode-weighted" type="radio" bind:group={mode} value="weighted" class="sr-only" />
						<div
							class={`px-3 py-2 rounded border cursor-pointer ${mode === 'weighted' ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/40' : 'ts-border-subtle'}`}
						>
							<div class="text-sm font-semibold">Weighted</div>
							<div class="text-xs ts-text-muted">
								Proportional to each holder's balance + NFT count of the recipient token.
							</div>
						</div>
					</label>
				</div>
			</fieldset>

			<button
				type="button"
				class="text-xs ts-text-muted underline"
				onclick={() => (advancedOpen = !advancedOpen)}
			>
				{advancedOpen ? '▾' : '▸'} Advanced
			</button>
			{#if advancedOpen}
				<div class="mt-2 px-3 py-2 rounded border ts-border-subtle bg-slate-50 dark:bg-zinc-900/50">
					<label class="block text-xs font-medium ts-text-muted mb-1" for="ad-dust">
						BCH dust per recipient output (sats)
					</label>
					<input
						id="ad-dust"
						type="number"
						min="546"
						max="2000"
						step="1"
						class="w-32 px-2 py-1 rounded border ts-border-subtle font-mono text-sm bg-white dark:bg-zinc-900"
						bind:value={outputValueSats}
					/>
					<p class="text-xs ts-text-muted mt-1">
						Default 800. Below 800: recipients may need to add their own funding to spend
						the token UTXO. Below 546: rejected by standard relays.
					</p>
				</div>
			{/if}

			<div class="mt-4 flex justify-between">
				<button type="button" class="px-3 py-2 text-sm ts-text-muted" onclick={() => (step = 2)}>← Back</button>
				<button
					type="button"
					class="px-4 py-2 rounded bg-violet-600 hover:bg-violet-700 text-white font-semibold disabled:opacity-50"
					disabled={!step3Valid()}
					onclick={() => (step = 4)}
				>
					Review →
				</button>
			</div>
		</section>
	{:else if step === 4}
		<section class="rounded-xl border ts-border-subtle p-5 ts-surface-panel">
			<h2 class="text-lg font-semibold mb-3 ts-text-strong">4. Review</h2>
			<dl class="space-y-2 text-sm">
				<div class="flex justify-between">
					<dt class="ts-text-muted">From</dt>
					<dd class="font-mono">{sourceSymbol ?? sourceName ?? sourceCategoryHex.slice(0, 16) + '…'}</dd>
				</div>
				<div class="flex justify-between">
					<dt class="ts-text-muted">To holders of</dt>
					<dd class="font-mono">{recipientName ?? recipientCategoryHex.slice(0, 16) + '…'}</dd>
				</div>
				<div class="flex justify-between">
					<dt class="ts-text-muted">Recipients</dt>
					<dd class="font-mono">{recipientHolderCount}</dd>
				</div>
				<div class="flex justify-between">
					<dt class="ts-text-muted">Total to send</dt>
					<dd class="font-mono">{formatBaseUnits(totalBaseUnits, sourceDecimals)} {sourceSymbol ?? ''}</dd>
				</div>
				<div class="flex justify-between">
					<dt class="ts-text-muted">Split mode</dt>
					<dd class="font-mono">{mode}</dd>
				</div>
				<div class="flex justify-between">
					<dt class="ts-text-muted">BCH per recipient</dt>
					<dd class="font-mono">{outputValueSats} sats</dd>
				</div>
			</dl>
			{#if createError}
				<p class="mt-3 text-sm text-rose-600 dark:text-rose-400">{createError}</p>
			{/if}
			<div class="mt-4 flex justify-between">
				<button type="button" class="px-3 py-2 text-sm ts-text-muted" onclick={() => (step = 3)}>← Back</button>
				<button
					type="button"
					class="px-4 py-2 rounded bg-violet-600 hover:bg-violet-700 text-white font-semibold disabled:opacity-50"
					disabled={creating}
					onclick={createAirdrop}
				>
					{creating ? 'Drafting…' : 'Confirm + draft →'}
				</button>
			</div>
		</section>
	{:else if step === 5}
		<section class="rounded-xl border ts-border-subtle p-5 ts-surface-panel">
			<h2 class="text-lg font-semibold mb-3 ts-text-strong">5. Sign + broadcast</h2>
			<p class="text-sm ts-text-muted mb-3">
				Airdrop ID: <span class="font-mono text-xs">{airdropId}</span>
				· {chunksDone.length} of {txCount} broadcast
			</p>

			{#if activeChunk}
				<div class="mb-3 px-3 py-2 rounded border ts-border-subtle bg-slate-50 dark:bg-zinc-900/50 text-xs">
					<strong>Tx {activeChunk.txIndex + 1} of {txCount}</strong> · {activeChunk.recipientCount}
					recipients · estimated fee {activeChunk.feeSats} sats · {activeChunk.encodedTxBytes}B
				</div>
				<details class="mb-3">
					<summary class="text-xs ts-text-muted cursor-pointer">Unsigned hex (copy to your wallet)</summary>
					<textarea
						readonly
						rows="4"
						class="mt-2 w-full px-2 py-1 font-mono text-[11px] rounded border ts-border-subtle bg-white dark:bg-zinc-900"
					>{activeChunk.unsignedTxHex}</textarea>
				</details>
				<label class="block text-xs font-medium ts-text-muted mb-1" for="ad-signed">
					Signed hex (paste from your wallet)
				</label>
				<textarea
					id="ad-signed"
					rows="4"
					class="w-full px-2 py-1 font-mono text-[11px] rounded border ts-border-subtle bg-white dark:bg-zinc-900"
					bind:value={signedHexInput}
					placeholder="Paste the signed transaction hex here"
				></textarea>
				{#if broadcastError}
					<p class="mt-2 text-sm text-rose-600 dark:text-rose-400">{broadcastError}</p>
				{/if}
				<div class="mt-3 flex justify-end">
					<button
						type="button"
						class="px-4 py-2 rounded bg-violet-600 hover:bg-violet-700 text-white font-semibold disabled:opacity-50"
						disabled={broadcasting || !signedHexInput.trim()}
						onclick={broadcastChunk}
					>
						{broadcasting ? 'Broadcasting…' : 'Broadcast'}
					</button>
				</div>
			{/if}

			{#if chunksDone.length > 0}
				<h3 class="mt-6 mb-2 text-sm font-semibold ts-text-strong">Broadcast so far</h3>
				<ul class="text-xs space-y-1">
					{#each chunksDone as c (c.txIndex)}
						<li class="font-mono">Tx {c.txIndex + 1}: <span class="text-emerald-600 dark:text-emerald-400">{c.txid.slice(0, 16)}…</span></li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</div>
