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
		}
	}
};

export default config;
