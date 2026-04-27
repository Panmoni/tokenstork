<script lang="ts">
	// Batch 1 of the mint wizard (item #28): foundation only.
	//
	// Wires up the 5-step UX scaffolding so subsequent batches can drop in:
	//   - Batch 2: libauth genesis-tx builder + Step 4 review with computed
	//     fees/category-id preview
	//   - Batch 3: WalletConnect signing + broadcast endpoint
	//   - Batch 4: BCMR JSON publication options (self-host / IPFS / Paytaca PR)
	//   - Batch 5: icon staging pipeline + heavy-duty review + deploy
	//
	// State machine for the wizard:
	//   1 type      — radio between FT / NFT / FT+NFT
	//   2 identity  — name, ticker, decimals, description, icon
	//   3 supply    — FT total / NFT commitment+capability (depending on type)
	//   4 review    — show genesis tx + computed cost (Batch 2)
	//   5 sign+bcst — WalletConnect handoff (Batch 3)
	//
	// Step state lives in browser memory for now; batch 2 hydrates from
	// `user_mint_sessions` so a refresh resumes where the user left off.

	let { data } = $props();

	type TokenType = 'FT' | 'NFT' | 'FT+NFT';
	type NftCapability = 'none' | 'mutable' | 'minting';

	// Wizard step (1-5). Forward-only navigation enforced by the per-step
	// `canAdvance` derived: each step gates its own "Next" button on the
	// minimum data for that step having been entered.
	let step = $state(1);

	// Step 1: type.
	let tokenType = $state<TokenType | null>(null);

	// Step 2: identity.
	let ticker = $state('');
	let name = $state('');
	let description = $state('');
	let decimals = $state<number>(0);

	// Step 3: supply (FT) / commitment (NFT) / both (FT+NFT).
	let totalSupply = $state('');
	let nftCommitmentHex = $state('');
	let nftCapability = $state<NftCapability>('none');

	// Per-step validation. Returning a string from any of these surfaces
	// the message in the UI; null means "this step is good to advance."
	const step1Error = $derived.by(() => {
		if (!tokenType) return 'Pick a token type to continue.';
		return null;
	});
	const step2Error = $derived.by(() => {
		if (!name.trim()) return 'A name is required.';
		if (!ticker.trim()) return 'A ticker is required.';
		if (ticker.trim().length > 12) return 'Ticker must be 12 characters or fewer.';
		if (tokenType !== 'NFT') {
			if (decimals < 0 || decimals > 8) return 'Decimals must be 0–8 per CashTokens spec.';
		}
		return null;
	});
	const step3Error = $derived.by(() => {
		if (tokenType === 'FT' || tokenType === 'FT+NFT') {
			if (!totalSupply.trim()) return 'Total supply is required for fungible tokens.';
			try {
				const big = BigInt(totalSupply);
				if (big <= 0n) return 'Total supply must be positive.';
			} catch {
				return 'Total supply must be a whole number.';
			}
		}
		if (tokenType === 'NFT' || tokenType === 'FT+NFT') {
			if (nftCommitmentHex && !/^[0-9a-fA-F]*$/.test(nftCommitmentHex)) {
				return 'NFT commitment must be hex (0-9, a-f).';
			}
			if (nftCommitmentHex.length > 80) {
				return 'NFT commitment max 40 bytes (80 hex chars).';
			}
		}
		return null;
	});

	function next() {
		if (step === 1 && step1Error) return;
		if (step === 2 && step2Error) return;
		if (step === 3 && step3Error) return;
		step = Math.min(step + 1, 5);
	}
	function back() {
		step = Math.max(step - 1, 1);
	}
	function jumpTo(target: number) {
		// Allow free backward navigation; forward navigation only if all
		// intermediate steps are valid.
		if (target < step) {
			step = target;
			return;
		}
		// Forward jump: walk validators in order.
		for (let s = step; s < target; s++) {
			if (s === 1 && step1Error) return;
			if (s === 2 && step2Error) return;
			if (s === 3 && step3Error) return;
		}
		step = target;
	}

	const stepLabels = ['Type', 'Identity', 'Supply', 'Review', 'Sign & broadcast'];
