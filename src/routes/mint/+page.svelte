<script module lang="ts">
	// Module-level WC session — survives route navigations and re-renders.
	let _mwc: { client: any; session: any } | null = null;
	import { wcSession } from '$lib/client/wc-session';
</script>

<script lang="ts">
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
	import { env as publicEnv } from '$env/dynamic/public';
	import { buildGenesisTx, type TokenType, type NftCapability } from '$lib/mint/genesis';
	import { generateBcmrJson } from '$lib/mint/bcmr';
	import { cashAddressToLockingBytecode, binToHex, hexToBin, encodeTransaction } from '@bitauth/libauth';
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
	// Extra funding inputs to supplement a vout=0 UTXO that's too small.
	let extraInputTxids = $state<string[]>([]);


	// Step 4 auto-detected funding UTXOs from the user's wallet.
	let fundingUtxos = $state<{ txid: string; valueSats: number; height: number }[]>([]);
	let plainUtxos = $state<{ txid: string; vout: number; valueSats: number; height: number }[]>([]);
	let fundingUtxosDiag = $state<{ total: number; notVout0: number; hasTokens: number; tooSmall: number; passed: number } | null>(null);
	let fundingUtxosLoading = $state(false);
	let fundingUtxosError = $state<string | null>(null);
	let fundingUtxosFetched = $state(false);
	// Step 5 inputs (signed tx hex pasted from wallet).
	let signedTxHex = $state('');
	let copiedUnsignedTx = $state(false);
	let broadcastTxid = $state<string | null>(null);
	let broadcastError = $state<string | null>(null);
	let broadcasting = $state(false);

	// WalletConnect sign-in-page state.
	let wcSigning = $state(false);
	let wcSignError = $state<string | null>(null);
	// Prepare-funding flow: consolidate plain BCH into vout=0 UTXO.
	let prepareInProgress = $state(false);
	let prepareError = $state<string | null>(null);
	let prepareDone = $state(false);
	// Step 4 manual-outpoint validation: when the user pastes a txid
	// manually, warn if vout=0 of that txid isn't in their wallet.
	let manualOutpointWarning = $derived.by(() => {
		if (!outpointTxid || !/^[0-9a-fA-F]{64}$/.test(outpointTxid)) return null;
		if (fundingUtxosLoading || !fundingUtxosFetched) return null;
		if (fundingUtxos.some(u => u.txid === outpointTxid.toLowerCase())) return null;
		if (fundingUtxosDiag && fundingUtxosDiag.total > 0) {
			return { message: 'This txid was not found at vout=0 in your wallet. The genesis tx MUST spend vout=0 — if you control a different output of this transaction, it will not work. Send BCH to yourself first to create a vout=0 UTXO.' };
		}
		return { message: 'This txid could not be verified against your wallet. Make sure it is the txid of a transaction where you control output #0 (vout=0).' };
	});
	// Persistence health for the stepper. saveSession is fire-and-forget;
	// when it fails we surface a small banner so the user knows their
	// progress isn't being saved (otherwise they'd refresh and lose work
	// silently).
	let lastSaveFailed = $state(false);

	// Discard-draft state for the "abandon this draft" affordance.
	let discarding = $state(false);
	let discardError = $state<string | null>(null);

	// Mint result (post-broadcast).
	let mintedCategoryHex = $state<string | null>(null);

	// Step 6 IPFS upload — user pastes their OWN Pinata / Lighthouse
	// API key; we never see, store, or persist it. The fetch goes
	// directly browser → IPFS provider, not through our backend.
	let ipfsProvider = $state<'pinata' | 'lighthouse'>('pinata');
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
				tokenType: tokenType as NonNullable<typeof tokenType>,
				supply: totalSupply ? BigInt(totalSupply) : undefined,
				nftCommitmentHex: nftCommitmentHex || undefined,
				nftCapability,
				recipientCashaddr: data!.cashaddr,
				extraInputs: extraInputTxids.length > 0
					? extraInputTxids.map(txid => {
							const u = plainUtxos.find(p => p.txid === txid);
							return u ? { txid: u.txid, vout: u.vout, valueSats: u.valueSats } : null;
						}).filter((x): x is NonNullable<typeof x> => x !== null)
					: undefined
			});
		} catch (e) {
			genesisBuildError = (e as Error).message;
		}
	}
	$effect(() => {
		if (step === 4) {
			rebuildGenesis();
			fetchFundingUtxos();
		}
	});
	async function fetchFundingUtxos() {
		fundingUtxosLoading = true;
		fundingUtxosError = null;
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 20_000);
			const res = await fetch('/api/wallet/funding-utxos', { signal: controller.signal });
			clearTimeout(timeout);
			if (!res.ok) {
				fundingUtxosError = `Could not fetch UTXOs (HTTP ${res.status})`;
				return;
			}
			const body = (await res.json()) as { utxos: typeof fundingUtxos; plainUtxos: typeof plainUtxos; diag: typeof fundingUtxosDiag };
			fundingUtxos = body.utxos;
			plainUtxos = body.plainUtxos;
			fundingUtxosDiag = body.diag;
			if (fundingUtxos.length > 0 && !outpointTxid) {
				const best = fundingUtxos[0];
				outpointTxid = best.txid;
				outpointSatoshis = best.valueSats;
			}
		} catch (e) {
			if ((e as Error).name === 'AbortError') {
				fundingUtxosError = 'UTXO fetch timed out after 20 seconds. BlockBook may be slow — try again.';
			} else {
				fundingUtxosError = (e as Error).message;
			}
		} finally {
			fundingUtxosLoading = false;
		}
	}

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
		// Gate per-type fields by current tokenType so a user who picks
		// NFT, then switches to FT, doesn't leave a stale NFT commitment
		// in the saved row. (Visual UI hides them but the state vars stay
		// populated — without this gate, resume-after-refresh rehydrates
		// the dead values into a row that doesn't belong with them.)
		const wantsFt = tokenType === 'FT' || tokenType === 'FT+NFT';
		const wantsNft = tokenType === 'NFT' || tokenType === 'FT+NFT';
		const patch: Record<string, unknown> = {
			tokenType: tokenType ?? null,
			ticker: ticker || null,
			name: name || null,
			description: description || null,
			decimals: tokenType === 'NFT' ? null : decimals,
			supply: wantsFt ? totalSupply || null : null,
			nftCapability: wantsNft ? nftCapability : null,
			nftCommitmentHex: wantsNft ? nftCommitmentHex || null : null,
			iconUri: iconUri || null,
			outpointTxid: outpointTxid || null,
			outpointSatoshis: outpointTxid ? outpointSatoshis : null
		};
		try {
			const res = await fetch(`/api/mint/sessions/${sessionId}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(patch)
			});
			lastSaveFailed = !res.ok;
			if (!res.ok) {
				console.warn('[mint] session save HTTP', res.status);
			}
		} catch (e) {
			lastSaveFailed = true;
			console.warn('[mint] session save failed (will retry next step):', e);
		}
	}

	// Resume on mount: if a specific `?session=<id>` was requested (deep
	// link from /mints), hydrate from the server-resolved row. Otherwise
	// fall back to the latest 'drafting' session via /api/mint/sessions.
	onMount(async () => {
		if (data.unauthenticated) return;
		if (data.resumeSession) {
			const r = data.resumeSession;
			sessionId = r.id;
			tokenType = r.tokenType as TokenType | null;
			ticker = r.ticker ?? '';
			name = r.name ?? '';
			description = r.description ?? '';
			decimals = r.decimals ?? 0;
			totalSupply = r.supply ?? '';
			nftCommitmentHex = r.nftCommitmentHex ?? '';
			nftCapability = (r.nftCapability as NftCapability | null) ?? 'none';
			iconUri = r.iconUri ?? '';
			outpointSatoshis = r.outpointSatoshis ?? 2000;
			return;
		}
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
			iconUri = draft.iconUri ?? '';
			outpointTxid = draft.outpointTxid ?? '';
			outpointSatoshis = draft.outpointSatoshis ?? 2000;
		} catch (e) {
			console.warn('[mint] session resume failed:', e);
		}
	});

	async function next() {
		// Block: can't proceed to step 5 without a genesis build (which
		// requires a valid outpoint txid). This prevents the most common
		// user error: pasting a random txid and trying to sign a tx that
		// references a UTXO they can't spend.
		if (step === 4 && !genesisBuild) return;
		if (step < 2) await ensureSession();
		await saveSession();
		step = Math.min(step + 1, 6);
	}
	function back() {
		step = Math.max(step - 1, 1);
	}
	async function jumpTo(target: number) {
		// Defensive bound: the stepper only renders 1..6, but the function
		// is exported into onclick handlers — clamp so a future caller
		// can't drive `step` out of range.
		target = Math.max(1, Math.min(stepLabels.length, target));
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
		// Mirror next()'s behavior: any forward motion past step 1 needs a
		// session to persist into. Without this, clicking a forward step
		// in the stepper (instead of "Next") leaves saveSession a no-op
		// and a refresh silently drops the user's input.
		if (target > 1) await ensureSession();
		await saveSession();
		step = target;
	}

	async function copyUnsignedTx() {
		if (!genesisBuild) return;
		try {
			await navigator.clipboard.writeText(genesisBuild.unsignedTxHex);
			copiedUnsignedTx = true;
			setTimeout(() => (copiedUnsignedTx = false), 2000);
		} catch { /* clipboard unavailable — no-op */ }
	}

	async function signWithWalletConnect() {
		if (!genesisBuild || !data || data.unauthenticated) return;
		wcSigning = true;
		wcSignError = null;
		try {
			// Derive the P2PKH locking bytecode for the user's address
			// so we can provide source-output data to the wallet.
			const lockResult = cashAddressToLockingBytecode(data.cashaddr);
			if (typeof lockResult === 'string') {
				wcSignError = `Could not derive locking script from your address: ${lockResult}`;
				return;
			}
			const lockingBytecodeHex = binToHex(lockResult.bytecode);

			// Lazy-load WalletConnect packages so they stay out of every
			// other page's bundle.
			const WC_PROJECT_ID = publicEnv.PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';
			console.log('[mint] WC_PROJECT_ID present:', !!WC_PROJECT_ID, WC_PROJECT_ID ? WC_PROJECT_ID.slice(0, 8) + '...' : 'MISSING');
			if (!WC_PROJECT_ID) {
				wcSignError = 'WalletConnect is not configured on this deployment. Set PUBLIC_WALLETCONNECT_PROJECT_ID and rebuild.';
				return;
			}

			const [{ default: SignClient }, { WalletConnectModal }] = await Promise.all([
				import('@walletconnect/sign-client'),
				import('@walletconnect/modal')
			]);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const client: any = await SignClient.init({
				projectId: WC_PROJECT_ID,
				metadata: {
					name: 'Token Stork — Mint',
					description: 'Sign a CashTokens genesis transaction',
					url: window.location.origin,
					icons: [`${window.location.origin}/logo-simple-bch.png`]
				}
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const modal: any = new WalletConnectModal({
				projectId: WC_PROJECT_ID,
				themeMode: document.documentElement.classList.contains('dark') ? 'dark' : 'light'
			});
			const BCH_CHAIN = 'bch:bitcoincash';
			const { uri, approval } = await client.connect({
				optionalNamespaces: {
					bch: {
						chains: [BCH_CHAIN],
						methods: ['bch_signTransaction', 'bch_getAddresses'],
						events: []
					}
				}
			});

			if (!uri) {
				wcSignError = 'WalletConnect returned no pairing URI. Try again or paste the signed hex manually.';
				return;
			}

			modal.openModal({ uri });
			let session: { topic: string; namespaces: { bch?: { accounts?: string[] } } };
			try {
				session = await approval();
			} finally {
				modal.closeModal();
			}

			// Verify the wallet's address matches the authenticated session.
			const accounts = session.namespaces.bch?.accounts ?? [];
			if (accounts.length === 0) {
				wcSignError = 'Wallet did not return any addresses. Try again.';
				return;
			}
			const walletCashaddr = accounts[0].split(':').slice(2).join(':');
			// Normalise: WC may return with or without 'bitcoincash:' prefix.
			const normAddr = (a: string) => a.replace(/^bitcoincash:/, '');
			if (normAddr(walletCashaddr) !== normAddr(data!.cashaddr)) {
				wcSignError = `Connected wallet (${walletCashaddr.slice(0, 12)}…) does not match your authenticated address. Sign in with the same wallet.`;
				return;
			}

			// Build source-output data for the single funding UTXO.
			// WC2 bch_signTransaction expects outpointTransactionHash as the
			// txid hex in user-facing (big-endian) format — the wallet handles
			// byte-order reversal for the raw tx internally.
			const sourceOutputs = [{
				outpointTransactionHash: `<Uint8Array: 0x${outpointTxid}>`,
				outpointIndex: 0,
				sequenceNumber: 0xfffffffe,
				lockingBytecode: `<Uint8Array: 0x${lockingBytecodeHex}>`,
				unlockingBytecode: '<Uint8Array: 0x>',
				valueSatoshis: `<bigint: ${outpointSatoshis}n>`
			}];

			// Some wallets support bch_signMessage (login) but not
			// bch_signTransaction (mint). If the wallet never responds,
			// we time out rather than leave the UI stuck.
			const WC_SIGN_TIMEOUT_MS = 120_000;
			const result = await Promise.race([
				client.request({
					chainId: BCH_CHAIN,
					topic: session.topic,
					request: {
						method: 'bch_signTransaction',
						params: {
							transaction: genesisBuild.unsignedTxHex,
							sourceOutputs,
							broadcast: false,
							userPrompt: 'Sign CashTokens genesis'
						}
					}
				}),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('Wallet did not respond within 2 minutes. Your wallet may not support bch_signTransaction — try the manual paste-hex flow below instead.')), WC_SIGN_TIMEOUT_MS)
				)
			]);
			console.log('[mint-wc] sign result type:', typeof result, result ? JSON.stringify(result).slice(0, 200) : 'null/undefined');

			if (!result) {
				wcSignError = 'Wallet returned an empty response. Try again.';
				return;
			}
			const signed =
				typeof result === 'string' ? result
				: (result as { signedTransaction?: string; signedTransactionHash?: string }).signedTransaction;
			if (!signed) {
				wcSignError = 'Wallet response missing signed transaction. Try again.';
				return;
			}
			signedTxHex = signed;
			await broadcast();

			// Clean up the WC session.
			try {
				await client.disconnect({
					topic: session.topic,
					reason: { code: 6000, message: 'Mint signing complete' }
				});
			} catch { /* best-effort */ }
		} catch (e) {
			wcSignError = (e as Error).message || 'WalletConnect signing failed';
		} finally {
			wcSigning = false;
		}
	}

	async function prepareFunding() {
		prepareInProgress = true;
		prepareError = null;
		prepareDone = false;
		try {
			if (plainUtxos.length === 0) {
				prepareError = 'No plain-BCH UTXOs available for consolidation.';
				return;
			}

			// Derive the P2PKH lock for the user's address.
			const lockResult = cashAddressToLockingBytecode(data!.cashaddr ?? '');
			if (typeof lockResult === 'string') {
				prepareError = `Could not derive locking script: ${lockResult}`;
				return;
			}
			const selfLock = lockResult.bytecode;

			// Build consolidation tx: all plain-BCH UTXOs as inputs,
			// single self-output at vout=0.
			const inputs: Array<{
				outpointTransactionHash: Uint8Array;
				outpointIndex: number;
				sequenceNumber: number;
				unlockingBytecode: Uint8Array;
			}> = [];
			const sourceOutputs: Array<{
				outpointTransactionHash: string;
				outpointIndex: number;
				sequenceNumber: number;
				lockingBytecode: string;
				unlockingBytecode: string;
				valueSatoshis: string;
			}> = [];
			let totalInputSats = 0n;
			for (const u of plainUtxos) {
				console.log('[prepareFunding] UTXO:', u.txid.slice(0, 16), 'vout:', u.vout, 'value:', u.valueSats);
				inputs.push({
					outpointTransactionHash: hexToBin(u.txid),
					outpointIndex: u.vout,
					sequenceNumber: 0xfffffffe,
					unlockingBytecode: new Uint8Array(0)
				});
				sourceOutputs.push({
					outpointTransactionHash: `<Uint8Array: 0x${u.txid}>`,
					outpointIndex: u.vout,
					sequenceNumber: 0xfffffffe,
					lockingBytecode: `<Uint8Array: 0x${binToHex(selfLock)}>`,
					unlockingBytecode: '<Uint8Array: 0x>',
					valueSatoshis: `<bigint: ${u.valueSats}n>`
				});
				totalInputSats += BigInt(u.valueSats);
			}

			const TX_OVERHEAD = 10n;
			const INPUT_BYTES = 41n;
			const SIG_BYTES_PER_INPUT = 106n; // DER sig(~71) + pubkey(33) + push ops(2)
			const OUTPUT_BYTES = 34n;
			const estimatedBytes =
				TX_OVERHEAD + BigInt(inputs.length) * (INPUT_BYTES + SIG_BYTES_PER_INPUT) + OUTPUT_BYTES;
			let feeSats = estimatedBytes; // 1 sat/byte
			const outputSats = Number(totalInputSats - feeSats);
			if (outputSats < 546) {
				prepareError = `Not enough BCH to cover fee. Total: ${totalInputSats} sats, fee: ${feeSats} sats.`;
				return;
			}
			const tx = {
				version: 2,
				locktime: 0,
				inputs,
				outputs: [{
					lockingBytecode: selfLock,
					valueSatoshis: BigInt(outputSats)
				}]
			};
			const unsignedTxBin = encodeTransaction(tx as Parameters<typeof encodeTransaction>[0]);
			const unsignedTxHex = binToHex(unsignedTxBin);
			const WC_PROJECT_ID = publicEnv.PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';
			if (!WC_PROJECT_ID) { prepareError = 'WC not configured.'; return; }
			const BCH_CHAIN = 'bch:bitcoincash';
			let client: any;
			let session: { topic: string; namespaces: { bch?: { accounts?: string[] } } };
			console.log('[prepareFunding] wcSession:', !!wcSession.client, !!wcSession.session, '_mwc:', !!_mwc);
			if (_mwc) {
				client = _mwc.client;
				session = _mwc.session;
			} else {
				const [{ default: SignClient }, { WalletConnectModal }] = await Promise.all([
					import('@walletconnect/sign-client'),
					import('@walletconnect/modal')
				]);
				client = await SignClient.init({
					projectId: WC_PROJECT_ID,
					metadata: {
						name: 'Token Stork — Mint',
						description: 'Sign CashTokens transactions',
						url: window.location.origin,
						icons: [`${window.location.origin}/logo-simple-bch.png`]
					}
				});
				const modal = new WalletConnectModal({
					projectId: WC_PROJECT_ID,
					themeMode: document.documentElement.classList.contains('dark') ? 'dark' : 'light'
				});
				const { uri, approval } = await client.connect({
					optionalNamespaces: { bch: { chains: [BCH_CHAIN], methods: ['bch_signTransaction', 'bch_getAddresses'], events: [] } }
				});
				try { session = await approval(); } finally { modal.closeModal(); }
				_mwc = { client, session };
				console.log('[prepareFunding] stored _mwc, topic:', session.topic.slice(0, 16));
			}
			const accounts = session.namespaces.bch?.accounts ?? [];
			if (accounts.length === 0) { prepareError = 'Wallet returned no addresses.'; return; }
			const walletCashaddr = accounts[0].split(':').slice(2).join(':');
			const normA = (a: string) => a.replace(/^bitcoincash:/, '');
			if (normA(walletCashaddr) !== normA(data!.cashaddr ?? '')) {
				prepareError = 'Connected wallet does not match your authenticated address.';
				return;
			}
			const WC_SIGN_TIMEOUT_MS = 120_000;
			const result = await Promise.race([
				client.request({
					chainId: BCH_CHAIN,
					topic: session.topic,
					request: {
						method: 'bch_signTransaction',
						params: {
							transaction: unsignedTxHex,
							sourceOutputs,
							broadcast: false,
							userPrompt: `Consolidate ${totalInputSats.toLocaleString()} sats into one UTXO`
						}
					}
				}),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('Wallet did not respond within 2 minutes.')), WC_SIGN_TIMEOUT_MS)
				)
			]);
			console.log('[prepareFunding] sign result:', typeof result, JSON.stringify(result).slice(0, 200));
			const signed = typeof result === 'string' ? result : (result as { signedTransaction?: string })?.signedTransaction;
			if (!signed) { prepareError = 'Wallet returned no signed transaction.'; return; }

			// Broadcast.
			const bcRes = await fetch('/api/mint/broadcast', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ rawHex: signed })
			});
			if (!bcRes.ok) {
				const msg = (await bcRes.json().catch(() => ({})) as { message?: string }).message;
				prepareError = msg ?? `Broadcast failed (${bcRes.status})`;
				return;
			}

			try { await client.disconnect({ topic: session.topic, reason: { code: 6000, message: 'Done' } }); } catch { /* ok */ }
			prepareDone = true;
			fundingUtxosFetched = false;
			fetchFundingUtxos();
		} catch (e) {
			prepareError = (e as Error).message || 'Prepare funding failed';
		} finally {
			prepareInProgress = false;
		}
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
			// Guard: pasting the unsigned tx back without signing is the
			// most common user error. The unsigned tx has a zero-length
			// unlocking bytecode (scriptSig = 00); a signed tx's scriptSig
			// is 106-108 bytes (71-73 byte DER sig + 33 byte pubkey + 1-2
			// byte push opcodes). Any signed tx must be ≥ 228 bytes.
			if (signedTxHex.trim().length < 460) {
				broadcastError = 'This hex is too short to be a signed transaction — it looks like the unsigned tx from step 4. Sign it in your wallet first, then paste the signed version.';
				return;
			}
			if (genesisBuild && signedTxHex.trim() === genesisBuild.unsignedTxHex) {
				broadcastError = 'This is the unsigned transaction. Sign it in your wallet first, then paste the signed hex here.';
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
			// Persist the broadcast result. The on-chain tx HAS landed at
			// this point (we have the txid from BCHN); we MUST record it
			// so /mints + the receipt page reflect reality. If the PATCH
			// response is non-OK (state-machine guard rejected, network
			// error, server crash), set the persist-failed banner so the
			// user sees "tx broadcast successfully (txid: …) but the
			// session record is out of sync — visit /mints" and isn't
			// confused by a still-drafting state on resume.
			if (sessionId && broadcastTxid && mintedCategoryHex) {
				try {
					const persistRes = await fetch(`/api/mint/sessions/${sessionId}`, {
						method: 'PATCH',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({
							state: 'broadcast',
							genesisTxidHex: broadcastTxid,
							categoryHex: mintedCategoryHex
						})
					});
					if (!persistRes.ok) {
						console.warn(
							'[mint] post-broadcast PATCH non-OK',
							persistRes.status,
							await persistRes.text().catch(() => '<no body>')
						);
						lastSaveFailed = true;
					}
				} catch (err) {
					console.warn('[mint] post-broadcast PATCH threw', err);
					lastSaveFailed = true;
				}
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
		if (ipfsProvider === 'lighthouse') {
			const res = await fetch('https://upload.lighthouse.storage/api/v0/add', {
				method: 'POST',
				headers: { authorization: `Bearer ${key}` },
				body: fd
			});
			if (!res.ok) {
				const t = await res.text().catch(() => '');
				throw new Error(`Lighthouse HTTP ${res.status}: ${t.slice(0, 200)}`);
			}
			const body = (await res.json()) as { data?: { Hash?: string } };
			if (!body.data?.Hash) throw new Error('Lighthouse returned no CID');
			return body.data.Hash;
		}
		const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
			method: 'POST',
			headers: { authorization: `Bearer ${key}` },
			body: fd
		});
		if (!res.ok) {
			const t = await res.text().catch(() => '');
			throw new Error(`Pinata HTTP ${res.status}: ${t.slice(0, 200)}`);
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

	// Abandon the current draft. Soft-deletes via PATCH state='abandoned'
	// (server-side preferred over DELETE so the session row is kept for
	// audit and the per-user MAX_DRAFTING_PER_USER cap reclaims the slot
	// because only `state='drafting'` rows count against it). Resets the
	// wizard back to step 1 with empty fields so the user can start
	// fresh in the same browser session.
	async function discardDraft() {
		discardError = null;
		if (!confirm('Discard this draft? You will lose any progress in the current wizard.')) return;
		// No server session yet (user dropped before crossing step 1) —
		// just clear local state and bounce back to step 1.
		if (!sessionId) {
			resetWizardLocal();
			return;
		}
		discarding = true;
		try {
			const res = await fetch(`/api/mint/sessions/${sessionId}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ state: 'abandoned' })
			});
			if (!res.ok) {
				discardError = `Could not discard (${res.status}).`;
				return;
			}
			resetWizardLocal();
		} catch (e) {
			discardError = (e as Error).message;
		} finally {
			discarding = false;
		}
	}

	function resetWizardLocal() {
		sessionId = null;
		tokenType = null;
		ticker = '';
		name = '';
		description = '';
		decimals = 0;
		totalSupply = '';
		nftCommitmentHex = '';
		nftCapability = 'none';
		outpointTxid = '';
		outpointSatoshis = 2000;
		signedTxHex = '';
		broadcastTxid = null;
		broadcastError = null;
		mintedCategoryHex = null;
		genesisBuild = null;
		genesisBuildError = null;
		lastSaveFailed = false;
		step = 1;
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
		{#if lastSaveFailed}
			<div
				class="mb-4 px-4 py-2 rounded-lg border bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/40 text-xs text-amber-800 dark:text-amber-200"
				role="status"
			>
				Couldn't save your draft on the last step transition — your progress is in memory only. A refresh will lose it. Next save attempt will retry automatically.
			</div>
		{/if}
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
						<strong>Pinata</strong> or <strong>Lighthouse</strong> using your own API key.
						The file never reaches Token Stork's server. Once pinned, the resulting
						<code>ipfs://&lt;cid&gt;</code> populates the Icon URI field above.
					</p>
					<div class="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
						<label class="block">
							<span class="font-medium ts-text-strong">Provider</span>
							<select bind:value={ipfsProvider} class="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs ts-border-strong ts-surface-page">
								<option value="pinata">Pinata</option>
								<option value="lighthouse">Lighthouse</option>
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
				<p class="text-sm mb-4 ts-text-muted">
					Your token's <strong>category ID</strong> is the txid of a UTXO you own at
					<strong>vout=0</strong>. We'll auto-detect suitable UTXOs from your wallet below.
					The recipient is automatically set to your authenticated address.
				</p>

				<!-- Funding UTXO selector -->
				<div class="mb-5 p-4 rounded-lg border ts-border-subtle bg-slate-50 dark:bg-zinc-950">
					<div class="flex items-center justify-between mb-3">
						<span class="text-sm font-medium ts-text-strong">Funding UTXO</span>
						<button type="button" onclick={fetchFundingUtxos}
							class="text-xs px-2 py-1 rounded border ts-border-strong hover:bg-slate-100 dark:hover:bg-zinc-900">
							{fundingUtxosLoading ? 'Checking…' : '🔄 Refresh'}
						</button>
					</div>

					{#if fundingUtxosLoading}
						<p class="text-xs ts-text-muted">Checking your wallet for suitable UTXOs…</p>
					{:else if fundingUtxosError}
						<p class="text-xs text-amber-600 dark:text-amber-400">{fundingUtxosError}</p>
						<p class="text-xs mt-1 ts-text-muted">You can still paste a txid manually below.</p>
					{:else if fundingUtxos.length > 0}
						<label class="block">
							<span class="text-xs font-medium ts-text-muted">Select a vout=0 UTXO</span>
							<select bind:value={outpointTxid} class="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-mono ts-border-strong ts-surface-page"
								onchange={(e) => {
									const txid = (e.currentTarget as HTMLSelectElement).value;
									const match = fundingUtxos.find(u => u.txid === txid);
									if (match) outpointSatoshis = match.valueSats;
								}}>
								{#each fundingUtxos as utxo}
									<option value={utxo.txid}>{utxo.txid.slice(0,16)}… — {utxo.valueSats.toLocaleString()} sats</option>
								{/each}
							</select>
						</label>
						<p class="text-xs mt-2 ts-text-muted">Found {fundingUtxos.length} suitable UTXO{fundingUtxos.length===1?'':'s'} at vout=0.</p>
						{#if plainUtxos.filter(u => u.txid !== outpointTxid).length > 0}
							<details class="text-xs mt-2" open={extraInputTxids.length > 0}>
								<summary class="cursor-pointer ts-text-muted">+ Add extra funding ({plainUtxos.filter(u => u.txid !== outpointTxid).length} UTXOs)</summary>
								<div class="mt-2 max-h-32 overflow-y-auto space-y-1">
									{#each plainUtxos.filter(u => u.txid !== outpointTxid) as u}
										<label class="flex items-center gap-2 text-xs ts-text-muted cursor-pointer">
											<input type="checkbox"
												checked={extraInputTxids.includes(u.txid)}
												onchange={(e) => {
													const chk = e.currentTarget as HTMLInputElement;
													extraInputTxids = chk.checked
														? [...extraInputTxids, u.txid]
														: extraInputTxids.filter(t => t !== u.txid);
												}}
											/>
											<span class="font-mono">{u.txid.slice(0,12)}… vout={u.vout}</span>
											<span class="ml-auto">{u.valueSats.toLocaleString()} sats</span>
										</label>
									{/each}
								</div>
							</details>
						{/if}
					{:else if fundingUtxosDiag}
						<div class="text-xs space-y-2">
							<p class="text-amber-700 dark:text-amber-300"><strong>No suitable vout=0 UTXOs found.</strong></p>
							<p class="ts-text-muted">Your wallet has <strong>{fundingUtxosDiag.total}</strong> UTXOs total. Breakdown:</p>
							<ul class="list-disc pl-4 space-y-0.5 ts-text-muted">
								<li>{fundingUtxosDiag.notVout0} skipped — not at vout=0</li>
								{#if fundingUtxosDiag.hasTokens > 0}<li>{fundingUtxosDiag.hasTokens} skipped — carry tokens</li>{/if}
							</ul>
							{#if plainUtxos.length > 0}
								<div class="mt-3 p-3 rounded bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900">
									<p class="text-xs text-violet-900 dark:text-violet-200 mb-2"><strong>You have {plainUtxos.length} plain-BCH UTXOs.</strong> Consolidate into one vout=0 with one wallet tap.</p>
									<button type="button" onclick={prepareFunding} disabled={prepareInProgress}
										class="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium">
										{prepareInProgress ? 'Connecting…' : '🚀 Create funding UTXO'}
									</button>
									{#if prepareError}<p class="text-xs text-rose-600 mt-2">{prepareError}</p>{/if}
									{#if prepareDone}<p class="text-xs text-emerald-600 mt-2">Broadcast! Refreshing…</p>{/if}
								</div>
							{:else}
								<p class="text-amber-700 dark:text-amber-300 mt-1"><strong>No plain-BCH UTXOs.</strong> Send BCH to yourself first.</p>
							{/if}
						</div>
					{:else}
						<p class="text-xs ts-text-muted">Click Refresh to scan your wallet.</p>
					{/if}
				</div>

				<!-- Manual override -->
				<details class="text-xs mb-5 ts-text-muted">
					<summary class="cursor-pointer">Or paste a txid manually</summary>
					<div class="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
						<label class="block sm:col-span-2">
							<span class="text-xs font-medium ts-text-strong">Outpoint txid (vout=0)</span>
							<input type="text" bind:value={outpointTxid} placeholder="64-char hex" class="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-mono ts-border-strong ts-surface-page" />
						</label>
						<label class="block">
							<span class="text-xs font-medium ts-text-strong">UTXO value (sats)</span>
							<input type="number" min="1000" bind:value={outpointSatoshis} class="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-mono ts-border-strong ts-surface-page" />
						</label>
					</div>
				</details>

				{#if manualOutpointWarning}
					<p class="text-xs text-amber-600 dark:text-amber-400 mb-3 p-2 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900">
						⚠️ {manualOutpointWarning.message}
					</p>
				{/if}

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
						<p class="mt-2">
							Note: the input's unlocking script is empty here — your wallet fills it during
							signing. That's why the hex below is shorter than the typical 220+ byte signed tx.
						</p>
					</details>
				{/if}
			{:else if step === 5}
				<h2 class="text-xl font-semibold text-slate-900 dark:text-white mb-2">5. Sign & broadcast</h2>

				<!-- Unsigned tx hex — surfaced here so the user doesn't need to go back to step 4 -->
				<div class="mb-5 p-4 rounded-lg border ts-border-subtle bg-slate-50 dark:bg-zinc-950">
					<div class="flex items-center justify-between mb-2">
						<span class="text-sm font-medium ts-text-strong">Unsigned transaction</span>
						<button
							type="button"
							onclick={copyUnsignedTx}
							disabled={!genesisBuild}
							class="text-xs px-2 py-1 rounded border ts-border-strong hover:bg-slate-100 dark:hover:bg-zinc-900 disabled:opacity-50"
						>
							{copiedUnsignedTx ? 'Copied ✓' : '📋 Copy'}
						</button>
					</div>
					<p class="text-xs mb-2 ts-text-muted">
						Sign this in your wallet, then paste the <strong>signed</strong> hex below.
					</p>
					<pre class="p-3 rounded bg-white dark:bg-black border break-all whitespace-pre-wrap text-[10px] font-mono ts-border-subtle">{genesisBuild?.unsignedTxHex ?? '(build the tx in step 4 first)'}</pre>
				</div>


				<div class="mb-4 flex flex-wrap items-center gap-3">
					<button
						type="button"
						onclick={signWithWalletConnect}
						disabled={wcSigning || !genesisBuild}
						class="px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium"
					>
						{wcSigning ? 'Connecting to wallet…' : '✍️ Sign with Wallet'}
					</button>
					<span class="text-xs ts-text-muted">or paste signed hex below</span>
				</div>

				{#if wcSignError}
					<p class="text-xs text-rose-600 dark:text-rose-400 mb-3">{wcSignError}</p>
				{/if}

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
						Paste your own <strong>Pinata</strong> JWT or <strong>Lighthouse</strong> API
						key. The upload runs <em>directly</em> from your browser to the IPFS provider —
						your key never reaches Token Stork's server, and we clear it from memory after
						each attempt. Returns a CID you can use as <code>ipfs://&lt;cid&gt;</code> in
						BCMR registries or directly in your wallet.
					</p>
					<p class="text-xs text-amber-700 dark:text-amber-300 mb-3">
						⚠️ Pinata and Lighthouse both require an API key from their respective dashboards
						(<a href="https://app.pinata.cloud/developers/api-keys" class="underline" target="_blank" rel="noopener">Pinata</a>,
						<a href="https://files.lighthouse.storage/" class="underline" target="_blank" rel="noopener">Lighthouse</a>).
						Lighthouse offers a free tier (5 GB/yr); Pinata offers 1 GB free with 100 file limit.
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
								<option value="pinata">Pinata (JWT)</option>
								<option value="lighthouse">Lighthouse</option>
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

		{#if step !== 6}
			<div class="mt-4 max-w-2xl text-xs">
				<button
					type="button"
					onclick={discardDraft}
					disabled={discarding}
					class="text-rose-600 dark:text-rose-400 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
				>
					{discarding ? 'Discarding…' : 'Discard this draft'}
				</button>
				{#if discardError}
					<span class="ml-3 text-rose-600 dark:text-rose-400">{discardError}</span>
				{/if}
			</div>
		{/if}
	{/if}
</main>
