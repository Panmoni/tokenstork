<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { env as publicEnv } from '$env/dynamic/public';

	// Two paths to acquire a wallet signature for the auth handshake:
	//
	//   1. Primary — WalletConnect v2 over the BCH namespace defined by
	//      mainnet-pat/wc2-bch-bcr. Wallets that ship support today:
	//      Cashonize, Zapit, Paytaca; Electron Cash plugin in alpha.
	//      Click "Connect Wallet" → SignClient establishes a pairing →
	//      QR / deep-link modal opens → wallet returns the cashaddr +
	//      signs the challenge → we hand the signature to the same
	//      /api/auth/verify endpoint the manual path uses. The server
	//      doesn't know or care which path produced the signature; the
	//      base64 \x18Bitcoin Signed Message:\n format is identical.
	//
	//   2. Fallback — paste cashaddr + paste signature manually. Works
	//      for users without a WC-aware wallet (older Electron Cash, or
	//      users who only have a paper wallet / signing tool). Tucked
	//      behind a "Sign manually instead" link.
	//
	// PUBLIC_WALLETCONNECT_PROJECT_ID is required on both client and
	// server — in dev set it in `.env` (or the shell), in prod put it in
	// `/etc/tokenstork/env`. Get a free project ID at
	// https://cloud.walletconnect.com (now Reown Cloud). The ID is a
	// public attribution token (per-deployment quota tracking) — not a
	// secret.

	const WC_PROJECT_ID = publicEnv.PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';
	const BCH_CHAIN = 'bch:bitcoincash';

	type Stage =
		| { kind: 'idle' }
		| { kind: 'wc-connecting' }
		| { kind: 'wc-awaiting-approval'; uri: string }
		| { kind: 'wc-signing' }
		| { kind: 'verifying' }
		| { kind: 'enter-address' }
		| { kind: 'sign'; nonce: string; message: string; expiresAt: string }
		| { kind: 'error'; reason: string };

	let stage: Stage = $state({ kind: 'idle' });
	let cashaddrInput: string = $state('');
	let signatureInput: string = $state('');
	let copied = $state(false);

	// ---------------------------------------------------------------
	// WalletConnect v2 path
	// ---------------------------------------------------------------

	async function connectWallet() {
		if (!WC_PROJECT_ID) {
			stage = {
				kind: 'error',
				reason:
					'WalletConnect is not configured on this deployment. Set PUBLIC_WALLETCONNECT_PROJECT_ID and rebuild, or sign manually below.'
			};
			return;
		}

		stage = { kind: 'wc-connecting' };

		// Lazy-load the SDK only when the user actually clicks Connect.
		// Keeps it out of every other page's bundle.
		const [{ default: SignClient }, { WalletConnectModal }] = await Promise.all([
			import('@walletconnect/sign-client'),
			import('@walletconnect/modal')
		]);

		// Use `any` for the WC types — the package's exported types are
		// awkward to thread through Svelte's <script> context (they
		// reference internal Struct types not surfaced as named exports).
		// Runtime behavior is fully exercised; the only thing TypeScript
		// would catch here is the connect() / request() shape, both of
		// which we already validate via runtime checks.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let client: any = null;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let modal: any = null;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let session: any = null;

		try {
			client = await SignClient.init({
				projectId: WC_PROJECT_ID,
				metadata: {
					name: 'Token Stork',
					description: 'BCH CashTokens directory + arbitrage scanner',
					url: window.location.origin,
					icons: [`${window.location.origin}/logo-simple-bch.png`]
				}
			});

			modal = new WalletConnectModal({
				projectId: WC_PROJECT_ID,
				themeMode: document.documentElement.classList.contains('dark') ? 'dark' : 'light'
			});

			// Per the wc2-bch-bcr spec: namespace `bch`, chain
			// `bch:bitcoincash`, method `bch_signMessage`. We only ask for
			// the signing method we need — narrow scope = clearer wallet
			// approval prompt.
			const { uri, approval } = await client.connect({
				requiredNamespaces: {
					bch: {
						chains: [BCH_CHAIN],
						methods: ['bch_signMessage'],
						events: []
					}
				}
			});
			if (!uri) throw new Error('WalletConnect returned no pairing URI');

			modal.openModal({ uri });
			stage = { kind: 'wc-awaiting-approval', uri };

			const sessionResult = await approval();
			modal.closeModal();

			// CAIP-10 account format: `bch:bitcoincash:bitcoincash:qr…`
			// — namespace, reference, then the address (which itself
			// contains a colon). Slice past the chainId portion.
			const accounts = sessionResult.namespaces.bch?.accounts ?? [];
			if (accounts.length === 0) {
				throw new Error('Wallet did not return any addresses');
			}
			const cashaddr = accounts[0].split(':').slice(2).join(':');

			// Step A: get a server-issued challenge for that cashaddr.
			const chRes = await fetch('/api/auth/challenge', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ cashaddr })
			});
			if (!chRes.ok) {
				const body = await chRes.json().catch(() => ({}));
				throw new Error(body?.message ?? `Challenge request failed (${chRes.status})`);
			}
			const challenge = (await chRes.json()) as {
				nonce: string;
				message: string;
			};

			// Step B: ask the wallet to sign the challenge. The wallet UI
			// will show the user the message they're being asked to sign;
			// the userPrompt is a wallet-side hint that some wallets
			// surface alongside the message.
			stage = { kind: 'wc-signing' };
			const signatureRaw: unknown = await client.request({
				chainId: BCH_CHAIN,
				topic: sessionResult.topic,
				request: {
					method: 'bch_signMessage',
					params: {
						message: challenge.message,
						userPrompt: 'Sign in to Token Stork'
					}
				}
			});
			if (typeof signatureRaw !== 'string' || signatureRaw.length === 0) {
				throw new Error('Wallet returned an empty signature');
			}
			const signature = signatureRaw;

			// Step C: server verifies + sets cookie.
			stage = { kind: 'verifying' };
			const vRes = await fetch('/api/auth/verify', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ nonce: challenge.nonce, signature })
			});
			if (!vRes.ok) {
				const body = await vRes.json().catch(() => ({}));
				throw new Error(body?.error ?? `Verification failed (${vRes.status})`);
			}

			// Cleanup: disconnect the WC session. The auth cookie is the
			// persistent state from here on; keeping the WC pairing
			// open would leave a stale entry in the wallet's "connected
			// dApps" list.
			session = sessionResult;
			await client
				.disconnect({
					topic: session.topic,
					reason: { code: 6000, message: 'Login complete' }
				})
				.catch(() => {
					// Best-effort cleanup; don't fail the user-visible
					// flow if the disconnect call hiccups.
				});

			await invalidateAll();
			await goto('/');
		} catch (err) {
			modal?.closeModal();
			if (session && client) {
				await client
					.disconnect({
						topic: session.topic,
						reason: { code: 6000, message: 'Login aborted' }
					})
					.catch(() => undefined);
			}
			stage = {
				kind: 'error',
				reason: err instanceof Error ? err.message : 'Unknown error'
			};
		}
	}

	// ---------------------------------------------------------------
	// Manual paste-and-go fallback
	// ---------------------------------------------------------------

	function startManual() {
		stage = { kind: 'enter-address' };
		cashaddrInput = '';
		signatureInput = '';
	}

	async function requestChallengeManual(e: Event) {
		e.preventDefault();
		const trimmed = cashaddrInput.trim();
		if (!trimmed) {
			stage = { kind: 'error', reason: 'Enter a cashaddr first' };
			return;
		}
		try {
			const res = await fetch('/api/auth/challenge', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ cashaddr: trimmed })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				stage = { kind: 'error', reason: body?.message ?? `Server returned ${res.status}` };
				return;
			}
			const data = (await res.json()) as { nonce: string; message: string; expiresAt: string };
			stage = { kind: 'sign', nonce: data.nonce, message: data.message, expiresAt: data.expiresAt };
		} catch (err) {
			stage = {
				kind: 'error',
				reason: err instanceof Error ? err.message : 'Network error'
			};
		}
	}

	async function submitSignatureManual(e: Event) {
		e.preventDefault();
		if (stage.kind !== 'sign') return;
		const trimmed = signatureInput.trim();
		if (!trimmed) return;
		const nonce = stage.nonce;
		stage = { kind: 'verifying' };
		try {
			const res = await fetch('/api/auth/verify', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ nonce, signature: trimmed })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				stage = {
					kind: 'error',
					reason: body?.error ?? `Server returned ${res.status}`
				};
				return;
			}
			await invalidateAll();
			await goto('/');
		} catch (err) {
			stage = {
				kind: 'error',
				reason: err instanceof Error ? err.message : 'Network error'
			};
		}
	}

	async function copyMessage() {
		if (stage.kind !== 'sign') return;
		try {
			await navigator.clipboard.writeText(stage.message);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// Fallback: user can select-and-copy manually
		}
	}

	function reset() {
		stage = { kind: 'idle' };
		cashaddrInput = '';
		signatureInput = '';
	}
