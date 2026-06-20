import { sveltekit } from '@sveltejs/kit/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

const gitCommit = (() => {
	try {
		return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
			.toString()
			.trim();
	} catch {
		return 'dev';
	}
})();

export default defineConfig({
	plugins: [
		// Paraglide must precede sveltekit() so the compiled `$lib/paraglide`
		// modules exist before SvelteKit resolves imports. URL-prefixed locale
		// strategy (English = base, no prefix) keeps one URL = one language,
		// which the Cloudflare edge cache (s-maxage in hooks.server.ts) needs.
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			strategy: ['url', 'cookie', 'preferredLanguage', 'baseLocale']
		}),
		sveltekit()
	],
	define: {
		__GIT_COMMIT__: JSON.stringify(gitCommit)
	}
});
