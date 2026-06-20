<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { env as publicEnv } from '$env/dynamic/public';
	import { wcSession } from '$lib/client/wc-session';
	import * as m from '$lib/paraglide/messages';
	import { getLocale, localizeHref } from '$lib/paraglide/runtime';
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
				reason: m.login_err_not_configured()
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
					description: m.login_wc_app_description(),
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
				optionalNamespaces: {
					bch: {
						chains: [BCH_CHAIN],
						methods: ['bch_signMessage', 'bch_signTransaction', 'bch_getAddresses'],
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
						userPrompt: m.login_wc_user_prompt()
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

			// Store the WC session for reuse by mint/prepareFunding.
			// The auth cookie handles identity; keeping the WC pairing
			// alive lets in-page signing reuse it without a new QR.
			wcSession.client = client;
			wcSession.session = sessionResult;
			wcSession.cashaddr = cashaddr;
			await invalidateAll();
			await goto(localizeHref('/'));
		} catch (err) {
			modal?.closeModal();
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
			stage = { kind: 'error', reason: m.login_err_enter_cashaddr() };
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
			await goto(localizeHref('/'));
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
	<title>{m.login_meta_title()}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
	<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent mb-3">
		{m.login_h1()}
	</h1>
	<p class="mb-8 max-w-prose ts-text-muted">
		{m.login_intro()}
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
				{m.login_connect_wallet()}
			</button>
			<p class="text-xs ts-text-muted">
				{m.login_wallet_support_before()}
				<a class="text-violet-600 dark:text-violet-400 hover:underline" href="https://github.com/mainnet-pat/wc2-bch-bcr" target="_blank" rel="noopener noreferrer">{m.login_wallet_support_link()}</a>.
			</p>
			<div>
				<button
					type="button"
					onclick={startManual}
					class="text-sm hover:text-slate-900 dark:hover:text-white underline-offset-4 hover:underline ts-text-muted"
				>
					{m.login_sign_manually()} →
				</button>
				<p class="text-xs mt-1 ts-text-faint">
					{m.login_manual_hint()}
				</p>
			</div>
		</div>
	{:else if stage.kind === 'wc-connecting'}
		<p class="ts-text-muted">{m.login_wc_connecting()}</p>
	{:else if stage.kind === 'wc-awaiting-approval'}
		<p class="ts-text-muted">
			{m.login_wc_awaiting()}
		</p>
		<button
			type="button"
			onclick={reset}
			class="mt-4 text-sm hover:underline ts-text-muted"
		>
			{m.login_cancel()}
		</button>
	{:else if stage.kind === 'wc-signing'}
		<p class="ts-text-muted">
			{m.login_wc_signing()}
		</p>
	{:else if stage.kind === 'verifying'}
		<p class="ts-text-muted">{m.login_verifying()}</p>
	{:else if stage.kind === 'enter-address'}
		<form onsubmit={requestChallengeManual} class="space-y-4">
			<label class="block">
				<span class="block text-sm font-medium mb-2 ts-text-strong">
					{m.login_cashaddr_label()}
				</span>
				<input
					type="text"
					bind:value={cashaddrInput}
					placeholder="bitcoincash:qr…"
					autocomplete="off"
					autocapitalize="off"
					spellcheck="false"
					class="w-full px-3 py-2 rounded-lg border font-mono text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 ts-border-strong ts-surface-panel"
				/>
				<p class="text-xs mt-2 ts-text-muted">
					{m.login_cashaddr_hint()}
				</p>
			</label>
			<div class="flex gap-2">
				<button
					type="submit"
					class="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-medium text-sm transition-colors"
				>
					{m.login_continue()}
				</button>
				<button
					type="button"
					onclick={reset}
					class="px-4 py-2 rounded-lg bg-slate-200 dark:bg-zinc-700 font-medium text-sm hover:bg-slate-300 dark:hover:bg-zinc-600 ts-text-strong"
				>
					← {m.login_back_to_wc()}
				</button>
			</div>
		</form>
	{:else if stage.kind === 'sign'}
		<div class="space-y-6">
			<section>
				<h2 class="text-sm font-semibold uppercase tracking-wider mb-2 ts-text-muted">
					{m.login_step1()}
				</h2>
				<div class="relative">
					<pre class="text-xs sm:text-sm font-mono whitespace-pre-wrap break-all rounded-lg border p-4 ts-border-strong ts-surface-soft">{stage.message}</pre>
					<button
						type="button"
						onclick={copyMessage}
						class="absolute top-2 right-2 px-2 py-1 rounded text-xs font-medium bg-slate-200 dark:bg-zinc-700 hover:bg-slate-300 dark:hover:bg-zinc-600 ts-text-strong"
					>
						{copied ? m.login_copied() : m.login_copy()}
					</button>
				</div>
				<details class="mt-3 text-sm ts-text-muted">
					<summary class="cursor-pointer text-violet-600 dark:text-violet-400 hover:underline">
						{m.login_how_to_sign()}
					</summary>
					<ul class="list-disc list-inside ml-2 mt-2 space-y-1">
						<li><strong>Electron Cash</strong> — {m.login_wallet_ec_steps()}</li>
						<li><strong>Cashonize</strong> — {m.login_wallet_cashonize_steps()}</li>
						<li><strong>Paytaca</strong> — {m.login_wallet_paytaca_steps()}</li>
					</ul>
					<p class="mt-2">{m.login_copy_sig_before()} <code>=</code>{m.login_copy_sig_after()}</p>
				</details>
			</section>

			<form onsubmit={submitSignatureManual} class="space-y-4">
				<label class="block">
					<span class="block text-sm font-semibold uppercase tracking-wider mb-2 ts-text-muted">
						{m.login_step2()}
					</span>
					<textarea
						bind:value={signatureInput}
						placeholder="IF8gK…="
						rows="3"
						autocomplete="off"
						spellcheck="false"
						class="w-full px-3 py-2 rounded-lg border font-mono text-xs focus:outline-none focus:ring-2 focus:ring-violet-500 ts-border-strong ts-surface-panel"
					></textarea>
				</label>
				<div class="flex gap-2">
					<button
						type="submit"
						class="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-medium text-sm transition-colors"
					>
						{m.login_sign_in()}
					</button>
					<button
						type="button"
						onclick={reset}
						class="px-4 py-2 rounded-lg bg-slate-200 dark:bg-zinc-700 font-medium text-sm hover:bg-slate-300 dark:hover:bg-zinc-600 ts-text-strong"
					>
						{m.login_start_over()}
					</button>
				</div>
				<p class="text-xs ts-text-muted">
					{m.login_challenge_expires({ time: new Date(stage.expiresAt).toLocaleTimeString(getLocale()) })}
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
			class="mt-4 px-4 py-2 rounded-lg bg-slate-200 dark:bg-zinc-700 font-medium text-sm hover:bg-slate-300 dark:hover:bg-zinc-600 ts-text-strong"
		>
			{m.login_start_over()}
		</button>
	{/if}

	<section class="mt-12 text-sm space-y-2 ts-text-muted">
		<h2 class="text-xs font-semibold uppercase tracking-wider ts-text-muted">
			{m.login_why_title()}
		</h2>
		<p>
			{m.login_why_p1()}
		</p>
		<p>
			{m.login_why_p2()}
		</p>
	</section>
</main>
