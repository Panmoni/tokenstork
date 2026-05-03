<script lang="ts">
	// Mint wizard — full flow.
	//
	//   1 type      — radio between FT / NFT / FT+NFT
	//   2 identity  — name, ticker, decimals, description
	//   3 supply    — FT total / NFT commitment+capability (depending on type)
	//   4 review    — funding outpoint + libauth-built unsigned tx preview
	//   5 sign+bcst — wallet signs (manual paste hex), POST to /api/mint/broadcast
	//   6 publish   — BCMR JSON download (post-broadcast)
	//
	// State persists via /api/mint/sessions/[id] PATCH on each step
	// transition; resumes via the latest 'drafting' session on mount.

	import { onMount } from 'svelte';
	import { buildGenesisTx, type TokenType, type NftCapability } from '$lib/mint/genesis';
	import { generateBcmrJson } from '$lib/mint/bcmr';
	import type { MintSession } from '$lib/server/mintSessions';

	let { data } = $props();

	// Wizard step (1-6).
	let step = $state(1);

	// Persistent fields — saved to user_mint_sessions on each transition.
	let sessionId = $state<string | null>(null);
	let tokenType = $state<TokenType | null>(null);
	let ticker = $state('');
	let name = $state('');
	let description = $state('');
	let decimals = $state<number>(0);
	let totalSupply = $state('');
	let nftCommitmentHex = $state('');
	let nftCapability = $state<NftCapability>('none');

	// Step 4 inputs (funding outpoint + recipient address).
	let outpointTxid = $state('');
	let outpointSatoshis = $state<number>(2000);

	// Step 5 inputs (signed tx hex pasted from wallet).
	let signedTxHex = $state('');
	let broadcastTxid = $state<string | null>(null);
	let broadcastError = $state<string | null>(null);
	let broadcasting = $state(false);

	// Mint result (post-broadcast).
	let mintedCategoryHex = $state<string | null>(null);

	// Step 6 IPFS upload — user pastes their OWN web3.storage / Pinata
	// API key; we never see, store, or persist it. The fetch goes
	// directly browser → IPFS provider, not through our backend.
	let ipfsProvider = $state<'web3.storage' | 'pinata'>('web3.storage');
	let ipfsApiKey = $state('');
	let ipfsUploading = $state(false);
	let ipfsCid = $state<string | null>(null);
	let ipfsError = $state<string | null>(null);

	// Icon URI for the BCMR. Either pasted as `ipfs://<cid>` /
	// `https://...` OR pinned via the upload widget below. Travels
	// straight into the generated BCMR JSON's `uris.icon`.
	let iconUri = $state('');
	let iconFile = $state<File | null>(null);
	let iconUploading = $state(false);
	let iconError = $state<string | null>(null);

	// Per-step validation. null = good to advance.
	const step1Error = $derived.by(() => (tokenType ? null : 'Pick a token type to continue.'));
	const step2Error = $derived.by(() => {
		if (!name.trim()) return 'A name is required.';
		if (!ticker.trim()) return 'A ticker is required.';
		if (ticker.trim().length > 12) return 'Ticker must be 12 characters or fewer.';
		if (tokenType !== 'NFT' && (decimals < 0 || decimals > 8)) {
			return 'Decimals must be 0–8 per CashTokens spec.';
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
		if ((tokenType === 'NFT' || tokenType === 'FT+NFT') && nftCommitmentHex) {
			if (!/^[0-9a-fA-F]*$/.test(nftCommitmentHex)) {
				return 'NFT commitment must be hex (0-9, a-f).';
			}
			if (nftCommitmentHex.length > 80) {
				return 'NFT commitment max 40 bytes (80 hex chars).';
			}
		}
		return null;
	});

	// Step 4: derive the unsigned tx whenever the inputs change.
	type GenesisBuild = ReturnType<typeof buildGenesisTx>;
	let genesisBuild = $state<GenesisBuild | null>(null);
	let genesisBuildError = $state<string | null>(null);

	function rebuildGenesis() {
		genesisBuildError = null;
		genesisBuild = null;
		if (!data || data.unauthenticated) return;
		if (!tokenType || !outpointTxid) return;
		if (!/^[0-9a-fA-F]{64}$/.test(outpointTxid)) {
			genesisBuildError = 'Outpoint txid must be 64-char hex.';
			return;
		}
		try {
			genesisBuild = buildGenesisTx({
				outpointTxid,
				outpointSatoshis,
				tokenType,
				supply: totalSupply ? BigInt(totalSupply) : undefined,
				nftCommitmentHex: nftCommitmentHex || undefined,
				nftCapability,
				recipientCashaddr: data.cashaddr
			});
		} catch (e) {
			genesisBuildError = (e as Error).message;
		}
	}
	$effect(() => {
		if (step === 4) rebuildGenesis();
	});

	// Persist session state on each step transition.
	async function ensureSession() {
		if (sessionId) return sessionId;
		const res = await fetch('/api/mint/sessions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}'
		});
		if (!res.ok) throw new Error(`Could not create session (${res.status})`);
		const session = (await res.json()) as MintSession;
		sessionId = session.id;
		return sessionId;
	}
	async function saveSession() {
		if (!sessionId) return;
		const patch = {
			tokenType: tokenType ?? null,
			ticker: ticker || null,
			name: name || null,
			description: description || null,
			decimals: tokenType === 'NFT' ? null : decimals,
			supply: totalSupply || null,
			nftCapability: tokenType !== 'FT' ? nftCapability : null,
			nftCommitmentHex: nftCommitmentHex || null
		};
		try {
			await fetch(`/api/mint/sessions/${sessionId}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(patch)
			});
		} catch (e) {
			console.warn('[mint] session save failed (will retry next step):', e);
		}
	}

	// Resume the latest 'drafting' session on mount, if any.
	onMount(async () => {
		if (data.unauthenticated) return;
		try {
			const res = await fetch('/api/mint/sessions');
			if (!res.ok) return;
			const body = (await res.json()) as { sessions: MintSession[] };
			const draft = body.sessions.find((s) => s.state === 'drafting');
			if (!draft) return;
			sessionId = draft.id;
			tokenType = draft.tokenType;
			ticker = draft.ticker ?? '';
			name = draft.name ?? '';
			description = draft.description ?? '';
			decimals = draft.decimals ?? 0;
			totalSupply = draft.supply ?? '';
			nftCommitmentHex = draft.nftCommitmentHex ?? '';
			nftCapability = draft.nftCapability ?? 'none';
		} catch (e) {
			console.warn('[mint] session resume failed:', e);
		}
	});

	async function next() {
		if (step === 1 && step1Error) return;
		if (step === 2 && step2Error) return;
		if (step === 3 && step3Error) return;
		if (step === 1) await ensureSession();
		await saveSession();
		step = Math.min(step + 1, 6);
	}
	function back() {
		step = Math.max(step - 1, 1);
	}
	async function jumpTo(target: number) {
		if (target < step) {
			step = target;
			return;
		}
		// Forward jump validates intermediate steps. Steps 4 and 5 each
		// have their own state guards (genesisBuild non-null + signedTxHex
		// non-empty) — gating jumpTo on them prevents click-through to
		// later steps that'd render without the prerequisites in place.
		for (let s = step; s < target; s++) {
			if (s === 1 && step1Error) return;
			if (s === 2 && step2Error) return;
			if (s === 3 && step3Error) return;
			if (s === 4 && !genesisBuild) return;
			if (s === 5 && !broadcastTxid) return;
		}
		await saveSession();
		step = target;
	}

	async function broadcast() {
		broadcastError = null;
		broadcasting = true;
		try {
			if (!signedTxHex.trim()) {
				broadcastError = 'Paste your signed tx hex from the wallet.';
				return;
			}
			if (!/^[0-9a-fA-F]+$/.test(signedTxHex.trim())) {
				broadcastError = 'Signed tx must be hex (0-9, a-f).';
				return;
			}
			const res = await fetch('/api/mint/broadcast', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ rawHex: signedTxHex.trim() })
			});
			const body = (await res.json().catch(() => ({}))) as { txid?: string; message?: string };
			if (!res.ok) {
				broadcastError = body.message ?? `Broadcast failed (${res.status})`;
				return;
			}
			broadcastTxid = body.txid ?? null;
			mintedCategoryHex = genesisBuild?.categoryHex ?? null;
			// Persist the broadcast result.
			if (sessionId && broadcastTxid && mintedCategoryHex) {
				await fetch(`/api/mint/sessions/${sessionId}`, {
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						state: 'broadcast',
						genesisTxidHex: broadcastTxid,
						categoryHex: mintedCategoryHex
					})
				});
			}
			step = 6;
		} finally {
			broadcasting = false;
		}
	}

	function bcmrJsonString(): string | null {
		if (!mintedCategoryHex || !tokenType) return null;
		return generateBcmrJson({
			categoryHex: mintedCategoryHex,
			tokenType,
			name,
			ticker,
			decimals: tokenType === 'NFT' ? 0 : decimals,
			description,
			iconUri: iconUri || undefined,
			nftCommitmentHex: nftCommitmentHex || undefined,
			nftCapability: tokenType !== 'FT' ? nftCapability : undefined
		});
	}

	// Pin a file (icon OR bcmr) to IPFS via the user's pasted key.
	// Returns the CID on success; throws on failure. Never stores the
	// key — caller is responsible for clearing it post-call.
	async function pinFileToIpfs(file: Blob, filename: string, key: string): Promise<string> {
		const fd = new FormData();
		fd.append('file', file, filename);
		if (ipfsProvider === 'web3.storage') {
			const res = await fetch('https://api.web3.storage/upload', {
				method: 'POST',
				headers: { authorization: `Bearer ${key}` },
				body: fd
			});
			if (!res.ok) {
				const t = await res.text().catch(() => '');
				throw new Error(`web3.storage HTTP ${res.status}: ${t.slice(0, 200)}`);
			}
			const body = (await res.json()) as { cid?: string };
			if (!body.cid) throw new Error('web3.storage returned no CID');
			return body.cid;
		}
		const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
			method: 'POST',
			headers: { authorization: `Bearer ${key}` },
			body: fd
		});
		if (!res.ok) {
			const t = await res.text().catch(() => '');
			throw new Error(`pinata HTTP ${res.status}: ${t.slice(0, 200)}`);
		}
		const body = (await res.json()) as { IpfsHash?: string };
		if (!body.IpfsHash) throw new Error('Pinata returned no CID');
		return body.IpfsHash;
	}

	async function uploadIconToIpfs() {
		iconError = null;
		if (!iconFile) {
			iconError = 'Pick an icon file first.';
			return;
		}
		if (iconFile.size > 2 * 1024 * 1024) {
			iconError = 'Icon must be ≤ 2 MiB (matches the icon-safety pipeline cap).';
			return;
		}
		if (!ipfsApiKey.trim()) {
			iconError = 'Paste your IPFS provider API key first (same widget as below).';
			return;
		}
		iconUploading = true;
		const key = ipfsApiKey.trim();
		try {
			const cid = await pinFileToIpfs(iconFile, iconFile.name, key);
			iconUri = `ipfs://${cid}`;
		} catch (e) {
			iconError = (e as Error).message;
		} finally {
			iconUploading = false;
			ipfsApiKey = ''; // defensive clear
		}
	}

	async function uploadBcmrToIpfs() {
		ipfsError = null;
		ipfsCid = null;
		const json = bcmrJsonString();
		if (!json) {
			ipfsError = 'BCMR not ready (broadcast first).';
			return;
		}
		if (!ipfsApiKey.trim()) {
			ipfsError = 'Paste your IPFS provider API key first.';
			return;
		}
		ipfsUploading = true;
		const key = ipfsApiKey.trim();
		try {
			const blob = new Blob([json], { type: 'application/json' });
			const filename = `bcmr-${ticker.toLowerCase() || 'token'}-${(mintedCategoryHex ?? '').slice(0, 8)}.json`;
			ipfsCid = await pinFileToIpfs(blob, filename, key);
		} catch (e) {
			ipfsError = (e as Error).message;
		} finally {
			ipfsUploading = false;
			ipfsApiKey = ''; // defensive clear
		}
	}

	function downloadBcmr() {
		const json = bcmrJsonString();
		if (!json) return;
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `bcmr-${ticker.toLowerCase() || 'token'}-${(mintedCategoryHex ?? '').slice(0, 8)}.json`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	const stepLabels = ['Type', 'Identity', 'Supply', 'Review', 'Sign & broadcast', 'Publish'];
</script>

<svelte:head>
	<title>Mint a CashToken — Token Stork</title>
	<meta
		name="description"
		content="Mint your own BCH CashToken (FT, NFT, or hybrid) directly from your wallet."
	/>
	<!-- Wallet-gated workflow page; the unauthenticated CTA is the only
	     thing crawlers would index, and there's no SEO upside to it. -->
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<div class="mb-8">
		<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent">
			Mint a CashToken
			<span
				class="align-middle ml-2 px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
			>ALPHA</span>
		</h1>
		<p class="mt-2 max-w-2xl ts-text-muted">
			Create your own fungible token, NFT, or hybrid on the Bitcoin Cash chain. Walk through the
			six-step wizard, sign the genesis transaction with your wallet, and your category appears
			on the directory within minutes.
		</p>
		<div
			class="mt-4 max-w-2xl px-4 py-3 rounded-lg border bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/40 text-sm text-amber-800 dark:text-amber-200"
			role="note"
		>
			<strong>Alpha tooling — use at your own risk.</strong> Minting builds and broadcasts a real
			BCH transaction. Construction is libauth-direct and untested at scale; the operator makes
			no warranty as to correctness. Test with a low-stakes wallet first, verify every output in
			your wallet's pre-sign review, and accept that bugs are possible. See the
			<a href="/terms#tools-alpha" class="underline">Terms</a> for the full disclaimer.
		</div>
	</div>

	{#if data.unauthenticated}
		<div class="p-8 rounded-xl border text-center max-w-xl mx-auto ts-border-subtle ts-surface-panel">
			<div class="text-5xl mb-3">🔒</div>
			<h2 class="text-xl font-semibold text-slate-900 dark:text-white mb-2">
				Wallet sign-in required
			</h2>
			<p class="text-sm mb-5 ts-text-muted">
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
			<p class="mt-3 text-xs ts-text-muted">
				Lost key = lost account. That's an intended property; not a bug.
			</p>
		</div>
	{:else}
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
				<h2 class="text-xl font-semibold text-slate-900 dark:text-white mb-2">1. Pick a token type</h2>
				<p class="text-sm mb-5 ts-text-muted">
					CashTokens has three flavors. The type is part of the genesis transaction and can't be
					changed once minted.
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
							class="p-4 rounded-xl border-2 text-left transition-colors {tokenType === opt.id ? 'border-violet-600 bg-violet-50 dark:bg-violet-950/30' : 'border-slate-200 dark:border-zinc-800 hover:border-slate-300 dark:hover:border-zinc-700'}"
						>
							<div class="font-semibold text-slate-900 dark:text-white">{opt.label}</div>
							<div class="mt-1 text-xs ts-text-muted">{opt.desc}</div>
						</button>
					{/each}
				</div>
			{:else if step === 2}
				<h2 class="text-xl font-semibold text-slate-900 dark:text-white mb-2">2. Identity</h2>
				<p class="text-sm mb-5 ts-text-muted">
					What this token is called and what it looks like. Will be published as BCMR metadata
					so wallets and explorers display it consistently.
				</p>
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<label class="block">
						<span class="text-sm font-medium ts-text-strong">Name</span>
						<input type="text" bind:value={name} maxlength="80" placeholder="e.g. Wonderland Token" class="mt-1 w-full rounded-lg border px-3 py-2 text-sm ts-border-strong ts-surface-page" />
					</label>
					<label class="block">
						<span class="text-sm font-medium ts-text-strong">Ticker</span>
						<input type="text" bind:value={ticker} maxlength="12" placeholder="e.g. WLT" class="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-mono uppercase ts-border-strong ts-surface-page" />
					</label>
					{#if tokenType !== 'NFT'}
						<label class="block">
							<span class="text-sm font-medium ts-text-strong">Decimals (0–8)</span>
							<input type="number" min="0" max="8" bind:value={decimals} class="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-mono ts-border-strong ts-surface-page" />
						</label>
					{/if}
					<label class="block sm:col-span-2">
						<span class="text-sm font-medium ts-text-strong">Description (optional)</span>
						<textarea bind:value={description} maxlength="500" rows="3" placeholder="A sentence or two for the BCMR metadata." class="mt-1 w-full rounded-lg border px-3 py-2 text-sm ts-border-strong ts-surface-page"></textarea>
					</label>
					<label class="block sm:col-span-2">
						<span class="text-sm font-medium ts-text-strong">Icon URI (optional)</span>
						<input type="text" bind:value={iconUri} placeholder="https://… or ipfs://… — leave empty to publish without an icon" class="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-mono ts-border-strong ts-surface-page" />
					</label>
				</div>
				<details class="mt-4 p-4 rounded-lg border bg-slate-50 dark:bg-zinc-950 text-xs ts-border-subtle">
					<summary class="cursor-pointer text-sm font-medium ts-text-strong">Pin an icon file to IPFS</summary>
					<p class="mt-3 ts-text-muted">
						Upload a static raster (PNG / JPEG / WebP, ≤ 2 MiB) directly from your browser to
						<strong>web3.storage</strong> or <strong>Pinata</strong> using your own API key.
						The file never reaches Token Stork's server. Once pinned, the resulting
						<code>ipfs://&lt;cid&gt;</code> populates the Icon URI field above.
					</p>
					<div class="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
						<label class="block">
							<span class="font-medium ts-text-strong">Provider</span>
							<select bind:value={ipfsProvider} class="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs ts-border-strong ts-surface-page">
								<option value="web3.storage">web3.storage</option>
								<option value="pinata">Pinata</option>
							</select>
						</label>
						<label class="block sm:col-span-2">
							<span class="font-medium ts-text-strong">API key</span>
							<input type="password" bind:value={ipfsApiKey} placeholder="your bearer token (cleared after upload)" class="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs font-mono ts-border-strong ts-surface-page" />
						</label>
						<label class="block sm:col-span-2">
							<span class="font-medium ts-text-strong">Icon file</span>
							<input type="file" accept="image/png,image/jpeg,image/webp" onchange={(e) => (iconFile = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)} class="mt-1 w-full text-xs" />
						</label>
						<button type="button" onclick={uploadIconToIpfs} disabled={iconUploading || !iconFile || !ipfsApiKey.trim()} class="mt-5 px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed">
							{iconUploading ? 'Pinning…' : 'Pin icon'}
						</button>
					</div>
					{#if iconError}
						<p class="mt-2 text-rose-600 dark:text-rose-400">{iconError}</p>
					{/if}
				</details>
			{:else if step === 3}
				<h2 class="text-xl font-semibold text-slate-900 dark:text-white mb-2">3. Supply</h2>
				{#if tokenType === 'FT' || tokenType === 'FT+NFT'}
					<p class="text-sm mb-5 ts-text-muted">
						The total supply minted at genesis. This is the only mint event unless you keep
						the minting NFT (FT+NFT hybrid). Up to 2<sup>63</sup>−1 per CHIP-2022-02.
					</p>
					<label class="block max-w-md">
						<span class="text-sm font-medium ts-text-strong">Total supply (smallest unit)</span>
						<input type="text" inputmode="numeric" bind:value={totalSupply} placeholder="e.g. 100000000" class="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-mono ts-border-strong ts-surface-page" />
					</label>
				{/if}
				{#if tokenType === 'NFT' || tokenType === 'FT+NFT'}
					<div class="mt-6">
						<label class="block max-w-md">
							<span class="text-sm font-medium ts-text-strong">NFT commitment (hex, ≤ 40 bytes)</span>
							<input type="text" bind:value={nftCommitmentHex} placeholder="optional — leave empty for none" class="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-mono ts-border-strong ts-surface-page" />
						</label>
						<label class="block mt-3 max-w-md">
							<span class="text-sm font-medium ts-text-strong">NFT capability</span>
							<select bind:value={nftCapability} class="mt-1 w-full rounded-lg border px-3 py-2 text-sm ts-border-strong ts-surface-page">
								<option value="none">None — pure NFT, can't mint or mutate</option>
								<option value="mutable">Mutable — commitment can change</option>
								<option value="minting">Minting — controls future FT issuance</option>
							</select>
						</label>
					</div>
				{/if}
			{:else if step === 4}
				<h2 class="text-xl font-semibold text-slate-900 dark:text-white mb-2">4. Review</h2>
				<p class="text-sm mb-5 ts-text-muted">
					Provide a funding outpoint from your wallet — a UTXO at <strong>vout=0</strong> of any
					transaction. The CashTokens spec uses that outpoint's txid as the new category id.
					Recipient is automatically set to your authenticated address.
				</p>
				<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
					<label class="block sm:col-span-2">
						<span class="text-sm font-medium ts-text-strong">Funding outpoint txid (vout=0)</span>
						<input type="text" bind:value={outpointTxid} placeholder="64-char hex" class="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-mono ts-border-strong ts-surface-page" />
					</label>
					<label class="block">
						<span class="text-sm font-medium ts-text-strong">UTXO value (sats)</span>
						<input type="number" min="2000" bind:value={outpointSatoshis} class="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-mono ts-border-strong ts-surface-page" />
					</label>
				</div>
				<details class="text-xs mb-4 ts-text-muted">
					<summary class="cursor-pointer">How to create a vout=0 funding UTXO</summary>
					<p class="mt-2">
						In your wallet, send any small amount of BCH (e.g. 0.00002 BCH = 2000 sats) to your
						OWN address. The first output of that transaction (vout=0) is now a UTXO you can
						use here. Copy the txid into the field above.
					</p>
				</details>
				{#if genesisBuildError}
					<p class="text-sm text-rose-600 dark:text-rose-400 mb-3">{genesisBuildError}</p>
				{/if}
				{#if genesisBuild}
					<dl class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
						<div>
							<dt class="text-xs uppercase tracking-wide ts-text-muted">Type</dt>
							<dd class="mt-1 font-mono text-slate-900 dark:text-white">{tokenType}</dd>
						</div>
						<div>
							<dt class="text-xs uppercase tracking-wide ts-text-muted">Name / Ticker</dt>
							<dd class="mt-1 text-slate-900 dark:text-white">{name} <span class="font-mono text-xs">({ticker})</span></dd>
						</div>
						<div class="sm:col-span-2">
							<dt class="text-xs uppercase tracking-wide ts-text-muted">Resulting category id</dt>
							<dd class="mt-1 font-mono text-xs break-all text-slate-900 dark:text-white">{genesisBuild.categoryHex}</dd>
						</div>
						<div>
							<dt class="text-xs uppercase tracking-wide ts-text-muted">Estimated tx size</dt>
							<dd class="mt-1 font-mono text-slate-900 dark:text-white">{genesisBuild.estimatedTxBytes} bytes</dd>
						</div>
						<div>
							<dt class="text-xs uppercase tracking-wide ts-text-muted">Fee</dt>
							<dd class="mt-1 font-mono text-slate-900 dark:text-white">{genesisBuild.feeSats} sats</dd>
						</div>
						<div>
							<dt class="text-xs uppercase tracking-wide ts-text-muted">Change back to you</dt>
							<dd class="mt-1 font-mono text-slate-900 dark:text-white">{genesisBuild.changeSats} sats</dd>
						</div>
					</dl>
					<details class="mt-4 text-xs ts-text-muted">
						<summary class="cursor-pointer">Show unsigned tx hex</summary>
						<pre class="mt-2 p-3 rounded bg-slate-50 dark:bg-zinc-950 border break-all whitespace-pre-wrap text-[10px] ts-border-subtle">{genesisBuild.unsignedTxHex}</pre>
					</details>
				{/if}
			{:else if step === 5}
				<h2 class="text-xl font-semibold text-slate-900 dark:text-white mb-2">5. Sign & broadcast</h2>
				<p class="text-sm mb-3 ts-text-muted">
					Take the unsigned tx hex from step 4, sign it in your wallet, and paste the signed
					hex back here. We'll broadcast it via the Token Stork BCHN node.
				</p>
				<details class="text-xs mb-4 p-3 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 ts-text-muted">
					<summary class="cursor-pointer text-amber-900 dark:text-amber-200 font-medium">Wallet integration status</summary>
					<p class="mt-2 text-amber-900 dark:text-amber-200">
						Direct WalletConnect <code>bch_signTransaction</code> handoff is a follow-up.
						Today's flow uses paste-the-hex: copy the unsigned tx from step 4, paste into your
						wallet's "sign tx" interface (Paytaca, Electron Cash, etc.), copy the resulting
						signed hex, paste it below.
					</p>
				</details>
				<label class="block">
					<span class="text-sm font-medium ts-text-strong">Signed tx (hex)</span>
					<textarea bind:value={signedTxHex} rows="4" placeholder="0200000001..." class="mt-1 w-full rounded-lg border px-3 py-2 text-xs font-mono break-all ts-border-strong ts-surface-page"></textarea>
				</label>
				{#if broadcastError}
					<p class="mt-3 text-sm text-rose-600 dark:text-rose-400">{broadcastError}</p>
				{/if}
				<button type="button" onclick={broadcast} disabled={broadcasting || !signedTxHex.trim()} class="mt-4 px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium">
					{broadcasting ? 'Broadcasting…' : 'Broadcast'}
				</button>
			{:else if step === 6}
				<h2 class="text-xl font-semibold text-slate-900 dark:text-white mb-2">6. Publish BCMR</h2>
				<div class="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-sm text-emerald-900 dark:text-emerald-200 mb-5">
					<strong>Genesis broadcast ✓</strong>
					<div class="mt-2 text-xs">
						<div>txid: <span class="font-mono break-all">{broadcastTxid}</span></div>
						<div>category id: <span class="font-mono break-all">{mintedCategoryHex}</span></div>
					</div>
					<p class="mt-2">
						Your token will appear on the directory within ~10 minutes (one block + sync-tail
						tick). Until then, the BCMR file below is what you publish so wallets and
						explorers know its identity.
					</p>
				</div>
				<p class="text-sm mb-3 ts-text-muted">
					Download the BCMR JSON below, host it at any HTTPS URL you control (or pin it to IPFS
					and use the <code>ipfs://&lt;cid&gt;</code> form), then submit it to BCMR registries
					so wallets pick up your token's identity.
				</p>
				<button type="button" onclick={downloadBcmr} class="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium">
					Download BCMR JSON
				</button>

				<div class="mt-8 p-5 rounded-xl border bg-slate-50 dark:bg-zinc-950 ts-border-subtle">
					<h3 class="text-sm font-semibold text-slate-900 dark:text-white mb-2">Or pin directly to IPFS</h3>
					<p class="text-xs mb-3 ts-text-muted">
						Paste your own <strong>Pinata</strong> JWT or <strong>web3.storage</strong> API
						key. The upload runs <em>directly</em> from your browser to the IPFS provider —
						your key never reaches Token Stork's server, and we clear it from memory after
						each attempt. Returns a CID you can use as <code>ipfs://&lt;cid&gt;</code> in
						BCMR registries or directly in your wallet.
					</p>
					<p class="text-xs text-amber-700 dark:text-amber-300 mb-3">
						⚠️ web3.storage migrated to UCAN-based <strong>w3up</strong> in mid-2024 — the
						legacy upload endpoint may not authenticate against new accounts. Pinata's
						<code>pinFileToIPFS</code> is the more reliable default; web3.storage works if
						your account has a paid plan or you've configured a legacy API key.
					</p>
					<p class="text-xs text-amber-700 dark:text-amber-300 mb-3">
						⚠️ The BCMR JSON above is a working starting point but may need tweaking before
						submission to specific registries (Paytaca, etc.). Different registries enforce
						different versions of the BCMR-v2 schema; review the JSON in a text editor and
						compare to your target registry's example before submitting.
					</p>
					<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
						<label class="block">
							<span class="text-xs font-medium ts-text-strong">Provider</span>
							<select bind:value={ipfsProvider} class="mt-1 w-full rounded-lg border px-3 py-2 text-sm ts-border-strong ts-surface-page">
								<option value="web3.storage">web3.storage</option>
								<option value="pinata">Pinata (JWT)</option>
							</select>
						</label>
						<label class="block sm:col-span-2">
							<span class="text-xs font-medium ts-text-strong">API key (Bearer token)</span>
							<input type="password" bind:value={ipfsApiKey} placeholder="never sent to Token Stork — browser → IPFS provider directly" class="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-mono ts-border-strong ts-surface-page" />
						</label>
					</div>
					{#if ipfsError}
						<p class="text-xs text-rose-600 dark:text-rose-400 mb-2">{ipfsError}</p>
					{/if}
					{#if ipfsCid}
						<div class="p-3 rounded bg-emerald-100 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-900 text-sm text-emerald-900 dark:text-emerald-200 mb-2">
							<div class="font-semibold">Pinned ✓</div>
							<div class="mt-1 text-xs">CID: <span class="font-mono break-all">{ipfsCid}</span></div>
							<div class="mt-1 text-xs">Use as: <code class="font-mono">ipfs://{ipfsCid}</code></div>
						</div>
					{/if}
					<button type="button" onclick={uploadBcmrToIpfs} disabled={ipfsUploading || !ipfsApiKey.trim()} class="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
						{ipfsUploading ? 'Pinning…' : 'Pin BCMR to IPFS'}
					</button>
				</div>

				<p class="mt-4 text-xs ts-text-muted">
					Optional final step:
					<a class="text-violet-600 dark:text-violet-400 hover:underline" href="https://github.com/Paytaca/BCMR-v2-registry" target="_blank" rel="noopener noreferrer">submit your BCMR to Paytaca's public registry</a>
					so most BCH wallets discover your token automatically.
				</p>
			{/if}

			{#if (step === 1 && step1Error) || (step === 2 && step2Error) || (step === 3 && step3Error)}
				<p class="mt-4 text-sm text-rose-600 dark:text-rose-400">
					{step === 1 ? step1Error : step === 2 ? step2Error : step3Error}
				</p>
			{/if}

			{#if step !== 5 && step !== 6}
				<div class="mt-8 flex items-center justify-between">
					<button type="button" onclick={back} disabled={step === 1} class="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-slate-50 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed ts-text-strong ts-border-strong">
						Back
					</button>
					<button type="button" onclick={next} disabled={(step === 1 && !!step1Error) || (step === 2 && !!step2Error) || (step === 3 && !!step3Error) || (step === 4 && !genesisBuild)} class="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
						Next
					</button>
				</div>
			{/if}
		</div>

		<p class="mt-6 text-xs max-w-2xl ts-text-muted">
			Mint as <span class="font-mono">{data.cashaddr}</span>. The genesis tx will be signed by
			that address; it must hold a UTXO with enough BCH to cover the genesis output + fees
			(typically 2000-3000 sats).
		</p>
	{/if}
</main>
