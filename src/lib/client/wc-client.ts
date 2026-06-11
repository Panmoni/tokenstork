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
import { decodeTransaction, hexToBin, stringify } from '@bitauth/libauth';

// [wc-debug] temporary diagnostic logging for the publish-bcmr signing hang.
// Remove with: grep -rn 'wc-debug' src/
function wcLog(...args: unknown[]): void {
	console.log(`[wc-debug ${new Date().toISOString().slice(11, 23)}]`, ...args);
}

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
	if (wcSession.client) {
		wcLog('getSignClient: reusing cached SignClient');
		return wcSession.client;
	}
	const projectId = publicEnv.PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';
	if (!projectId) {
		throw new Error(
			'WalletConnect is not configured on this deployment. ' +
				'Set PUBLIC_WALLETCONNECT_PROJECT_ID and rebuild.'
		);
	}
	wcLog('getSignClient: importing @walletconnect/sign-client…');
	const { default: SignClient } = await import('@walletconnect/sign-client');
	wcLog('getSignClient: import done, SignClient.init() starting (relay connect)…');
	const t0 = performance.now();
	const client = await SignClient.init({
		projectId,
		metadata: {
			name: 'Token Stork',
			description: 'Sign BCH transactions',
			url: window.location.origin,
			icons: [`${window.location.origin}/logo-simple-bch.png`]
		}
	});
	wcLog(`getSignClient: init done in ${Math.round(performance.now() - t0)}ms`);
	// Surface relay/session lifecycle events so hangs are attributable.
	const evClient = client as unknown as {
		on?: (ev: string, cb: (payload: unknown) => void) => void;
	};
	for (const ev of [
		'session_proposal',
		'session_update',
		'session_delete',
		'session_expire',
		'session_event',
		'proposal_expire',
		'session_request_sent'
	]) {
		try {
			evClient.on?.(ev, (payload) => wcLog(`client event "${ev}"`, payload));
		} catch (err) {
			wcLog(`failed to attach listener for "${ev}"`, err);
		}
	}
	wcSession.client = client;
	return client;
}