</script>

<svelte:head>
	<title>Sign in — Token Stork</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
	<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent mb-3">
		Sign in with your BCH wallet
	</h1>
	<p class="text-slate-600 dark:text-zinc-300 mb-8 max-w-prose">
		No email, no password. Connect via WalletConnect — your wallet handles
		the cryptography; we just verify the signature and issue a session.
	</p>

	{#if stage.kind === 'idle'}
		<div class="space-y-6">
			<button
				type="button"
				onclick={connectWallet}
				class="w-full sm:w-auto px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-semibold text-base transition-colors flex items-center justify-center gap-2"
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<rect x="3" y="6" width="18" height="13" rx="2" />
					<path d="M16 12h2" />
					<path d="M3 10h18" />
				</svg>
				Connect Wallet
			</button>
			<p class="text-xs text-slate-500 dark:text-zinc-300">
				Works with Cashonize, Paytaca, Zapit, and any other wallet that supports the
				<a class="text-violet-600 dark:text-violet-400 hover:underline" href="https://github.com/mainnet-pat/wc2-bch-bcr" target="_blank" rel="noopener noreferrer">BCH WalletConnect v2 namespace</a>.
			</p>
			<div>
				<button
					type="button"
					onclick={startManual}
					class="text-sm text-slate-500 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-white underline-offset-4 hover:underline"
				>
					Sign manually instead →
				</button>
				<p class="text-xs text-slate-400 dark:text-zinc-400 mt-1">
					For users without a WalletConnect-aware wallet — paste your cashaddr and a signed-message signature.
				</p>
			</div>
		</div>
	{:else if stage.kind === 'wc-connecting'}
		<p class="text-slate-600 dark:text-zinc-300">Initializing WalletConnect…</p>
	{:else if stage.kind === 'wc-awaiting-approval'}
		<p class="text-slate-600 dark:text-zinc-300">
			Approve the connection in your wallet. The QR code modal should be open above this page.
		</p>
		<button
			type="button"
			onclick={reset}
			class="mt-4 text-sm text-slate-500 dark:text-zinc-300 hover:underline"
		>
			Cancel
		</button>
	{:else if stage.kind === 'wc-signing'}
		<p class="text-slate-600 dark:text-zinc-300">
			Approve the message signature in your wallet…
		</p>
	{:else if stage.kind === 'verifying'}
		<p class="text-slate-600 dark:text-zinc-300">Verifying signature…</p>
	{:else if stage.kind === 'enter-address'}
		<form onsubmit={requestChallengeManual} class="space-y-4">
			<label class="block">
				<span class="block text-sm font-medium text-slate-700 dark:text-zinc-200 mb-2">
					Your BCH cashaddr
				</span>
				<input
					type="text"
					bind:value={cashaddrInput}
					placeholder="bitcoincash:qr…"
					autocomplete="off"
					autocapitalize="off"
					spellcheck="false"
					class="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
				/>
				<p class="text-xs text-slate-500 dark:text-zinc-300 mt-2">
					Mainnet P2PKH only. The cashaddr you enter must match the address whose private key you'll sign with.
				</p>
			</label>
			<div class="flex gap-2">
				<button
					type="submit"
					class="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-medium text-sm transition-colors"
				>
					Continue
				</button>
				<button
					type="button"
					onclick={reset}
					class="px-4 py-2 rounded-lg bg-slate-200 dark:bg-zinc-700 text-slate-700 dark:text-zinc-100 font-medium text-sm hover:bg-slate-300 dark:hover:bg-zinc-600"
				>
					← Back to WalletConnect
				</button>
			</div>
		</form>
	{:else if stage.kind === 'sign'}
		<div class="space-y-6">
			<section>
				<h2 class="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-300 mb-2">
					Step 1 — Sign this message in your wallet
				</h2>
				<div class="relative">
					<pre class="text-xs sm:text-sm font-mono whitespace-pre-wrap break-all rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 p-4">{stage.message}</pre>
					<button
						type="button"
						onclick={copyMessage}
						class="absolute top-2 right-2 px-2 py-1 rounded text-xs font-medium bg-slate-200 dark:bg-zinc-700 hover:bg-slate-300 dark:hover:bg-zinc-600 text-slate-700 dark:text-zinc-100"
					>
						{copied ? 'Copied' : 'Copy'}
					</button>
				</div>
				<details class="mt-3 text-sm text-slate-600 dark:text-zinc-300">
					<summary class="cursor-pointer text-violet-600 dark:text-violet-400 hover:underline">
						How to sign in popular wallets
					</summary>
					<ul class="list-disc list-inside ml-2 mt-2 space-y-1">
						<li><strong>Electron Cash</strong> — Tools → Sign / Verify Message → paste address + message → Sign.</li>
						<li><strong>Cashonize</strong> — Settings → Sign Message → choose your wallet → paste message → Sign.</li>
						<li><strong>Paytaca</strong> — Settings → Sign Message → select wallet → paste message → Sign.</li>
					</ul>
					<p class="mt-2">Copy the resulting signature (a base64 string ending in <code>=</code>) and paste it below.</p>
				</details>
			</section>

			<form onsubmit={submitSignatureManual} class="space-y-4">
				<label class="block">
					<span class="block text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-300 mb-2">
						Step 2 — Paste the signature
					</span>
					<textarea
						bind:value={signatureInput}
						placeholder="IF8gK…="
						rows="3"
						autocomplete="off"
						spellcheck="false"
						class="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-violet-500"
					></textarea>
				</label>
				<div class="flex gap-2">
					<button
						type="submit"
						class="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-medium text-sm transition-colors"
					>
						Sign in
					</button>
					<button
						type="button"
						onclick={reset}
						class="px-4 py-2 rounded-lg bg-slate-200 dark:bg-zinc-700 text-slate-700 dark:text-zinc-100 font-medium text-sm hover:bg-slate-300 dark:hover:bg-zinc-600"
					>
						Start over
					</button>
				</div>
				<p class="text-xs text-slate-500 dark:text-zinc-300">
					Challenge expires {new Date(stage.expiresAt).toLocaleTimeString()}.
				</p>
			</form>
		</div>
	{:else if stage.kind === 'error'}
		<div class="p-4 rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/20 text-sm text-rose-700 dark:text-rose-300">
			{stage.reason}
		</div>
		<button
			type="button"
			onclick={reset}
			class="mt-4 px-4 py-2 rounded-lg bg-slate-200 dark:bg-zinc-700 text-slate-700 dark:text-zinc-100 font-medium text-sm hover:bg-slate-300 dark:hover:bg-zinc-600"
		>
			Start over
		</button>
	{/if}

	<section class="mt-12 text-sm text-slate-600 dark:text-zinc-300 space-y-2">
		<h2 class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-300">
			Why wallet login?
		</h2>
		<p>
			The address you sign with becomes your account. We store nothing
			the wallet didn't already prove you control — no email, no
			recovery phone, no password to lose.
		</p>
		<p>
			This unlocks the wallet-tied watchlist, future portfolio
			tracking, and per-token annotations. Until those land, login
			doesn't gate any of the directory data — it's all public.
		</p>
	</section>
</main>
