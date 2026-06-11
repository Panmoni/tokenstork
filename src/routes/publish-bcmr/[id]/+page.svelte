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
	//                 tokenstork for operator approval.
	//   5 build+sign — decision-tree readiness diagnostic + WalletConnect
	//                  one-click sign-and-broadcast, with paste-hex
	//                  fallback.
	//   6 broadcast  — forward signed hex to BCHN.
	//
	// State persists via /api/bcmr/sessions/[id] PATCH on each step
	// transition. Resume-across-refresh is automatic — the SSR loader
	// hydrates everything from the session row.

	import { goto } from '$app/navigation';
	import type { BcmrPublishSession } from '$lib/server/bcmrPublishSessions';
	import type { WalletUtxo } from '$lib/server/walletUtxos';
	import type { TxReadinessReport } from '$lib/client/txReadiness';
	import { checkBcmrPublishReadiness } from '$lib/client/txReadiness';
	import { connectWallet, signTransaction, disconnectWallet } from '$lib/client/wc-client';
	import { buildConsolidationTx, plainUtxosToConsolidationInputs } from '$lib/client/consolidationBuilder';
	import { cashAddressToLockingBytecode, binToHex } from '@bitauth/libauth';

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
	let ipfsUploading = $state(false);
	let ipfsCid = $state<string | null>(null);
	let ipfsError = $state<string | null>(null);
	let ipfsKeyInput = $state('');

	// Step 4: publication verification + optional tokenstork backup.

	// Step 4: publication verification + optional tokenstork backup.

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

	// Step 5: build tx + smart flow (WC + readiness) + paste-hex fallback.
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

	// Step 5 smart flow: readiness diagnostic + WalletConnect one-click.
	let readiness = $state<TxReadinessReport | null>(null);
	let readinessLoading = $state(false);
	let wcSigning = $state(false);
	let wcSignError = $state<string | null>(null);
	let prepareInProgress = $state(false);
	let prepareError = $state<string | null>(null);
	let prepareDone = $state(false);
	let walletUtxos = $state<WalletUtxo[]>([]);

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
		publicationUri: string | null;
	}>) {
		saveError = null;
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
	}

	async function pinCanonicalJson() {
		// canonicalJson is client-only and resets on page load. If null but
		// the session has a content hash, re-fetch the canonical bytes.
		if (!canonicalJson) { await runCanonicalize(); }
		const json = canonicalJson;
		if (!json) { ipfsError = 'Generate the canonical JSON first.'; return; }
		ipfsUploading = true; ipfsError = null;
		try {
			let { key, provider } = (() => {
				const saved = localStorage.getItem('mint-ipfs-key');
				if (saved) return JSON.parse(saved) as { key: string; provider: string };
				return { key: ipfsKeyInput, provider: 'pinata' };
			})();
			if (!key) { ipfsError = 'Enter your Pinata API key below.'; return; }

			// Compute content hash from the canonical JSON bytes so we can
			// check whether this file is already pinned.
			const jsonBytes = new TextEncoder().encode(json);
			const hashBuffer = await crypto.subtle.digest('SHA-256', jsonBytes);
			const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

			// Check Pinata pinList for an existing pin with matching content.
			let cid: string | null = null;
			if (provider === 'pinata') {
				try {
					const pinListRes = await fetch(
						`https://api.pinata.cloud/data/pinList?hashContains=${hashHex}&status=pinned&pageLimit=5`,
						{ headers: { authorization: `Bearer ${key}` } }
					);
					if (pinListRes.ok) {
						const pinList = await pinListRes.json() as { rows?: Array<{ ipfs_pin_hash: string }> };
						if (pinList.rows && pinList.rows.length > 0) {
							cid = pinList.rows[0].ipfs_pin_hash;
							console.log('[bcmr-pin] found existing pin:', cid);
						}
					}
				} catch { /* pinList check is best-effort */ }
			}

			if (!cid) {
				const blob = new Blob([json], { type: 'application/json' });
				const fd = new FormData(); fd.append('file', blob, 'bcmr.json');
				const url = provider === 'lighthouse' ? 'https://upload.lighthouse.storage/api/v0/add' : 'https://api.pinata.cloud/pinning/pinFileToIPFS';
				const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: fd });
				if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`${provider} HTTP ${res.status}: ${t.slice(0,200)}`); }
				const body = await res.json();
				cid = provider === 'lighthouse' ? body.data?.Hash : body.IpfsHash;
				if (!cid) throw new Error(`${provider} returned no CID`);
			}
			ipfsCid = cid;
			publicationUriInput = `ipfs://${cid}`;
			await patchSession({ publicationUri: publicationUriInput }).catch(() => {});
		} catch (e) { ipfsError = (e as Error).message; }
		finally { ipfsUploading = false; }
	}

	async function copyToClipboard(text: string) {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			/* clipboard API failed — silently no-op */
		}
	}
	async function runVerify() {
		const raw = publicationUriInput.trim();
		if (!raw) { verifyResult = { ok: false, reason: 'invalid-url', message: 'Enter a URL first' }; return; }
		const verifyUri = raw.startsWith('ipfs://')
			? `https://gateway.pinata.cloud/ipfs/${raw.slice(7)}`
			: raw;
		verifyResult = null;
		verifying = true;
		try {
			const res = await fetch(`/api/bcmr/sessions/${session.id}/verify-uri`, {
				method: 'POST', headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ publicationUri: verifyUri })
			});
			if (res.status === 200) {
				const body = await res.json() as { ok: true; session: BcmrPublishSession; sizeBytes: number } | { ok: false; reason: string; message: string };
				if (body.ok) { session = body.session; verifyResult = { ok: true, sizeBytes: body.sizeBytes }; }
				else verifyResult = body;
			} else {
				const body = await res.json().catch(() => ({})) as { message?: string };
				verifyResult = { ok: false, reason: 'server-error', message: body.message ?? `HTTP ${res.status}` };
			}
		} catch (e) { verifyResult = { ok: false, reason: 'network', message: (e as Error).message }; }
		finally { verifying = false; }
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
		// Guard: pasting the unsigned tx without signing is the most common error.
		if (session.unsignedTxHex && trimmed === session.unsignedTxHex) {
			broadcastError = 'This is the unsigned transaction. Sign it in your wallet first.';
			return;
		}
		broadcasting = true;
		broadcastError = null;
		try {
			const controller = new AbortController();
			const bcto = setTimeout(() => controller.abort(), 30000);
			const res = await fetch(`/api/bcmr/sessions/${session.id}/broadcast`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ signedTxHex: trimmed }),
				signal: controller.signal
			});
			clearTimeout(bcto);
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

	// ─── Step 5 smart flow helpers ─────────────────────────────────

	async function fetchAndCheckReadiness() {
		readinessLoading = true;
		readiness = null;
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 20000);
			const res = await fetch(`/api/bcmr/sessions/${session.id}/readiness`, { signal: controller.signal });
			clearTimeout(timeout);
			if (!res.ok) {
				readiness = {
					ready: false,
					requirements: [{ label: 'Wallet check', satisfied: false, reason: `Readiness check failed (HTTP ${res.status})`, fixable: 'refresh' }],
					summary: 'Readiness check failed'
				};
				return;
			}
			const body = (await res.json()) as {
				ownsAuthNft: boolean | null;
				authNftPresent: boolean;
				authNftValueSats: number | null;
				authchainHeadTxidHex: string | null;
				totalBchSats: string;
				plainUtxoCount: number;
				error?: string;
			};

			// Build a minimal WalletUtxo array for the readiness checker.
			const bchValue = BigInt(body.totalBchSats || '0');
			const dummyUtxos: WalletUtxo[] = [];
			if (body.ownsAuthNft && body.authNftValueSats != null) {
				dummyUtxos.push({
					txid: body.authchainHeadTxidHex ?? '',
					vout: 0,
					valueSats: BigInt(body.authNftValueSats),
					height: 0
				});
			}
			if (body.plainUtxoCount > 0 && bchValue > 0n) {
				dummyUtxos.push({
					txid: '0000000000000000000000000000000000000000000000000000000000000000',
					vout: 1,
					valueSats: bchValue,
					height: 0
				});
			}
			walletUtxos = dummyUtxos;

			readiness = checkBcmrPublishReadiness({
				walletUtxos: dummyUtxos,
				ownsAuthNft: body.ownsAuthNft,
				authNftPresent: body.authNftPresent,
				authNftValueSats: body.authNftValueSats != null ? BigInt(body.authNftValueSats) : undefined
			});
			if (body.error) {
				readiness.summary = `Note: ${body.error}`;
			}
		} catch (err) {
			readiness = {
				ready: false,
				requirements: [
					{ label: 'Wallet check', satisfied: false, reason: (err as Error).message || 'Readiness check failed', fixable: 'refresh' }
				],
				summary: 'Readiness check failed'
			};
		} finally {
			readinessLoading = false;
		}
	}

	async function signAndBroadcastWithWC() {
		wcSignError = null;
		wcSigning = true;
		try {
			// 1. Build the unsigned tx server-side.
			const buildRes = await fetch(`/api/bcmr/sessions/${session.id}/build-tx`, {
				method: 'POST'
			});
			if (!buildRes.ok) {
				const errBody = (await buildRes.json().catch(() => ({}))) as { message?: string };
				throw new Error(errBody.message ?? `Build failed (HTTP ${buildRes.status})`);
			}
			const build = (await buildRes.json()) as {
				unsignedTxHex: string;
				sourceOutputs: Array<{
					outpointTransactionHash: string;
					outpointIndex: number;
					valueSatoshis: string;
					lockingBytecodeHex: string;
					token?: { categoryHex: string; amount: string; commitmentHex?: string; capability?: string };
				}>;
				alreadyBuilt: boolean;
				session: BcmrPublishSession;
			};
			session = build.session;

			// 2. Connect to wallet via WalletConnect.
			const { client, topic } = await connectWallet(data.session.cashaddr);

			// 3. Sign the tx.
			const signedHex = await signTransaction(
				client,
				topic,
				build.unsignedTxHex,
				build.sourceOutputs,
				'Sign BCMR publication'
			);

			// 4. Broadcast via server.
			const bcRes = await fetch(`/api/bcmr/sessions/${session.id}/broadcast`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ signedTxHex: signedHex })
			});
			if (!bcRes.ok) {
				const errBody = (await bcRes.json().catch(() => ({}))) as { message?: string };
				throw new Error(errBody.message ?? `Broadcast failed (HTTP ${bcRes.status})`);
			}
			const bcBody = (await bcRes.json()) as {
				txid: string;
				alreadyBroadcast: boolean;
				session?: BcmrPublishSession;
			};
			broadcastTxid = bcBody.txid;
			if (bcBody.session) session = bcBody.session;
			step = 6;

			// 5. Cleanup WC session.
			await disconnectWallet(client, topic);
		} catch (err) {
			wcSignError = (err as Error).message || 'WalletConnect signing failed';
		} finally {
			wcSigning = false;
		}
	}

	async function prepareFundingConsolidation() {
		prepareInProgress = true;
		prepareError = null;
		prepareDone = false;
		try {
			// Get plain-BCH UTXOs for consolidation.
			const res = await fetch('/api/wallet/funding-utxos');
			if (!res.ok) throw new Error(`UTXO fetch failed (HTTP ${res.status})`);
			const body = (await res.json()) as {
				plainUtxos: Array<{ txid: string; vout: number; valueSats: number; height: number }>;
			};
			if (body.plainUtxos.length === 0) {
				throw new Error('No plain-BCH UTXOs available for consolidation.');
			}

			// Connect WC.
			const { client, topic } = await connectWallet(data.session.cashaddr);

			// Derive locking bytecode for source outputs.
			const lockResult = cashAddressToLockingBytecode(data.session.cashaddr);
			if (typeof lockResult === 'string') throw new Error(`Address decode failed: ${lockResult}`);
			const selfLockHex = binToHex(lockResult.bytecode);

			// Build consolidation tx.
			const inputs = plainUtxosToConsolidationInputs(body.plainUtxos);
			const consolidation = buildConsolidationTx(inputs, data.session.cashaddr);

			// Build sourceOutputs with WC2 <Uint8Array: ...> tokens.
			const sourceOutputs = body.plainUtxos.map((u) => ({
				outpointTransactionHash: `<Uint8Array: 0x${u.txid}>`,
				outpointIndex: u.vout,
				sequenceNumber: 0xfffffffe,
				lockingBytecode: `<Uint8Array: 0x${selfLockHex}>`,
				unlockingBytecode: '<Uint8Array: 0x>',
				valueSatoshis: `<bigint: ${u.valueSats}n>`
			}));

			// Sign via WC.
			const signedHex = await signTransaction(
				client,
				topic,
				consolidation.unsignedTxHex,
				sourceOutputs,
				`Consolidate ${inputs.length} UTXOs`
			);

			// Broadcast.
			const bcRes = await fetch('/api/mint/broadcast', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ rawHex: signedHex })
			});
			if (!bcRes.ok) {
				const errBody = (await bcRes.json().catch(() => ({}))) as { message?: string };
				throw new Error(errBody.message ?? `Broadcast failed (${bcRes.status})`);
			}

			await disconnectWallet(client, topic);
			prepareDone = true;
			// Refresh readiness to pick up the new UTXO.
			await fetchAndCheckReadiness();
		} catch (err) {
			prepareError = (err as Error).message || 'Consolidation failed';
		} finally {
			prepareInProgress = false;
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
							console.log('[bcmr-upload] ident:', ident ? { name: ident.name, token_symbol: ident.token?.symbol } : null);
							if (ident) {
								if (ident.name) name = ident.name;
								if (ident.token?.symbol) ticker = ident.token.symbol;
								else if (ident.symbol) ticker = ident.symbol;
								if (typeof ident.token?.decimals === 'number') decimals = ident.token.decimals;
								else if (typeof ident.decimals === 'number') decimals = ident.decimals;
								if (ident.description) description = ident.description;
								if (ident.uris?.icon) iconUri = ident.uris.icon;
								// Save and advance to step 2 (Icon).
								await patchSession({
									name: name || undefined,
									ticker: ticker || undefined,
									decimals,
									description: description || undefined,
									iconUri: iconUri || undefined
								}).catch(() => {});
								step = 2;
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
					<div class="p-3 rounded-md bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900">
						{#if ipfsCid}
							<p class="text-xs text-emerald-700 dark:text-emerald-300">Pinned ✓ <code>ipfs://{ipfsCid}</code></p>
						{:else}
							<button type="button" onclick={pinCanonicalJson} disabled={ipfsUploading}
								class="px-4 py-2 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50">
								{ipfsUploading ? 'Pinning…' : '🚀 Pin to IPFS'}
							</button>
							{#if !localStorage.getItem('mint-ipfs-key')}
								<div class="mt-2">
									<input type="password" bind:value={ipfsKeyInput} placeholder="Pinata JWT or Lighthouse API key"
										class="w-full px-3 py-1.5 text-xs rounded border ts-border-strong font-mono" />
									<span class="block mt-1 text-[10px] ts-text-muted">Saved to localStorage — never sent to Token Stork.</span>
								</div>
							{/if}
							{#if ipfsError}<p class="text-xs text-rose-600 mt-2">{ipfsError}</p>{/if}
						{/if}
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
				<span class="text-sm font-medium ts-text-strong">Publication URL (https:// or ipfs://)</span>
				<input
					type="url"
					maxlength="2048"
					bind:value={publicationUriInput}
					placeholder="https://your-host.example/path/to/bcmr.json"
					class="mt-1 w-full px-3 py-2 rounded-md border ts-border-strong ts-surface-input font-mono text-sm"
					disabled={!!session.publicationVerifiedAt}
				/>
				<span class="block mt-1 text-xs ts-text-muted">
					HTTPS or ipfs:// accepted. If your host uses redirects, paste the final URL. Maximum 8 MiB body.
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
				We build the unsigned transaction that spends your category's authority NFT, emits a new
				authority NFT to your wallet, and attaches an <code class="text-xs">OP_RETURN BCMR</code>
				locator. Token Stork can orchestrate the signing via WalletConnect — or you can build,
				sign manually, and paste the hex below.
			</p>

			<!-- Readiness diagnostic card -->
			<div class="mb-5 p-4 rounded-lg border ts-border-subtle bg-slate-50 dark:bg-zinc-950">
				<div class="flex items-center justify-between mb-3">
					<span class="text-sm font-medium ts-text-strong">Transaction readiness</span>
					<button
						type="button"
						onclick={fetchAndCheckReadiness}
						disabled={readinessLoading}
						class="text-xs px-2 py-1 rounded border ts-border-strong hover:bg-slate-100 dark:hover:bg-zinc-900 disabled:opacity-50"
					>
						{readinessLoading ? 'Checking…' : '🔄 Check wallet'}
					</button>
				</div>

				{#if readinessLoading}
					<p class="text-xs ts-text-muted">Checking your wallet for sufficient BCH and the authority NFT…</p>
				{:else if readiness}
					<div class="space-y-2">
						{#each readiness.requirements as req}
							<div class="flex items-start gap-2 text-xs">
								<span class="mt-0.5 shrink-0">
									{#if req.satisfied}
										<span class="text-emerald-600 dark:text-emerald-400">✅</span>
									{:else}
										<span class="text-rose-500">❌</span>
									{/if}
								</span>
								<div>
									<span class="font-medium ts-text-strong">{req.label}</span>
									{#if !req.satisfied && req.reason}
										<p class="ts-text-muted">{req.reason}</p>
									{/if}
								</div>
							</div>
						{/each}
					</div>

					<!-- Action buttons based on readiness -->
					<div class="mt-4 flex flex-wrap items-center gap-3">
						{#if readiness.ready}
							<button
								type="button"
								onclick={signAndBroadcastWithWC}
								disabled={wcSigning}
								class="px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium"
							>
								{wcSigning ? 'Connecting to wallet…' : '✍️ Sign with Wallet'}
							</button>
							<span class="text-xs ts-text-muted">or sign manually below</span>
						{:else if readiness.requirements.some(r => !r.satisfied && r.fixable === 'consolidate-bch')}
							<button
								type="button"
								onclick={prepareFundingConsolidation}
								disabled={prepareInProgress}
								class="px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium"
							>
								{prepareInProgress ? 'Consolidating…' : '🚀 Create funding UTXO'}
							</button>
							<span class="text-xs ts-text-muted">Consolidate plain BCH into one spendable UTXO</span>
						{:else if !readiness.ready}
							<p class="text-xs text-amber-700 dark:text-amber-300">
								Resolve the issues above to enable one-click signing, or use the manual flow below.
							</p>
						{/if}
					</div>

					{#if wcSignError}
						<p class="mt-2 text-xs text-rose-600 dark:text-rose-400">{wcSignError}</p>
					{/if}
					{#if prepareError}
						<p class="mt-2 text-xs text-rose-600 dark:text-rose-400">{prepareError}</p>
					{/if}
					{#if prepareDone}
						<p class="mt-2 text-xs text-emerald-600 dark:text-emerald-400">Consolidation broadcast! Refreshing readiness…</p>
					{/if}
				{:else}
					<p class="text-xs ts-text-muted">Click "Check wallet" to see if you're ready to publish.</p>
				{/if}
			</div>

			<!-- Manual paste-hex fallback (collapsible) -->
			<details class="mt-4 mb-5" open={!readiness?.ready}>
				<summary class="cursor-pointer text-sm font-medium ts-text-strong">or sign manually</summary>
				<div class="mt-4 space-y-4">
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
						<p class="text-sm text-rose-600 dark:text-rose-400" role="alert">{buildTxError}</p>
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
									Sign this hex in your wallet (Paytaca, Electron Cash, Cashonize, etc.). Then paste the signed hex below.
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
				</div>
			</details>
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
					<!-- Step 5 advances via the WC sign or broadcast button; no separate Next button needed -->
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