/**
 * Open WalletConnect modal, pair with the user's wallet, and verify that
 * the connected wallet's cashaddr matches `expectedCashaddr`.
 *
 * **Session reuse:** if a previous WC session is cached in wcSession and
 * still paired, it is reused — no modal popup. This mirrors the old
 * `_mwc` caching pattern from the mint wizard.
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

	// Try to reuse a persisted session. SignClient persists sessions to
	// IndexedDB/localStorage, so a session from a previous page (e.g. the
	// login flow) is still listed here after a full reload — the old
	// in-memory wcSession check never survived a hard navigation, which
	// is why users were re-shown the QR modal on every transaction.
	wcLog('connectWallet: start', { expectedCashaddr });
	try {
		const store = client.session;
		const existingSessions: Array<{
			topic: string;
			expiry?: number;
			namespaces: Record<string, { accounts?: string[] }>;
		}> =
			typeof store?.getAll === 'function'
				? store.getAll()
				: Array.isArray(store?.values)
					? store.values
					: [];
		const nowSec = Math.floor(Date.now() / 1000);
		wcLog(
			'connectWallet: persisted sessions',
			existingSessions.map((s) => ({
				topic: `${s.topic.slice(0, 8)}…`,
				expiresInMin: s.expiry ? Math.round((s.expiry - nowSec) / 60) : null,
				bchAccounts: s.namespaces?.bch?.accounts
			}))
		);
		const normAddr = (a: string) => a.replace(/^bitcoincash:/, '');
		const match = existingSessions.find((s) => {
			if (s.expiry && s.expiry <= nowSec + 60) return false;
			const acct = s.namespaces?.bch?.accounts?.[0] ?? '';
			const walletCashaddr = acct.split(':').slice(2).join(':');
			return walletCashaddr !== '' && normAddr(walletCashaddr) === normAddr(expectedCashaddr);
		});
		if (match) {
			wcLog('connectWallet: REUSING persisted session', `${match.topic.slice(0, 8)}…`);
			wcSession.session = { topic: match.topic };
			return {
				client,
				session: match as WcSessionBundle['session'],
				topic: match.topic
			};
		}
		wcLog('connectWallet: no reusable persisted session — fresh pairing');
	} catch (err) {
		wcLog('connectWallet: persisted-session check THREW — fresh pairing', err);
	}

	wcLog('connectWallet: importing @walletconnect/modal…');
	const { WalletConnectModal } = await import('@walletconnect/modal');
	const modal: any = new WalletConnectModal({ projectId, themeMode });

	const BCH_CHAIN = 'bch:bitcoincash';
	wcLog('connectWallet: calling client.connect() for pairing URI…');
	const { uri, approval } = await client.connect({
		optionalNamespaces: {
			bch: {
				chains: [BCH_CHAIN],
				methods: ['bch_signTransaction', 'bch_getAddresses'],
				events: []
			}
		}
	});
	wcLog('connectWallet: client.connect() returned', { hasUri: !!uri });

	if (!uri) {
		modal.closeModal();
		throw new Error(
			'WalletConnect returned no pairing URI. Try again or paste the signed hex manually.'
		);
	}

	modal.openModal({ uri });
	wcLog('connectWallet: modal opened — awaiting wallet approval() (no timeout; hangs here if wallet never responds)');
	let session: { topic: string; namespaces: { bch?: { accounts?: string[] } } };
	try {
		session = await approval();
		wcLog('connectWallet: approval() resolved', {
			topic: `${session.topic.slice(0, 8)}…`,
			bchAccounts: session.namespaces.bch?.accounts
		});
	} catch (err) {
		wcLog('connectWallet: approval() REJECTED', err);
		throw err;
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
		wcLog('connectWallet: address mismatch', { walletCashaddr, expectedCashaddr });
		throw new Error(
			`Connected wallet (${walletCashaddr.slice(0, 12)}…) does not match your authenticated address. ` +
				'Sign in with the same wallet.'
		);
	}

	wcLog('connectWallet: connected OK', { topic: `${session.topic.slice(0, 8)}…` });
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

	// The wc2-bch-bcr spec allows `transaction` to be raw hex, but
	// Paytaca's handler does `transaction.inputs.map(...)` directly — a
	// hex string makes the wallet throw before it ever responds (observed
	// as a silent 2-minute timeout). Send the decoded libauth Transaction
	// in extended-JSON form (libauth `stringify`), which both the spec and
	// Paytaca accept.
	const decoded = decodeTransaction(hexToBin(unsignedTxHex));
	if (typeof decoded === 'string') {
		throw new Error(`Failed to decode unsigned transaction: ${decoded}`);
	}
	const transaction = JSON.parse(stringify(decoded));

	wcLog('signTransaction: sending bch_signTransaction request', {
		topic: `${topic.slice(0, 8)}…`,
		txHexLength: unsignedTxHex.length,
		transaction,
		sourceOutputCount: sourceOutputs.length,
		firstSourceOutput: sourceOutputs[0]
	});
	const t0 = performance.now();
	let result: unknown;
	try {
		result = await Promise.race([
		(client as any).request({
			chainId: BCH_CHAIN,
			topic,
			request: {
				method: 'bch_signTransaction',
				params: {
					transaction,
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
								'If no signing prompt appeared in your wallet, the session may be stale — ' +
								'it has been reset, so clicking "Sign with Wallet" again will re-pair. ' +
								'Or use the manual paste-hex flow below.'
						)
					),
				WC_SIGN_TIMEOUT_MS
			)
		)
		]);
	} catch (err) {
		wcLog(`signTransaction: FAILED after ${Math.round(performance.now() - t0)}ms`, err);
		// A timeout usually means the session is dead on the wallet side.
		// Drop it so the next attempt does a fresh pairing instead of
		// hanging on the same dead topic.
		if ((err as Error).message?.includes('did not respond')) {
			wcSession.session = null;
			(client as any)
				.disconnect({ topic, reason: { code: 6000, message: 'Sign request timed out' } })
				.catch(() => {});
			wcLog('signTransaction: stale session dropped after timeout', `${topic.slice(0, 8)}…`);
		}
		throw err;
	}
	wcLog(`signTransaction: wallet responded in ${Math.round(performance.now() - t0)}ms`, {
		resultType: typeof result,
		resultKeys: result && typeof result === 'object' ? Object.keys(result) : undefined,
		signedLength:
			typeof result === 'string'
				? result.length
				: (result as { signedTransaction?: string })?.signedTransaction?.length
	});

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
		wcLog('disconnectWallet: disconnecting', `${topic.slice(0, 8)}…`);
		await (client as any).disconnect({
			topic,
			reason: { code: 6000, message: 'Signing complete' }
		});
		wcLog('disconnectWallet: done');
	} catch (err) {
		wcLog('disconnectWallet: failed (best-effort, ignored)', err);
	}
}
