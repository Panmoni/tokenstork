<svelte:head>
	<title>Learn — Token Stork</title>
	<meta
		name="description"
		content="Tutorials and resources for building with BCH CashTokens."
	/>
</svelte:head>

<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent mb-6">
		Learn
	</h1>

	<div class="prose prose-slate dark:prose-invert max-w-none">
		<p class="mb-6 ts-text-body">
			To get started, here are foundational CashTokens tutorials. We'll be adding more resources to
			this page over time.
		</p>

		<h2 class="text-2xl font-bold text-slate-900 dark:text-white mt-8 mb-4">Start here</h2>
		<ul class="list-disc list-inside ml-5 space-y-2 ts-text-body">
			<li>
				<a
					href="https://cashscript.org/docs/basics/about-bch/"
					target="_blank"
					rel="noopener noreferrer"
				>
					About Bitcoin Cash
				</a> — a concise primer on BCH's UTXO model, covenants, and why CashTokens exist.
			</li>
			<li>
				<a
					href="https://cashtokens.org/docs/intro/"
					target="_blank"
					rel="noopener noreferrer"
				>
					Introduction to CashTokens
				</a> — the official walkthrough of fungible and non-fungible tokens on BCH.
			</li>
		</ul>

		<h2 class="text-2xl font-bold text-slate-900 dark:text-white mt-10 mb-4">Token Pioneers series</h2>
		<p class="mb-3 ts-text-body">
			Hands-on tutorials for minting and working with CashTokens end-to-end.
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

		<h2 class="text-2xl font-bold text-slate-900 dark:text-white mt-10 mb-4">Smart contracts with CashScript</h2>
		<p class="mb-3 ts-text-body">
			CashScript is the high-level language most CashTokens projects use to write BCH smart contracts
			and covenants.
		</p>
		<ul class="list-disc list-inside ml-5 space-y-2 ts-text-body">
			<li>
				<a href="https://cashscript.org/" target="_blank" rel="noopener noreferrer">
					cashscript.org
				</a> — project homepage, installation, and full documentation.
			</li>
			<li>
				<a
					href="https://cashscript.org/docs/guides/covenants/"
					target="_blank"
					rel="noopener noreferrer"
				>
					Covenants guide
				</a> — how to constrain how coins can be spent, the foundation of most on-chain BCH apps.
			</li>
		</ul>

		<h2 class="text-2xl font-bold text-slate-900 dark:text-white mt-10 mb-4">Video</h2>
		<ul class="list-disc list-inside ml-5 space-y-2 ts-text-body">
			<li>
				<a
					href="https://www.youtube.com/watch?v=_X70ld0MJJ0"
					target="_blank"
					rel="noopener noreferrer"
				>
					CashScript Explained
				</a> — short overview of what CashScript is and why it matters (BCH Clips).
			</li>
			<li>
				<a
					href="https://www.youtube.com/watch?v=uzzUEQSKTh4"
					target="_blank"
					rel="noopener noreferrer"
				>
					CashScript Tutorial #1: Write your first BCH smart contract
				</a> — step-by-step build-along by MrZwets.
			</li>
		</ul>

		<h2 class="text-2xl font-bold text-slate-900 dark:text-white mt-10 mb-4">Reference</h2>
		<ul class="list-disc list-inside ml-5 space-y-2 ts-text-body">
			<li>
				<a href="https://cashtokens.org/" target="_blank" rel="noopener noreferrer">
					cashtokens.org
				</a> — the official CashTokens spec hub.
			</li>
			<li>
				<a
					href="https://cashtokens.org/docs/bcmr/chip/"
					target="_blank"
					rel="noopener noreferrer"
				>
					BCMR CHIP
				</a> — the metadata standard behind the "BCMR metadata" card on every token page.
			</li>
			<li>
				<a href="https://bchworks.com/" target="_blank" rel="noopener noreferrer">
					BCHWorks
				</a> — beginner-friendly BCH information + tutorials.
			</li>
		</ul>

		<p class="mt-10 text-sm ts-text-muted">
			Have a tutorial or resource to suggest? Email
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
