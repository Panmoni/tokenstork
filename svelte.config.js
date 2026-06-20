import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(
	readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')
);

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		alias: {
			$lib: 'src/lib'
		},
		files: {
			assets: 'public'
		},
		// Surfaces package.json#version as the `version` export of
		// `$app/environment`, so the Footer (and anything else) can render
		// the canonical app version without a hardcoded literal.
		version: {
			name: pkg.version
		},
		// Content Security Policy. Nonce mode makes SvelteKit stamp a
		// per-response `nonce-...` onto every inline script it emits AND
		// list that nonce in the `content-security-policy` response header,
		// so `script-src` never needs `'unsafe-inline'` (the XSS-via-
		// injection surface the old Caddy header CSP had).
		//
		// Why nonce and NOT hash: SvelteKit streams deferred `load`
		// promises (the homepage token grid, the token-detail tiers) by
		// appending `<script>...resolve(id, ...)</script>` chunks to the
		// response AFTER the CSP header has already been sent. In hash mode
		// their SHA-256s can't be added to the policy retroactively and
		// they carry no nonce, so the browser blocks them and every
		// `{#await}` hangs on its skeleton forever (this was exactly the
		// "homepage grid never loads" bug). Nonce mode tags those late
		// chunks with the same nonce already in the header, so they run.
		// (No route prerenders — nonce mode is incompatible with
		// prerendering, which would throw at build time.)
		//
		// The Caddy CSP header is removed in lockstep so the browser
		// enforces ONE CSP per response. (Two CSPs are intersected — a
		// Caddy CSP without our per-response nonce would reject everything
		// SvelteKit emits inline.) Add new third-party CDNs here, not via a
		// Caddy header override.
		csp: {
			mode: 'nonce',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				// `style-src 'self'` only — no `'unsafe-inline'`. Inline
				// `style=""` attributes were refactored to SVG geometry
				// (chart bars on /stats) + a CSS class on app.html's
				// body wrapper. Any new inline-style usage will fail at
				// browser runtime; nonce mode nonces the `<style>` blocks
				// emitted by component scoping.
				'style-src': ['self'],
				'img-src': ['self', 'https:', 'data:'],
				'font-src': ['self', 'data:'],
				// connect-src needs to allow:
				//   - 'self' for the auth endpoints + tokens API
				//   - WalletConnect relay (wss://) + verify/registry API
				//     (https://*.walletconnect.{com,org}). Without these the
				//     /login Connect Wallet button hangs at session-init —
				//     the SDK can't reach the relay.
				'connect-src': [
					'self',
					'wss://relay.walletconnect.com',
					'wss://relay.walletconnect.org',
					'https://*.walletconnect.com',
					'https://*.walletconnect.org',
					// Mint wizard (item #28) lets users pin their BCMR JSON
					// + icon directly to IPFS using their OWN API key. The
					// upload runs browser → provider, not via our backend,
					// so the user's key never reaches our server.
					'https://api.web3.storage',
					'https://api.pinata.cloud'
				],
				// frame-src allows the WalletConnect verification iframe.
				// Distinct from frame-ancestors (which controls who can
				// embed US, set to 'none' below).
				'frame-src': [
					'https://verify.walletconnect.com',
					'https://verify.walletconnect.org'
				],
				'frame-ancestors': ['none'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'object-src': ['none'],
				'upgrade-insecure-requests': true
			}
		}
	}
};

export default config;
