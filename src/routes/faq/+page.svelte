<script lang="ts">
	import { onMount } from 'svelte';

	// If the page was opened with a fragment like #faq-ft-nft (e.g. from
	// the /stats "What's FT+NFT?" link), auto-open the matching details
	// element so the user lands on the expanded answer, not a closed
	// summary. Scrolling is handled by the browser's default
	// fragment-anchor behavior + `scroll-mt-20` on each details.
	onMount(() => {
		const hash = window.location.hash;
		if (hash && hash.startsWith('#faq-')) {
			const el = document.querySelector(hash);
			if (el instanceof HTMLDetailsElement) el.open = true;
		}
	});
</script>

<svelte:head>
	<title>FAQ — Token Stork</title>
	<meta
		name="description"
		content="Frequently asked questions about TokenStork, BCH CashTokens, and the directory's data sources."
	/>
</svelte:head>

<main class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent mb-6">
		Frequently asked questions
	</h1>
	<p class="text-slate-600 dark:text-slate-400 mb-10">
		Quick answers to the things readers most often want to know about TokenStork and the CashTokens
		ecosystem. Click any question to expand. If something's missing here, email
		<a href="mailto:hello@panmoni.com" class="text-violet-600 dark:text-violet-400 hover:underline">hello@panmoni.com</a>
		and I'll add it.
	</p>

	<div class="space-y-3">
		<!--
			Each Q&A is a native <details> element so the accordion works
			without JS and stays keyboard-accessible. Styling-only shell.
		-->

		<details class="group p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<summary class="cursor-pointer text-lg font-semibold text-slate-900 dark:text-white flex items-center justify-between gap-4 list-none">
				<span>What is TokenStork?</span>
				<span class="text-violet-500 group-open:rotate-45 transition-transform select-none">+</span>
			</summary>
			<div class="mt-3 text-slate-600 dark:text-slate-300 space-y-2">
				<p>
					TokenStork is a market-cap and directory site for
					<a href="https://cashtokens.org/" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">BCH CashTokens</a>. We index every category ever minted since the CashTokens upgrade
					activated at block 792,772 in May 2023, and surface prices, holders, metadata, and trade
					venues.
				</p>
				<p>
					Everything runs on a single archival BCH node + our own Postgres. No third-party
					blockchain indexer sits in the pipeline — the site is fully self-hosted.
				</p>
			</div>
		</details>

		<details class="group p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<summary class="cursor-pointer text-lg font-semibold text-slate-900 dark:text-white flex items-center justify-between gap-4 list-none">
				<span>What is a CashToken?</span>
				<span class="text-violet-500 group-open:rotate-45 transition-transform select-none">+</span>
			</summary>
			<div class="mt-3 text-slate-600 dark:text-slate-300 space-y-2">
				<p>
					CashTokens is Bitcoin Cash's native token standard, activated in May 2023. It lets any
					BCH transaction create fungible tokens (like stablecoins or meme coins) or non-fungible
					tokens (collectibles, membership passes) directly in the base protocol — no smart-contract
					platform required, no separate ledger.
				</p>
				<p>
					Every token shares a <strong>category</strong>, a 32-byte hex identifier derived from the
					transaction where the category was first minted. You'll see categories referenced
					throughout the site in that format.
				</p>
				<p>
					The <a href="/learn" class="text-violet-600 dark:text-violet-400 hover:underline">Learn page</a>
					links to tutorials for minting your own.
				</p>
			</div>
		</details>

		<details id="faq-ft-nft" class="group p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 scroll-mt-20">
			<summary class="cursor-pointer text-lg font-semibold text-slate-900 dark:text-white flex items-center justify-between gap-4 list-none">
				<span>What does <code class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-sm">FT+NFT</code> mean?</span>
				<span class="text-violet-500 group-open:rotate-45 transition-transform select-none">+</span>
			</summary>
			<div class="mt-3 text-slate-600 dark:text-slate-300 space-y-3">
				<p>
					CashToken categories come in three shapes based on the kinds of outputs the token
					appears on:
				</p>
				<ul class="list-disc list-inside ml-2 space-y-2">
					<li>
						<strong>FT</strong> — fungible only. Every output has an <code class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">amount</code> but no NFT commitment. Tokens you count — balances are interchangeable.
						Example: a BCH-denominated stablecoin.
					</li>
					<li>
						<strong>NFT</strong> — non-fungible only. Every output has an NFT commitment
						(arbitrary bytes identifying the unique item). No fungible balance. Example: a
						collectible series.
					</li>
					<li>
						<strong>FT+NFT</strong> — hybrid. The same category has both fungible balances AND
						unique NFTs under the same category id. Unlike ERC-20 vs ERC-721, BCH CashTokens
						let one category carry both semantics simultaneously.
					</li>
				</ul>
				<p>
					Typical FT+NFT pattern: a project mints a governance token (FT) alongside membership
					badges (NFT) under the same brand. At our last snapshot roughly 18% of the ecosystem
					uses this hybrid pattern — see the breakdown on <a href="/stats" class="text-violet-600 dark:text-violet-400 hover:underline">/stats</a>.
				</p>
			</div>
		</details>

		<details class="group p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<summary class="cursor-pointer text-lg font-semibold text-slate-900 dark:text-white flex items-center justify-between gap-4 list-none">
				<span>What's the difference between Cauldron and Tapswap?</span>
				<span class="text-violet-500 group-open:rotate-45 transition-transform select-none">+</span>
			</summary>
			<div class="mt-3 text-slate-600 dark:text-slate-300 space-y-2">
				<p>
					Both are places you can trade CashTokens, but they work very differently:
				</p>
				<ul class="list-disc list-inside ml-2 space-y-2">
					<li>
						<strong><a href="https://cauldron.quest/" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">Cauldron</a></strong> is an <strong>AMM</strong> — a constant-product liquidity pool à la Uniswap v2. You
						trade against the pool at the price the pool's reserves imply; the act of trading
						moves the price. Listings with Cauldron presence get the
						<span class="inline-flex items-center justify-center w-5 h-5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-[10px] font-bold">C</span>
						badge on the directory.
					</li>
					<li>
						<strong><a href="https://tapswap.cash/" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">Tapswap</a></strong> is a <strong>P2P marketplace</strong> — fixed-price listings posted on-chain.
						No pool, no price impact; you take the listing or you don't. Listings show the
						<span class="inline-flex items-center justify-center w-5 h-5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">T</span>
						badge.
					</li>
				</ul>
				<p>
					A token can be on one, both, or neither. The
					<a href="/stats" class="text-violet-600 dark:text-violet-400 hover:underline">Venue overlap</a>
					section on /stats breaks down the split.
				</p>
			</div>
		</details>

		<details class="group p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<summary class="cursor-pointer text-lg font-semibold text-slate-900 dark:text-white flex items-center justify-between gap-4 list-none">
				<span>What do the status dots (green / amber / grey) mean?</span>
				<span class="text-violet-500 group-open:rotate-45 transition-transform select-none">+</span>
			</summary>
			<div class="mt-3 text-slate-600 dark:text-slate-300 space-y-2">
				<p>The coloured dot next to each token name on the directory is an at-a-glance tradeability signal:</p>
				<ul class="list-disc list-inside ml-2 space-y-1">
					<li><span class="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 align-middle mr-1"></span> <strong>Green</strong> — active Cauldron AMM pool (live pool price)</li>
					<li><span class="inline-block w-2.5 h-2.5 rounded-full bg-amber-400 align-middle mr-1"></span> <strong>Amber</strong> — Tapswap P2P listings only, no AMM liquidity</li>
					<li><span class="inline-block w-2.5 h-2.5 rounded-full bg-slate-300 dark:bg-slate-600 align-middle mr-1"></span> <strong>Grey</strong> — no venue presence; can't be bought/sold right now</li>
				</ul>
			</div>
		</details>

		<details class="group p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<summary class="cursor-pointer text-lg font-semibold text-slate-900 dark:text-white flex items-center justify-between gap-4 list-none">
				<span>What's the difference between "Tracked" and "Listed" in the header?</span>
				<span class="text-violet-500 group-open:rotate-45 transition-transform select-none">+</span>
			</summary>
			<div class="mt-3 text-slate-600 dark:text-slate-300 space-y-2">
				<p>
					<strong>Tracked</strong> is every CashToken category our indexer has ever seen, going
					back to activation block 792,772 in May 2023 — fungible and NFT, active or long-dead.
					It's the size of the universe we know about.
				</p>
				<p>
					<strong>Listed</strong> is the subset that's actually tradeable right now — at least
					one active Cauldron pool or at least one open Tapswap listing. It's a much smaller
					number. The ratio (Listed ÷ Tracked) is a rough "what fraction of tokens have any
					liquidity?" signal.
				</p>
			</div>
		</details>

		<details class="group p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<summary class="cursor-pointer text-lg font-semibold text-slate-900 dark:text-white flex items-center justify-between gap-4 list-none">
				<span>Why does my token show <code class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-sm">—</code> for Holders, UTXOs, or NFTs?</span>
				<span class="text-violet-500 group-open:rotate-45 transition-transform select-none">+</span>
			</summary>
			<div class="mt-3 text-slate-600 dark:text-slate-300 space-y-2">
				<p>
					Those fields come from a per-category enrichment index that joins what's unspent on
					chain to category membership. We're deploying it as part of the BlockBook rollout;
					until that's live those columns show the em-dash placeholder.
				</p>
				<p>
					If you're seeing em-dashes and you expect real numbers, BlockBook hasn't finished its
					initial index build yet. Give it a day or two.
				</p>
			</div>
		</details>

		<details class="group p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<summary class="cursor-pointer text-lg font-semibold text-slate-900 dark:text-white flex items-center justify-between gap-4 list-none">
				<span>How often does the data refresh?</span>
				<span class="text-violet-500 group-open:rotate-45 transition-transform select-none">+</span>
			</summary>
			<div class="mt-3 text-slate-600 dark:text-slate-300 space-y-2">
				<p>
					Different sources update at different cadences:
				</p>
				<ul class="list-disc list-inside ml-2 space-y-1">
					<li><strong>New categories + Tapswap listings</strong> — sub-second. The tail worker subscribes to BCH node ZMQ and indexes within milliseconds of a new block.</li>
					<li><strong>Cauldron prices + TVL</strong> — every 4 hours.</li>
					<li><strong>BCMR metadata</strong> (name, symbol, icon, description) — every 4 hours.</li>
					<li><strong>BCH/USD price</strong> — every 5 minutes.</li>
					<li><strong>Sparklines + 1h/24h/7d % change</strong> — rebuilt from the price history each request; fills in over the 7 days following deploy.</li>
				</ul>
			</div>
		</details>

		<details class="group p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<summary class="cursor-pointer text-lg font-semibold text-slate-900 dark:text-white flex items-center justify-between gap-4 list-none">
				<span>Where do token names, symbols, and icons come from?</span>
				<span class="text-violet-500 group-open:rotate-45 transition-transform select-none">+</span>
			</summary>
			<div class="mt-3 text-slate-600 dark:text-slate-300 space-y-2">
				<p>
					From <a href="https://cashtokens.org/docs/bcmr/chip/" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">BCMR</a>
					(the Bitcoin Cash Metadata Registries CHIP). Token creators publish metadata at a URI
					attached to their authchain — name, symbol, decimals, description, icon, links, NFT
					schema, and more. We fetch it via
					<a href="https://www.paytaca.com/" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">Paytaca's</a>
					public BCMR registry API.
				</p>
				<p>
					If a token shows a plain category hex instead of a name, the minter hasn't published
					BCMR metadata yet. On the token detail page you can see every BCMR field the registry
					knows about under the "BCMR metadata" card.
				</p>
			</div>
		</details>

		<details class="group p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<summary class="cursor-pointer text-lg font-semibold text-slate-900 dark:text-white flex items-center justify-between gap-4 list-none">
				<span>How do I add a token? How do I report one?</span>
				<span class="text-violet-500 group-open:rotate-45 transition-transform select-none">+</span>
			</summary>
			<div class="mt-3 text-slate-600 dark:text-slate-300 space-y-2">
				<p>
					<strong>Add:</strong> nothing to do! We index every CashToken category automatically.
					Once you mint a token it appears on tokenstork within seconds. To show a name and icon,
					publish BCMR metadata via your authchain — Paytaca's wallet has built-in tools for
					this.
				</p>
				<p>
					<strong>Report:</strong> every token detail page has a "Report this token" button
					below the stats. Use it for spam, phishing, fraud, or deliberately offensive content.
					Reports go directly to us, not the token creator.
				</p>
			</div>
		</details>

		<details class="group p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<summary class="cursor-pointer text-lg font-semibold text-slate-900 dark:text-white flex items-center justify-between gap-4 list-none">
				<span>Is TokenStork open source?</span>
				<span class="text-violet-500 group-open:rotate-45 transition-transform select-none">+</span>
			</summary>
			<div class="mt-3 text-slate-600 dark:text-slate-300 space-y-2">
				<p>
					Yes. Code is at
					<a href="https://github.com/Panmoni/tokenstork" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">github.com/Panmoni/tokenstork</a>.
					Pull requests and issues welcome. The <a href="/roadmap" class="text-violet-600 dark:text-violet-400 hover:underline">/roadmap</a> shows what's shipped and what's next.
				</p>
			</div>
		</details>
	</div>

	<p class="text-sm text-slate-500 dark:text-slate-400 mt-10">
		Didn't find what you were looking for? Email
		<a href="mailto:hello@panmoni.com" class="text-violet-600 dark:text-violet-400 hover:underline">hello@panmoni.com</a>
		and I'll add the answer.
	</p>
</main>
