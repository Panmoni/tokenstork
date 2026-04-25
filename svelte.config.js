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
		// Content Security Policy. Hash mode makes SvelteKit emit a
		// `<meta http-equiv="Content-Security-Policy">` tag in every SSR
		// response, with SHA-256 hashes of its own inline hydration script
		// + component-scoped inline styles. This replaces the
		// `'unsafe-inline'`-script Caddy header CSP we used to ship — the
		// previous policy had to allow every inline script (XSS-via-
		// injection surface), and now only SvelteKit's specific scripts
		// (whose hashes change every build) are accepted.
		//
		// The Caddy CSP header is removed in lockstep with this change so
		// the browser enforces ONE CSP per response. (Two CSPs in the
		// same response are intersected — a header CSP without our
		// build's hashes would reject everything SvelteKit emits inline.)
		//
		// Add new third-party CDNs here, not via a Caddy header override.
		csp: {
			mode: 'hash',
			directives: {
				'default-src': ['self'],
				'script-src': ['self', 'https://beamanalytics.b-cdn.net'],
				// Style-src keeps `unsafe-inline` because Tailwind +
				// component styles emit inline `style=` attributes
				// (CLS-prevention skeletons, theme switcher, etc.) that
				// SvelteKit's hash mode doesn't catch. Risk is low: an
				// inline `style` can't execute code, only restyle.
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'https:', 'data:'],
				'font-src': ['self', 'data:'],
				// connect-src needs to allow:
				//   - 'self' for the auth endpoints + tokens API
				//   - beam analytics CDN (existing)
				//   - WalletConnect relay (wss://) + verify/registry API
				//     (https://*.walletconnect.{com,org}). Without these the
				//     /login Connect Wallet button hangs at session-init —
				//     the SDK can't reach the relay.
				'connect-src': [
					'self',
					'https://beamanalytics.b-cdn.net',
					'wss://relay.walletconnect.com',
					'wss://relay.walletconnect.org',
					'https://*.walletconnect.com',
					'https://*.walletconnect.org'
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