</script>

<svelte:head>
	<title>Mint a CashToken — Token Stork</title>
	<meta
		name="description"
		content="Mint your own BCH CashToken (FT, NFT, or hybrid) directly from your wallet."
	/>
</svelte:head>

<main class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<div class="mb-8">
		<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent">
			Mint a CashToken
		</h1>
		<p class="text-slate-600 dark:text-slate-400 mt-2 max-w-2xl">
			Create your own fungible token, NFT, or hybrid on the Bitcoin Cash chain. Walk through the
			five-step wizard, sign the genesis transaction with your wallet, and your category appears
			on the directory within minutes.
		</p>
	</div>

	{#if data.unauthenticated}
		<!--
			Auth gate. We don't redirect — the page sells the feature first
			(why this requires a wallet, what the user is signing) before
			pushing them to /login.
		-->
		<div class="p-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center max-w-xl mx-auto">
			<div class="text-5xl mb-3">🔒</div>
			<h2 class="text-xl font-semibold text-slate-900 dark:text-white mb-2">
				Wallet sign-in required
			</h2>
			<p class="text-sm text-slate-600 dark:text-slate-400 mb-5">
				Minting a CashToken means signing an on-chain transaction with the BCH address that owns
				the funding UTXO. We don't store your private key, we don't email you, and we don't ask
				for any other identity — your wallet IS the account.
			</p>
			<a
				href="/login?next=/mint"
				class="inline-block px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-medium transition-colors"
			>
				Sign in with your wallet
			</a>
			<p class="mt-3 text-xs text-slate-500 dark:text-slate-400">
				Lost key = lost account. That's an intended property; not a bug.
			</p>
		</div>
	{:else}
		<!-- Step indicator. Click a label to jump (validators gate forward jumps). -->
		<ol class="flex items-center justify-between mb-8 text-xs sm:text-sm">
			{#each stepLabels as label, i (label)}
				{@const idx = i + 1}
				{@const isActive = step === idx}
				{@const isComplete = step > idx}
				<li class="flex-1 flex items-center {i < stepLabels.length - 1 ? 'mr-1 sm:mr-2' : ''}">
					<button
						type="button"
						onclick={() => jumpTo(idx)}
						class="flex items-center gap-2 group"
					>
						<span
							class="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full text-xs font-semibold {isActive
								? 'bg-violet-600 text-white'
								: isComplete
									? 'bg-emerald-500 text-white'
									: 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}"
						>
							{isComplete ? '✓' : idx}
						</span>
						<span class="hidden sm:inline {isActive ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}">
							{label}
						</span>
					</button>
					{#if i < stepLabels.length - 1}
						<div class="flex-1 h-px mx-1 sm:mx-3 {isComplete ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-800'}"></div>
					{/if}
				</li>
			{/each}
		</ol>

		<div class="p-6 sm:p-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			{#if step === 1}
				<h2 class="text-xl font-semibold text-slate-900 dark:text-white mb-2">1. Pick a token type</h2>
				<p class="text-sm text-slate-600 dark:text-slate-400 mb-5">
					CashTokens has three flavors. Choose carefully — the type is part of the genesis
					transaction and can't be changed once minted.
				</p>
				<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
					{#each [
						{ id: 'FT', label: 'Fungible (FT)', desc: 'A divisible token with a fixed total supply, like USD or BTC. Choose this for currencies, governance tokens, points.' },
						{ id: 'NFT', label: 'Non-fungible (NFT)', desc: 'Each token is unique with optional commitment data. Choose this for art, collectibles, identity claims.' },
						{ id: 'FT+NFT', label: 'Hybrid', desc: 'Both at once. The minting NFT controls future FT issuance — common for governance + treasury tokens.' }
					] as opt (opt.id)}
						<button
							type="button"
							onclick={() => (tokenType = opt.id as TokenType)}
							class="p-4 rounded-xl border-2 text-left transition-colors {tokenType === opt.id
								? 'border-violet-600 bg-violet-50 dark:bg-violet-950/30'
								: 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'}"
						>
							<div class="font-semibold text-slate-900 dark:text-white">{opt.label}</div>
							<div class="mt-1 text-xs text-slate-600 dark:text-slate-400">{opt.desc}</div>
						</button>
					{/each}
				</div>
			{:else if step === 2}
				<h2 class="text-xl font-semibold text-slate-900 dark:text-white mb-2">2. Identity</h2>
				<p class="text-sm text-slate-600 dark:text-slate-400 mb-5">
					What this token is called and what it looks like. Will be published as BCMR metadata
					so wallets and explorers display it consistently.
				</p>
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<label class="block">
						<span class="text-sm font-medium text-slate-700 dark:text-slate-300">Name</span>
						<input
							type="text"
							bind:value={name}
							maxlength="80"
							placeholder="e.g. Wonderland Token"
							class="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
						/>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-slate-700 dark:text-slate-300">Ticker</span>
						<input
							type="text"
							bind:value={ticker}
							maxlength="12"
							placeholder="e.g. WLT"
							class="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono uppercase"
						/>
					</label>
					{#if tokenType !== 'NFT'}
						<label class="block">
							<span class="text-sm font-medium text-slate-700 dark:text-slate-300">Decimals (0–8)</span>
							<input
								type="number"
								min="0"
								max="8"
								bind:value={decimals}
								class="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono"
							/>
						</label>
					{/if}
					<label class="block sm:col-span-2">
						<span class="text-sm font-medium text-slate-700 dark:text-slate-300">Description (optional)</span>
						<textarea
							bind:value={description}
							maxlength="500"
							rows="3"
							placeholder="A sentence or two for the BCMR metadata."
							class="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
						></textarea>
					</label>
				</div>
				<p class="mt-3 text-xs text-slate-500 dark:text-slate-400">
					Icon upload lands in batch 4 — for now, BCMR icon stays empty until you publish
					metadata after the genesis tx confirms.
				</p>
			{:else if step === 3}
				<h2 class="text-xl font-semibold text-slate-900 dark:text-white mb-2">3. Supply</h2>
				{#if tokenType === 'FT' || tokenType === 'FT+NFT'}
					<p class="text-sm text-slate-600 dark:text-slate-400 mb-5">
						The total supply minted at genesis. This is the only mint event unless you keep
						the minting NFT (FT+NFT hybrid). Up to 2<sup>63</sup>−1 per CHIP-2022-02.
					</p>
					<label class="block max-w-md">
						<span class="text-sm font-medium text-slate-700 dark:text-slate-300">
							Total supply (smallest unit)
						</span>
						<input
							type="text"
							inputmode="numeric"
							bind:value={totalSupply}
							placeholder="e.g. 100000000"
							class="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono"
						/>
					</label>
				{/if}
				{#if tokenType === 'NFT' || tokenType === 'FT+NFT'}
					<div class="mt-6">
						<label class="block max-w-md">
							<span class="text-sm font-medium text-slate-700 dark:text-slate-300">
								NFT commitment (hex, ≤ 40 bytes)
							</span>
							<input
								type="text"
								bind:value={nftCommitmentHex}
								placeholder="optional — leave empty for none"
								class="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono"
							/>
						</label>
						<label class="block mt-3 max-w-md">
							<span class="text-sm font-medium text-slate-700 dark:text-slate-300">
								NFT capability
							</span>
							<select
								bind:value={nftCapability}
								class="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
							>
								<option value="none">None — pure NFT, can't mint or mutate</option>
								<option value="mutable">Mutable — commitment can change</option>
								<option value="minting">Minting — controls future FT issuance</option>
							</select>
						</label>
					</div>
				{/if}
			{:else if step === 4}
				<h2 class="text-xl font-semibold text-slate-900 dark:text-white mb-2">4. Review</h2>
				<p class="text-sm text-slate-600 dark:text-slate-400 mb-5">
					Confirm the details. Step 5 will compute the genesis tx and ask your wallet to sign.
				</p>
				<dl class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
					<div>
						<dt class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Type</dt>
						<dd class="mt-1 font-mono text-slate-900 dark:text-white">{tokenType}</dd>
					</div>
					<div>
						<dt class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Name</dt>
						<dd class="mt-1 text-slate-900 dark:text-white">{name}</dd>
					</div>
					<div>
						<dt class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Ticker</dt>
						<dd class="mt-1 font-mono text-slate-900 dark:text-white">{ticker}</dd>
					</div>
					{#if tokenType !== 'NFT'}
						<div>
							<dt class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Decimals</dt>
							<dd class="mt-1 font-mono text-slate-900 dark:text-white">{decimals}</dd>
						</div>
					{/if}
					{#if tokenType === 'FT' || tokenType === 'FT+NFT'}
						<div class="sm:col-span-2">
							<dt class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Total supply</dt>
							<dd class="mt-1 font-mono text-slate-900 dark:text-white">{totalSupply}</dd>
						</div>
					{/if}
					{#if tokenType === 'NFT' || tokenType === 'FT+NFT'}
						<div class="sm:col-span-2">
							<dt class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">NFT commitment</dt>
							<dd class="mt-1 font-mono text-xs break-all text-slate-900 dark:text-white">{nftCommitmentHex || '(none)'}</dd>
						</div>
						<div>
							<dt class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Capability</dt>
							<dd class="mt-1 font-mono text-slate-900 dark:text-white">{nftCapability}</dd>
						</div>
					{/if}
				</dl>
				<div class="mt-6 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-sm text-amber-900 dark:text-amber-200">
					<strong>Coming in batch 2:</strong> the actual genesis-tx preview (input UTXO, category id,
					computed fees) will land here once the libauth tx-builder integration is in.
				</div>
			{:else if step === 5}
				<h2 class="text-xl font-semibold text-slate-900 dark:text-white mb-2">5. Sign & broadcast</h2>
				<p class="text-sm text-slate-600 dark:text-slate-400 mb-5">
					Your wallet will be asked to sign the genesis transaction. Once broadcast, the
					category appears in the directory within one block (~10 minutes on average).
				</p>
				<div class="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-sm text-amber-900 dark:text-amber-200">
					<strong>Coming in batch 3:</strong> WalletConnect handoff + broadcast endpoint (POST to our
					BCHN's <code>sendrawtransaction</code>). The flow stops here today.
				</div>
			{/if}

			<!-- Per-step error banner. -->
			{#if (step === 1 && step1Error) || (step === 2 && step2Error) || (step === 3 && step3Error)}
				<p class="mt-4 text-sm text-rose-600 dark:text-rose-400">
					{step === 1 ? step1Error : step === 2 ? step2Error : step3Error}
				</p>
			{/if}

			<div class="mt-8 flex items-center justify-between">
				<button
					type="button"
					onclick={back}
					disabled={step === 1}
					class="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
				>
					Back
				</button>
				<button
					type="button"
					onclick={next}
					disabled={step === 5 ||
						(step === 1 && !!step1Error) ||
						(step === 2 && !!step2Error) ||
						(step === 3 && !!step3Error)}
					class="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
				>
					{step === 5 ? 'Sign — coming soon' : step === 4 ? 'Sign genesis tx' : 'Next'}
				</button>
			</div>
		</div>

		<p class="mt-6 text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
			Mint as <span class="font-mono">{data.cashaddr}</span>. The genesis tx will be signed by
			that address; it must hold a UTXO with enough BCH to cover the genesis output + fees
			(typically 2000-3000 sats).
		</p>
	{/if}
</main>
