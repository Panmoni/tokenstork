import { sveltekit } from '@sveltejs/kit/vite';
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
	plugins: [sveltekit()],
	define: {
		__GIT_COMMIT__: JSON.stringify(gitCommit)
	}
});
