<svelte:head>
	<title>About — Token Stork</title>
	<meta
		name="description"
		content="TokenStork is a market-cap site for BCH CashTokens, built and maintained by George Donnelly."
	/>
</svelte:head>

<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent mb-6">
		About Token Stork
	</h1>

	<div class="prose prose-slate dark:prose-invert max-w-3xl">
		<p class="text-slate-600 dark:text-slate-300">
			TokenStork.com is a market-cap site for
			<a href="https://bchworks.com/" target="_blank" rel="noopener noreferrer">BCH</a>
			<a href="https://cashtokens.org/" target="_blank" rel="noopener noreferrer">CashTokens</a>
			built and maintained by
			<a href="https://georgedonnelly.com/" target="_blank" rel="noopener noreferrer">George Donnelly</a>.
			<a href="https://github.com/Panmoni/tokenstork" target="_blank" rel="noopener noreferrer">The code is open-source</a>.
			You can review the pending
			<a href="https://github.com/Panmoni/tokenstork/issues" target="_blank" rel="noopener noreferrer">issues</a>
			or the <a href="/roadmap">roadmap</a>.
		</p>
		<p class="text-slate-600 dark:text-slate-300 mt-4">
			I welcome your suggestions, criticisms, bug reports and general feedback any time. Let me know
			what functionality would be of assistance to you, and I will probably add it!
		</p>
	</div>

	<div class="grid gap-5 md:grid-cols-2 mt-10">
		<section class="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<h2 class="text-xl font-bold text-slate-900 dark:text-white mb-3">Need help building?</h2>
			<p class="text-slate-600 dark:text-slate-300">
				Want to build a dapp on BCH but need some technical help? <strong>Hire me!</strong> Email
				<a href="mailto:george@panmoni.com" class="text-violet-600 dark:text-violet-400 hover:underline">george@panmoni.com</a>
				and I'll build what you need.
			</p>
		</section>

		<section class="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<h2 class="text-xl font-bold text-slate-900 dark:text-white mb-3">Get the latest BCH news</h2>
			<p class="text-slate-600 dark:text-slate-300">
				Join
				<a href="https://www.reddit.com/r/BCHCashTokens/" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">r/BCHCashTokens</a>,
				the only remaining censorship-free BCH subreddit where everything related to BCH is on-topic.
			</p>
		</section>

		<section class="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 md:col-span-2">
			<h2 class="text-xl font-bold text-slate-900 dark:text-white mb-3">
				TokenStork BCH Metadata Registry
			</h2>
			<p class="text-slate-600 dark:text-slate-300">
				TokenStork also hosts
				<a
					href="https://tokenstork.com/.well-known/bitcoin-cash-metadata-registry.json"
					target="_blank"
					rel="noopener noreferrer"
					class="text-violet-600 dark:text-violet-400 hover:underline"
				>TokenStorkRegistry</a>,
				a BCH Metadata Registry. PRs are welcome at our
				<a
					href="https://github.com/Panmoni/tokenstork/blob/main/public/.well-known/bitcoin-cash-metadata-registry.json"
					target="_blank"
					rel="noopener noreferrer"
					class="text-violet-600 dark:text-violet-400 hover:underline"
				>GitHub repo</a>. For now, the registry mirrors
				<a href="https://otr.cash" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">otr.cash</a>.
			</p>
		</section>

		<section class="p-6 rounded-xl border border-violet-200 dark:border-violet-900/50 bg-violet-50/40 dark:bg-violet-950/20 md:col-span-2">
			<h2 class="text-xl font-bold text-slate-900 dark:text-white mb-3">Support this project</h2>
			<p class="text-slate-600 dark:text-slate-300 mb-4">
				At this time, this site is self-funded and running on borrowed APIs, as well lending an API to
				others, so please consider supporting this work by donating to the following address. Thank you!
			</p>
			<p class="font-mono text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 inline-block select-all break-all">
				bitcoincash:qz3pxmwda8gd42wa8k9yfxcwhcaapeuhygjc8mc4m8
			</p>
		</section>

		<section class="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 md:col-span-2">
			<h2 class="text-xl font-bold text-slate-900 dark:text-white mb-3">Contact</h2>
			<p class="text-slate-600 dark:text-slate-300">
				Please email
				<a href="mailto:hello@panmoni.com" class="text-violet-600 dark:text-violet-400 hover:underline">hello@panmoni.com</a>
				and we'll be thrilled to assist you.
			</p>
		</section>
	</div>
</main>
