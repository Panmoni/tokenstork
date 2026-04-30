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

		<details id="faq-crc20-vs-bcmr" class="group p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 scroll-mt-20">
			<summary class="cursor-pointer text-lg font-semibold text-slate-900 dark:text-white flex items-center justify-between gap-4 list-none">
				<span>What's the difference between <strong>CRC-20</strong> and <strong>BCMR</strong>?</span>
				<span class="text-violet-500 group-open:rotate-45 transition-transform select-none">+</span>
			</summary>
			<div class="mt-3 text-slate-600 dark:text-slate-300 space-y-3">
				<p>
					Both are ways to attach a name, symbol, and decimals to a CashTokens category. They
					answer different questions and use very different mechanisms:
				</p>
				<ul class="list-disc list-inside ml-2 space-y-2">
					<li>
						<strong>BCMR</strong> (<a href="https://github.com/bitjson/chip-bcmr" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">CHIP-BCMR</a>)
						is the BCH ecosystem's standard <em>off-chain</em> metadata registry. Issuers
						publish a JSON file (icon, description, links, NFT types, extensions) at a URL
						pinned to their token's identity output. We mirror Paytaca's BCMR indexer so
						this metadata shows up across the directory.
					</li>
					<li>
						<strong>CRC-20</strong> (<a href="https://crc20.cash/" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">crc20.cash</a>)
						is a permissionless <em>on-chain</em> naming convention. The symbol, decimals,
						and name are encoded inside a 21-byte CashScript covenant in the token's
						<strong>genesis transaction</strong>. We detect it directly from chain data — no
						third-party registry, no publisher, no DNS dependency.
					</li>
				</ul>
				<p>
					The big practical difference: BCMR is <strong>self-asserted</strong> (any issuer can
					declare any symbol they like in their JSON), while CRC-20 is
					<strong>first-come-first-served on chain</strong>, with one canonical winner per symbol
					determined by a deterministic sort
					(<code class="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">max(commit_block, reveal_block − 20)</code>,
					ties broken by category id). A token can have BCMR alone, CRC-20 alone, both, or
					neither. When both exist, the on-chain CRC-20 bytes win on authenticity (you can verify
					them against the genesis tx); BCMR wins on richness (icons, descriptions, social
					links).
				</p>
				<p>
					Browse all CRC-20 tokens at <a href="/crc20" class="text-violet-600 dark:text-violet-400 hover:underline">/crc20</a>
					— the page splits canonical winners from non-canonical contenders so you can see
					where symbols are contested.
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
				<span>What are the small icons next to each token's name?</span>
				<span class="text-violet-500 group-open:rotate-45 transition-transform select-none">+</span>
			</summary>
			<div class="mt-3 text-slate-600 dark:text-slate-300 space-y-2">
				<p>Each token in the directory shows a few compact signals next to its name:</p>
				<ul class="list-disc list-inside ml-2 space-y-1.5">
					<li>
						<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 align-middle">FT</span>
						/
						<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 align-middle">NFT</span>
						/
						<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 align-middle">FT+NFT</span>
						— token-type badge (<a href="#faq-ft-nft" class="underline hover:text-violet-600 dark:hover:text-violet-400">what these mean</a>).
					</li>
					<li>
						<img src="/cauldron-logo.png" alt="" class="inline-block h-4 w-4 align-middle rounded-full bg-slate-900 p-0.5" aria-hidden="true" />
						<strong>Cauldron logo</strong> — the token has an active AMM pool on <a href="https://cauldron.quest/" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">Cauldron</a> with a live pool price.
					</li>
					<li>
						<img src="/tapswap-logo.png" alt="" class="inline-block h-4 w-4 align-middle" aria-hidden="true" />
						<strong>Tapswap logo</strong> — the token has one or more open P2P listings on <a href="https://tapswap.cash/" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">Tapswap</a>. Hover the icon for the listing count.
					</li>
				</ul>
				<p>
					A token can show one, both, or neither venue icon. No icons = not currently tradeable
					anywhere our indexer knows about.
				</p>
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
					<li><strong>Cauldron prices + TVL</strong> — every 10 minutes for already-listed tokens (~60-90s fast refresh), plus a 4-hour full scan that discovers newly-listed tokens and prunes delisted ones.</li>
					<li><strong>BCMR metadata</strong> (name, symbol, icon, description) — hourly.</li>
					<li><strong>BCH/USD price</strong> — every 5 minutes.</li>
					<li><strong>Sparklines + 1h/24h/7d % change</strong> — rebuilt from the price history each request; fills in over the 7 days following deploy.</li>
				</ul>
			</div>
		</details>

		<details class="group p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
			<summary class="cursor-pointer text-lg font-semibold text-slate-900 dark:text-white flex items-center justify-between gap-4 list-none">
				<span>What are sparklines?</span>
				<span class="text-violet-500 group-open:rotate-45 transition-transform select-none">+</span>
			</summary>
			<div class="mt-3 text-slate-600 dark:text-slate-300 space-y-2">
				<p>
					The tiny inline chart at the right end of each directory row — it plots the token's
					<strong>Cauldron price over the last 7 days</strong> as a single-line graph. Green
					stroke if the 7-day trend is up, rose if down, slate if flat.
				</p>
				<p>
					Each data point is one
					<a href="https://cauldron.quest/" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">Cauldron</a>
					sync snapshot. With the worker running every 10 minutes, a fully-populated sparkline
					holds ~1,000 points; the SVG downsamples that to a readable line.
				</p>
				<p>
					Tokens without a Cauldron pool (Tapswap-only or not listed) show "—" in the sparkline
					column — no on-chain price history means nothing to chart. The same price series
					drives the 1h / 24h / 7d % change columns too.
				</p>
			</div>
		</details>

		<details id="faq-mcap-hidden" class="group p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 scroll-mt-20">
			<summary class="cursor-pointer text-lg font-semibold text-slate-900 dark:text-white flex items-center justify-between gap-4 list-none">
				<span>Why is the Market cap blank for some tokens?</span>
				<span class="text-violet-500 group-open:rotate-45 transition-transform select-none">+</span>
			</summary>
			<div class="mt-3 text-slate-600 dark:text-slate-300 space-y-2">
				<p>
					A token's market cap is <em>price × circulating supply</em>, and the price
					we have comes from its Cauldron AMM pool. When a pool holds only a few
					dollars of liquidity, a single dust-sized swap can move that price by
					orders of magnitude — and multiplying it by a billion-unit supply yields
					a "cap" that looks enormous but means nothing. Left in the rankings,
					those numbers shove genuinely-traded tokens down the page.
				</p>
				<p>
					So we hide the MCap figure for any token whose Cauldron TVL is
					<strong>below the average TVL of the top half of currently listed
					tokens</strong>. The threshold is recomputed on every page load — as
					more deep pools get listed the bar rises; if liquidity dries up across
					the top end it falls. No hardcoded dollar floor to age out.
				</p>
				<p>
					The token itself is unchanged: price, TVL, supply, holders, sparkline,
					and the detail page are all still shown. Only the misleading derived
					figure is withheld. Tokens with no Cauldron pool at all never had a
					derivable market cap in the first place.
				</p>
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

		<details id="faq-emoji" class="group p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 scroll-mt-20">
			<summary class="cursor-pointer text-lg font-semibold text-slate-900 dark:text-white flex items-center justify-between gap-4 list-none">
				<span>Why don't I see emojis in token names?</span>
				<span class="text-violet-500 group-open:rotate-45 transition-transform select-none">+</span>
			</summary>
			<div class="mt-3 text-slate-600 dark:text-slate-300 space-y-2">
				<p>
					We strip emoji from token names, symbols, and descriptions at display time. In a dense
					directory full of rows, emoji turn into visual noise — they compete with the real name,
					bloat mobile line-heights, and make it hard to tell a serious project from a lookalike
					that copied the same glyph. Removing them keeps the grid scannable.
				</p>
				<p>
					The on-chain data isn't touched. BCMR metadata is stored exactly as the issuer published
					it; the emoji filter runs only in the browser-facing render path. If you need the raw
					string, the
					<code class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">/api/tokens</code>
					endpoint returns it unmodified.
				</p>
			</div>
		</details>

		<details id="faq-icons" class="group p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 scroll-mt-20">
			<summary class="cursor-pointer text-lg font-semibold text-slate-900 dark:text-white flex items-center justify-between gap-4 list-none">
				<span>How does TokenStork filter token icons?</span>
				<span class="text-violet-500 group-open:rotate-45 transition-transform select-none">+</span>
			</summary>
			<div class="mt-3 text-slate-600 dark:text-slate-300 space-y-2">
				<p>
					Token icons come from BCMR metadata that issuers publish themselves — typically as
					<code class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">ipfs://</code>
					URIs anyone on the network can fill with anything. We don't render those URLs directly
					in your browser; instead, every icon goes through a small safety pipeline before it's
					served, and only icons that clear every gate end up visible on the site.
				</p>

				<p class="font-semibold text-slate-700 dark:text-slate-200">What we check</p>
				<ul class="list-disc pl-5 space-y-1">
					<li>
						<strong>Size.</strong> Anything larger than 2 MiB is rejected outright — both
						to keep page weight reasonable and to short-circuit decompression-bomb images.
					</li>
					<li>
						<strong>Format.</strong> PNG, JPEG, WebP, and GIF first-frame are supported as
						static rasters. SVG is rasterized server-side via <code class="px-1 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">resvg</code>
						before serving — your browser never sees the SVG XML, so embedded scripts,
						event handlers, and external <code class="px-1 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">href</code>
						references can't reach you. Animated GIF/APNG render their first frame only.
					</li>
					<li>
						<strong>Adult content.</strong> Each icon is run through Google Cloud Vision's
						SafeSearch classifier. Scores above a configured threshold are auto-blocked;
						borderline scores route to an operator-reviewed queue.
					</li>
					<li>
						<strong>CSAM.</strong> Cloudflare's CSAM Scanning Tool runs against every icon
						the moment it transits their edge — backed by NCMEC + IWF hash databases.
						Matches are blocked at the network edge and reported automatically per US/EU
						mandatory-reporting law.
					</li>
				</ul>

				<p class="font-semibold text-slate-700 dark:text-slate-200">How we serve them</p>
				<p>
					Icons that pass every gate are transcoded to a static WebP, content-addressed by their
					SHA-256 hash, and served from
					<code class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">/icons/&lt;hash&gt;.webp</code>
					behind a long cache. We never hot-link to the issuer's IPFS gateway from your browser —
					all bytes go through our origin, scanned and cached.
				</p>

				<p class="font-semibold text-slate-700 dark:text-slate-200">Why some tokens show a grey placeholder</p>
				<p>
					Default-deny: until an icon is scanned <em>and</em> cleared, you see the placeholder.
					Reasons a token might still show grey:
				</p>
				<ul class="list-disc pl-5 space-y-1">
					<li>The icon is queued for scanning but hasn't been processed yet (new mints flip from grey to real within ~15 minutes).</li>
					<li>The fetch failed (IPFS gateway timeout) — we retry on a future tick.</li>
					<li>The icon was rejected for one of the reasons above.</li>
					<li>The token has no BCMR icon at all — the issuer never published one.</li>
				</ul>

				<p class="font-semibold text-slate-700 dark:text-slate-200">Privacy</p>
				<p>
					The classifier sees only the icon bytes — anonymous, no user identifier, no IP, no
					session. Bytes are processed in transit and not retained by Google for SafeSearch
					calls. We keep the SHA-256 hash and a score; we don't keep the bytes ourselves once
					they're either cleared (transcoded copy on disk) or blocked (deleted).
				</p>

				<p class="text-xs text-slate-500 dark:text-slate-400">
					Spotted an icon that looks wrong (false-blocked legitimate art, or a harmful image
					that slipped through)? Email
					<a href="mailto:hello@panmoni.com" class="text-violet-600 dark:text-violet-400 hover:underline">hello@panmoni.com</a>
					with the token's category hex and we'll triage.
				</p>
			</div>
		</details>

		<details id="faq-tvl" class="group p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 scroll-mt-20">
			<summary class="cursor-pointer text-lg font-semibold text-slate-900 dark:text-white flex items-center justify-between gap-4 list-none">
				<span>How is the headline Total TVL computed?</span>
				<span class="text-violet-500 group-open:rotate-45 transition-transform select-none">+</span>
			</summary>
			<div class="mt-3 text-slate-600 dark:text-slate-300 space-y-2">
				<p>
					The <strong>Total TVL</strong> pill in the header sums BCH-side reserve across
					every pool on every AMM venue we index — Cauldron plus Fex.cash. The number is
					quoted in USD using the live BCH spot price.
				</p>
				<p>
					The Cauldron portion comes from
					<code class="text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono">indexer.cauldron.quest</code>'s
					canonical ecosystem TVL — the same number the
					<a href="/stats" class="text-violet-600 dark:text-violet-400 hover:underline">/stats</a> page
					shows on its "Cauldron AMM" card. We cache it for 30 minutes via our
					<code class="text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono">sync-cauldron-stats</code>
					worker so the homepage doesn't pay a network round-trip on every render.
				</p>
				<p>
					The Fex portion is summed locally: our Fex worker enumerates every pool on the BCH
					chain via a <code class="text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono">scantxoutset</code> against the AssetCovenant P2SH and stores both the
					per-category canonical pool (for directory price + spread display) and the
					sum across all pools per category (for the headline TVL).
				</p>
				<p>
					Tapswap is deliberately excluded — its open offers are P2P intent, not pooled
					liquidity, so summing them as TVL would double-count or mislead. We use the
					conservative single-side convention everywhere (BCH-side reserve only, not the
					doubled both-sides figure that the wider DeFi industry typically reports).
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

		<details id="faq-vote-ranking" class="group p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 scroll-mt-20">
			<summary class="cursor-pointer text-lg font-semibold text-slate-900 dark:text-white flex items-center justify-between gap-4 list-none">
				<span>How are tokens ranked on the up/down vote leaderboards?</span>
				<span class="text-violet-500 group-open:rotate-45 transition-transform select-none">+</span>
			</summary>
			<div class="mt-3 text-slate-600 dark:text-slate-300 space-y-3">
				<p>
					The "Most upvoted / downvoted / controversial" leaderboards on the homepage don't
					just count raw <span class="font-mono">↑</span> and <span class="font-mono">↓</span>
					clicks. Each vote contributes a <em>weighted</em> score, and the leaderboard sorts on
					the sum of those weights. The directory's <code class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">?sort=upvoted</code> /
					<code class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">downvoted</code> /
					<code class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">controversial</code> options use the same weights.
				</p>
				<p>Two things shape a single vote's weight:</p>
				<ol class="list-decimal list-inside ml-2 space-y-2">
					<li>
						<strong>How long the voter has been around.</strong> Each wallet's tenure is the number
						of distinct UTC days on which it has cast at least one vote action. A vote from a
						brand-new wallet contributes <span class="font-mono">1.0</span>; a vote from a wallet
						that's been active 30 days contributes <span class="font-mono">5.0</span>; a year-tenured
						wallet contributes about <span class="font-mono">8.5</span>. Growth is logarithmic
						(<span class="font-mono">log₂(tenure_days + 2)</span>) — established voters get more
						say, but a tireless contributor doesn't dominate.
					</li>
					<li>
						<strong>How recently the vote was cast.</strong> Vote weight halves every 7 days
						(<span class="font-mono">0.5<sup>age_days / 7</sup></span>). A vote cast today is worth
						<span class="font-mono">1.0×</span>, last week's is worth <span class="font-mono">0.5×</span>,
						two weeks old is <span class="font-mono">0.25×</span>, a month-old vote is about
						<span class="font-mono">0.05×</span>. Old enthusiasm fades; the leaderboard reflects
						the current mood.
					</li>
				</ol>
				<p>
					Multiplied together, the formula favours <strong>consistent votes from established
					voters</strong>, and naturally pushes raid-style bursts of fresh wallets toward the
					bottom of the ranking. The raw <span class="font-mono">↑</span> /
					<span class="font-mono">↓</span> counts shown next to each token are still the simple
					totals — only the <em>ordering</em> uses the weighted score.
				</p>
				<p>
					Each wallet may cast, change, or retract at most <strong>20 vote actions per UTC
					day</strong>. That's well above any organic per-day activity but tight enough that a
					script-controlled wallet can't shove a token to the top in one sitting. The counter
					resets at 00:00 UTC.
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
