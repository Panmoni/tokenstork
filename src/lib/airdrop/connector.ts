// Wallet connector for the airdrop flow.
//
// **STATUS**: scaffolded for v2; UNUSED in v1. The v1 wizard at
// `src/routes/airdrops/new/+page.svelte` uses the existing
// paste-signed-hex pattern (matching `/mint`) — the user copies the
// unsigned hex, signs in their wallet, pastes the signed hex back.
// This connector exists so a future "Connect Wallet → sign in-page"
// flow can drop in without re-architecting; it is not currently
// imported anywhere. Heavy-duty review flagged as dead code; keeping
// for v2 wiring rather than deleting.
//
// Architectural pattern derived from mainnet-pat/dropship.cash (no
// license; pattern only, no source copied) — the IConnector interface
// shape generalises across WC2, Paytaca extension, etc. Today we ship
// only the WalletConnect v2 implementation; Paytaca extension support
// is a deferred follow-up (the surface is designed to slot it in).
//
// Browser-only. NEVER import from server-side code (uses `window`,
// lazy-loads @walletconnect packages). Every consumer should
// dynamic-import this module on user-action so it stays out of every
// other page's bundle.

import type { TransactionBCH, Input, Output } from '@bitauth/libauth';
import { binToHex, encodeTransaction } from '@bitauth/libauth';

/**
 * Wallet-side source-output type. WC2's `bch_signTransaction` needs the
 * full prevout data so the wallet can verify the inputs before signing.
 * Shape mirrors mainnet-pat's wc2-bch-bcr spec.
 */
export interface SourceOutput extends Output {
	outpointTransactionHash: Uint8Array;
	outpointIndex: number;
	sequenceNumber: number;
}

export interface SignTxOptions {
	/**
	 * Either a libauth Transaction object OR a raw hex string. WC2 spec
	 * says wallets MUST accept both; we send objects for clarity.
	 */
	transaction: TransactionBCH | string;
	sourceOutputs: SourceOutput[];
	broadcast?: boolean;
	userPrompt?: string;
}

export interface SignTxResult {
	signedTransaction: string;
	signedTransactionHash: string;
}

export interface IConnector {
	/** Returns the active wallet's cashaddr in canonical (`bitcoincash:q…`)
	 *  form. Throws if not connected. */
	address(): Promise<string>;
	/** Asks the wallet to sign a CashTokens-aware tx. Returns the signed
	 *  hex (caller broadcasts via the server endpoint). Throws on user
	 *  rejection or wallet error. */
	signTransaction(opts: SignTxOptions): Promise<SignTxResult>;
	/** Tears down the WC2 pairing. Called on wizard completion or unmount. */
	disconnect(): Promise<void>;
}

const BCH_CHAIN = 'bch:bitcoincash';
const WC_PROJECT_ID = (
	(typeof process !== 'undefined' && process.env?.PUBLIC_WALLETCONNECT_PROJECT_ID) || ''
).toString();

/**
 * Lazy-init a WC2 SignClient + Modal, prompt the user for a session
 * with `bch_signTransaction` capability, and return an IConnector that
 * keeps the session for the duration of the airdrop wizard.
 *
 * The login flow (src/routes/login/+page.svelte) uses a separate
 * short-lived session for `bch_signMessage` and tears it down
 * immediately. The airdrop flow needs a persistent session because
 * we'll request multiple sequential signatures (one per chunk), and
 * re-connecting between each would surface as multiple wallet popups.
 */
export async function connectWalletConnect(): Promise<IConnector> {
	if (!WC_PROJECT_ID) {
		throw new Error('PUBLIC_WALLETCONNECT_PROJECT_ID is not set');
	}
	const [{ default: SignClient }, { WalletConnectModal }] = await Promise.all([
		import('@walletconnect/sign-client'),
		import('@walletconnect/modal')
	]);

	// `any` casts: WC2's published types are awkward to thread through
	// — the same posture the login page uses. Runtime is fully exercised.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client: any = await SignClient.init({
		projectId: WC_PROJECT_ID,
		metadata: {
			name: 'Token Stork — Airdrop',
			description: 'Sign airdrop transactions for BCH CashTokens',
			url: window.location.origin,
			icons: [`${window.location.origin}/logo-simple-bch.png`]
		}
	});

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const modal: any = new WalletConnectModal({
		projectId: WC_PROJECT_ID,
		themeMode: document.documentElement.classList.contains('dark') ? 'dark' : 'light'
	});

	const { uri, approval } = await client.connect({
		requiredNamespaces: {
			bch: {
				chains: [BCH_CHAIN],
				// `bch_signTransaction` is the load-bearing method; we ask
				// for `bch_getAddresses` too so we can confirm the wallet's
				// cashaddr matches the authenticated session before signing.
				methods: ['bch_signTransaction', 'bch_getAddresses'],
				events: []
			}
		}
	});

	if (!uri) {
		throw new Error('WalletConnect returned no pairing URI');
	}

	modal.openModal({ uri });
	let session: { topic: string; namespaces: { bch?: { accounts?: string[] } } };
	try {
		session = await approval();
	} finally {
		modal.closeModal();
	}

	const accounts = session.namespaces.bch?.accounts ?? [];
	if (accounts.length === 0) {
		throw new Error('Wallet did not return any addresses');
	}
	// CAIP-10 account: `bch:bitcoincash:bitcoincash:q…`
	// (chain prefix + cashaddr-with-its-own-prefix). Slice the leading
	// 2 segments off to get the cashaddr itself.
	const cashaddr = accounts[0].split(':').slice(2).join(':');

	const connector: IConnector = {
		async address() {
			return cashaddr;
		},
		async signTransaction(opts: SignTxOptions): Promise<SignTxResult> {
			// Spec: wallets accept either a libauth Transaction object or
			// a raw hex string. We always send hex because objects with
			// Uint8Array-typed fields don't survive JSON serialization
			// across the WC2 relay reliably. Hex is unambiguous.
			const txHex =
				typeof opts.transaction === 'string'
					? opts.transaction
					: binToHex(encodeTransaction(opts.transaction));
			const params = {
				transaction: txHex,
				sourceOutputs: opts.sourceOutputs.map((so) => ({
					...so,
					// Ensure all binary fields are hex on the wire — same
					// reason as above.
					outpointTransactionHash: binToHex(so.outpointTransactionHash),
					lockingBytecode: binToHex(so.lockingBytecode)
				})),
				broadcast: opts.broadcast ?? false,
				userPrompt: opts.userPrompt ?? 'Token Stork airdrop'
			};

			const result = (await client.request({
				chainId: BCH_CHAIN,
				topic: session.topic,
				request: {
					method: 'bch_signTransaction',
					params
				}
			})) as SignTxResult | string | undefined;

			// wc2-bch-bcr says the response is { signedTransaction,
			// signedTransactionHash }. Some wallets return a bare hex
			// string in older implementations — accept that too as a
			// pragmatic fallback.
			if (!result) {
				throw new Error('Wallet returned an empty response');
			}
			if (typeof result === 'string') {
				return { signedTransaction: result, signedTransactionHash: '' };
			}
			if (!result.signedTransaction) {
				throw new Error('Wallet response missing signedTransaction');
			}
			return result;
		},
		async disconnect() {
			try {
				await client.disconnect({
					topic: session.topic,
					reason: { code: 6000, message: 'Airdrop wizard finished' }
				});
			} catch {
				// Best-effort; not fatal if the relay round-trip fails.
			}
		}
	};

	return connector;
}
