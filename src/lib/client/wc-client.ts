// Shared WalletConnect client for signing BCH transactions.
// Wraps @walletconnect/sign-client + @walletconnect/modal into reusable
// primitives imported by both the mint and BCMR publish wizards.
//
// Each function is independently importable so a page only pays for what
// it uses. The SignClient is lazy-init'd and cached at module level
// (survives soft navigations via wcSession in wc-session.ts).
//
// Not Svelte state — these are plain async functions that return promises.

import { wcSession } from './wc-session';
import { env as publicEnv } from '$env/dynamic/public';

/** Full session bundle returned by connectWallet. */
export interface WcSessionBundle {
	client: unknown;
	session: { topic: string; namespaces: { bch?: { accounts?: string[] } } };
	topic: string;
}

/**
 * Get (or lazily init) the module-level SignClient. Cached in wcSession
 * so it survives SvelteKit soft navigations without re-initialising.
 * Throws if PUBLIC_WALLETCONNECT_PROJECT_ID is unset.
 */
export async function getSignClient(): Promise<unknown> {
	if (wcSession.client) return wcSession.client;
	const projectId = publicEnv.PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';
	if (!projectId) {
		throw new Error(
			'WalletConnect is not configured on this deployment. ' +
				'Set PUBLIC_WALLETCONNECT_PROJECT_ID and rebuild.'
		);
	}
	const { default: SignClient } = await import('@walletconnect/sign-client');
	const client = await SignClient.init({
		projectId,
		metadata: {
			name: 'Token Stork',
			description: 'Sign BCH transactions',
			url: window.location.origin,
			icons: [`${window.location.origin}/logo-simple-bch.png`]
		}
	});
	wcSession.client = client;
	return client;
}

/**
 * Open WalletConnect modal, pair with the user's wallet, and verify that
 * the connected wallet's cashaddr matches `expectedCashaddr`.
 *
 * @returns The WC session bundle (client, session, topic).
 * @throws If WC is unconfigured, pairing fails, or the wallet address
 *   doesn't match the authenticated user.
 */
export async function connectWallet(
	expectedCashaddr: string
): Promise<WcSessionBundle> {
	const client = (await getSignClient()) as any;
	const projectId = publicEnv.PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';
	const themeMode = document.documentElement.classList.contains('dark')
		? 'dark'
		: 'light';

	const { WalletConnectModal } = await import('@walletconnect/modal');
	const modal: any = new WalletConnectModal({ projectId, themeMode });

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
		modal.closeModal();
		throw new Error(
			'WalletConnect returned no pairing URI. Try again or paste the signed hex manually.'
		);
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
		throw new Error('Wallet did not return any addresses. Try again.');
	}
	const walletCashaddr = accounts[0].split(':').slice(2).join(':');
	const normAddr = (a: string) => a.replace(/^bitcoincash:/, '');
	if (normAddr(walletCashaddr) !== normAddr(expectedCashaddr)) {
		throw new Error(
			`Connected wallet (${walletCashaddr.slice(0, 12)}…) does not match your authenticated address. ` +
				'Sign in with the same wallet.'
		);
	}

	wcSession.session = { topic: session.topic };
	return { client, session, topic: session.topic };
}

/**
 * Request the wallet to sign a transaction via `bch_signTransaction`.
 *
 * @param client The SignClient instance.
 * @param topic The active WC session topic.
 * @param unsignedTxHex The unsigned raw tx hex to sign.
 * @param sourceOutputs Source-output payload for WC2. Each entry must
 *   include `outpointTransactionHash`, `outpointIndex`, `valueSatoshis`,
 *   `lockingBytecodeHex`, and optionally `token`.
 * @param userPrompt Short human-readable prompt shown in the wallet UI.
 * @returns The signed tx hex string.
 * @throws On timeout (2 min), empty response, or wallet rejection.
 */
export async function signTransaction(
	client: unknown,
	topic: string,
	unsignedTxHex: string,
	// WC2 bch_signTransaction source-outputs. Two serialization forms
	// are valid: `lockingBytecodeHex` (raw hex) and `lockingBytecode`
	// (<Uint8Array: 0x...> string tokens). Accept both via a relaxed
	// Record shape since we pass these through without inspection.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	sourceOutputs: any[],
	userPrompt: string
): Promise<string> {
	const BCH_CHAIN = 'bch:bitcoincash';
	const WC_SIGN_TIMEOUT_MS = 120_000;

	const result = await Promise.race([
		(client as any).request({
			chainId: BCH_CHAIN,
			topic,
			request: {
				method: 'bch_signTransaction',
				params: {
					transaction: unsignedTxHex,
					sourceOutputs,
					broadcast: false,
					userPrompt
				}
			}
		}),
		new Promise<never>((_, reject) =>
			setTimeout(
				() =>
					reject(
						new Error(
							'Wallet did not respond within 2 minutes. ' +
								'Your wallet may not support bch_signTransaction — ' +
								'try the manual paste-hex flow instead.'
						)
					),
				WC_SIGN_TIMEOUT_MS
			)
		)
	]);

	if (!result) {
		throw new Error('Wallet returned an empty response. Try again.');
	}
	const signed =
		typeof result === 'string'
			? result
			: (result as { signedTransaction?: string })?.signedTransaction;
	if (!signed) {
		throw new Error(
			'Wallet response missing signedTransaction. Try again.'
		);
	}
	return signed;
}

/**
 * Best-effort disconnect from the WC session. Swallows errors so callers
 * can fire-and-forget after a successful signing flow.
 */
export async function disconnectWallet(
	client: unknown,
	topic: string
): Promise<void> {
	try {
		await (client as any).disconnect({
			topic,
			reason: { code: 6000, message: 'Signing complete' }
		});
	} catch {
		/* best-effort */
	}
}
