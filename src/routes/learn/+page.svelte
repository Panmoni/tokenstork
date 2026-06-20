<script lang="ts">
	import * as m from '$lib/paraglide/messages';
</script>

<svelte:head>
	<title>{m.learn_meta_title()}</title>
	<meta
		name="description"
		content={m.learn_meta_description()}
	/>
</svelte:head>

<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent mb-6">
		{m.learn_h1()}
	</h1>

	<div class="prose prose-slate dark:prose-invert max-w-none">
		<p class="mb-6 ts-text-body">
			{m.learn_intro()}
		</p>

		<h2 class="text-2xl font-bold text-slate-900 dark:text-white mt-8 mb-4">{m.learn_start_here()}</h2>
		<ul class="list-disc list-inside ml-5 space-y-2 ts-text-body">
			<li>
				<a
					href="https://cashscript.org/docs/basics/about-bch/"
					target="_blank"
					rel="noopener noreferrer"
				>
					About Bitcoin Cash
				</a> {m.learn_about_bch_desc()}
			</li>
			<li>
				<a
					href="https://cashtokens.org/docs/intro/"
					target="_blank"
					rel="noopener noreferrer"
				>
					Introduction to CashTokens
				</a> {m.learn_intro_ct_desc()}
			</li>
		</ul>

		<h2 class="text-2xl font-bold text-slate-900 dark:text-white mt-10 mb-4">{m.learn_pioneers_h()}</h2>
		<p class="mb-3 ts-text-body">
			{m.learn_pioneers_intro()}
		</p>
		<ul class="list-disc list-inside ml-5 space-y-2 ts-text-body">
			<li>
				<a
					href="https://www.bchworks.com/blog/token-pioneers-cashtokens-tutorial-1"
					target="_blank"
					rel="noopener noreferrer"
				>
					Mint your first CashTokens on Bitcoin Cash (Tutorial 1)
				</a>
			</li>
			<li>
				<a
					href="https://www.bchworks.com/blog/token-pioneers-cashtokens-tutorial-2"
					target="_blank"
					rel="noopener noreferrer"
				>
					Mint your first NFTs on Bitcoin Cash (Tutorial 2)
				</a>
			</li>
			<li>
				<a
					href="https://www.bchworks.com/blog/token-pioneers-cashtokens-tutorial-3"
					target="_blank"
					rel="noopener noreferrer"
				>
					Understanding and working with BCMR — CashTokens metadata (Tutorial 3)
				</a>
			</li>
			<li>
				<a
					href="https://www.bchworks.com/blog/token-pioneers-cashtokens-tutorial-4"
					target="_blank"
					rel="noopener noreferrer"
				>
					Create an NFT ticket &amp; warrant canary with parsable NFTs (Tutorial 4)
				</a>
			</li>
		</ul>

		<h2 class="text-2xl font-bold text-slate-900 dark:text-white mt-10 mb-4">{m.learn_cashscript_h()}</h2>
		<p class="mb-3 ts-text-body">
			{m.learn_cashscript_intro()}
		</p>
		<ul class="list-disc list-inside ml-5 space-y-2 ts-text-body">
			<li>
				<a href="https://cashscript.org/" target="_blank" rel="noopener noreferrer">
					cashscript.org
				</a> {m.learn_cashscript_org_desc()}
			</li>
			<li>
				<a
					href="https://cashscript.org/docs/guides/covenants/"
					target="_blank"
					rel="noopener noreferrer"
				>
					Covenants guide
				</a> {m.learn_covenants_desc()}
			</li>
		</ul>

		<h2 class="text-2xl font-bold text-slate-900 dark:text-white mt-10 mb-4">{m.learn_video_h()}</h2>
		<ul class="list-disc list-inside ml-5 space-y-2 ts-text-body">
			<li>
				<a
					href="https://www.youtube.com/watch?v=_X70ld0MJJ0"
					target="_blank"
					rel="noopener noreferrer"
				>
					CashScript Explained
				</a> {m.learn_video_explained_desc()}
			</li>
			<li>
				<a
					href="https://www.youtube.com/watch?v=uzzUEQSKTh4"
					target="_blank"
					rel="noopener noreferrer"
				>
					CashScript Tutorial #1: Write your first BCH smart contract
				</a> {m.learn_video_tut1_desc()}
			</li>
		</ul>

		<h2 class="text-2xl font-bold text-slate-900 dark:text-white mt-10 mb-4">{m.learn_reference_h()}</h2>
		<ul class="list-disc list-inside ml-5 space-y-2 ts-text-body">
			<li>
				<a href="https://cashtokens.org/" target="_blank" rel="noopener noreferrer">
					cashtokens.org
				</a> {m.learn_ref_ct_desc()}
			</li>
			<li>
				<a
					href="https://cashtokens.org/docs/bcmr/chip/"
					target="_blank"
					rel="noopener noreferrer"
				>
					BCMR CHIP
				</a> {m.learn_ref_bcmr_desc()}
			</li>
			<li>
				<a href="https://bchworks.com/" target="_blank" rel="noopener noreferrer">
					BCHWorks
				</a> {m.learn_ref_bchworks_desc()}
			</li>
		</ul>

		<p class="mt-10 text-sm ts-text-muted">
			{m.learn_suggest()}
			<a href="mailto:hello@panmoni.com">hello@panmoni.com</a>.
		</p>
	</div>
</main>

<style>
	/* The Tailwind typography plugin (@tailwindcss/typography) is NOT
	   installed, so the `prose prose-slate dark:prose-invert` classes are
	   inert: content links inherited the body text color with no underline
	   and read as plain, non-obvious text. Style them explicitly in the
	   site's violet accent with a persistent underline so they're clearly
	   clickable. Dark mode keys off the global `.dark` class on <html>
	   (darkMode: "class"). Hex values are inlined rather than using Tailwind
	   `theme()` to stay independent of how scoped styles resolve functions. */
	.prose a {
		color: #6d28d9; /* violet-700 */
		font-weight: 500;
		text-decoration: underline;
		text-decoration-color: rgba(167, 139, 250, 0.7); /* violet-400 @ 70% */
		text-underline-offset: 4px;
		transition: color 0.15s ease, text-decoration-color 0.15s ease;
	}
	.prose a:hover {
		color: #5b21b6; /* violet-800 */
		text-decoration-color: #7c3aed; /* violet-600 */
	}
	:global(.dark) .prose a {
		color: #a78bfa; /* violet-400 */
		text-decoration-color: rgba(167, 139, 250, 0.5);
	}
	:global(.dark) .prose a:hover {
		color: #c4b5fd; /* violet-300 */
		text-decoration-color: #c4b5fd;
	}
</style>
