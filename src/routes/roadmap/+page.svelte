<svelte:head>
	<title>Roadmap — Token Stork</title>
	<meta
		name="description"
		content="What's shipped and what's next on TokenStork."
	/>
</svelte:head>

<script lang="ts">
	// Roadmap items. `status` drives the icon + color. Last updated 2026-05-01
	// (post-Gini ship) — if anything drifts by more than a quarter, come
	// back and groom. The original roadmap had a version-number scheme
	// (0.0.3, 0.0.4, …) that turned out to be ambitious vaporware; we now
	// group by theme + status.
	interface Item {
		title: string;
		status: 'done' | 'planned' | 'later';
		bullets: string[];
	}

	const shipped: Item[] = [
		{
			title: 'Server-side data pipeline',
			status: 'done',
			bullets: [
				'Full Postgres + Rust workers replacing client-side API fan-out.',
				'Archival BCHN + ZMQ hashblock tail worker — sub-second indexing from tip.',
				'BCMR metadata hydrator (Paytaca) on a 4-hour cadence.',
				'Tail-staleness watchdog timer — alerts within a minute if the always-on indexer goes silent.'
			]
		},
		{
			title: 'Individual token pages',
			status: 'done',
			bullets: [
				'Detail page per category with on-chain supply, holder count, genesis info.',
				'Live Cauldron price + TVL.',
				'Open Tapswap P2P listings card.',
				'Full BCMR metadata card — status, splitId, URIs, tags, NFT types, extensions.'
			]
		},
		{
			title: 'Multi-venue tradeability',
			status: 'done',
			bullets: [
				'Cauldron AMM — price, TVL, "On Cauldron" directory filter.',
				'Tapswap P2P — listings detected on-chain via the MPSW OP_RETURN protocol (no GraphQL). Full lifecycle: open → taken / cancelled detected by spend-walker on every block; pre-deploy listings backfilled retroactively.',
				'Fex.cash AMM — pool state read directly from BCHN UTXOs against the AssetCovenant P2SH; "On Fex" filter, side-by-side spread% comparison on every detail page, third Tradeable card on /stats.',
				'Three venue logos on every directory row.'
			]
		},
		{
			title: 'Cross-venue arbitrage scanner',
			status: 'done',
			bullets: [
				'/arbitrage page — every token listed on at least 2 of 3 venues (Cauldron AMM / Fex AMM / Tapswap P2P), ranked by raw spread % with Buy / Sell action buttons that open the cheaper and more-expensive venue.',
				'Per-row dynamic fee model: buy-leg + sell-leg fees specific to whichever venues this row\'s cheapest-vs-most-expensive pair is using (Cauldron 0.3% / Fex 0.6% / Tapswap 0% buy + 3% sell). Net column reflects the actual pair\'s fee, not a global floor.',
				'Tapswap price derived as the lowest want_sats / has_amount across open FT-only listings; NFT pricing semantics differ and are tracked as a follow-up.',
				'View toggles for ≥ 1% (default), ≥ 5%, and show-all.'
			]
		},
		{
			title: 'Per-block chain economics (/blocks)',
			status: 'done',
			bullets: [
				'/blocks page — every block since CashTokens activation (792,772) with transaction count, miner take (coinbase output), implied fees (coinbase − subsidy at the height-derived halving schedule), total economic value transferred, and block size.',
				'Headline strip with 7d / 30d / all-time aggregates plus sparklines for transaction count, fees, and economic value.',
				'Block hashes link out to salemkode.com for full per-tx detail; pagination at 50 rows per page, newest first.',
				'Live tail walker (Pass 4) and the one-shot blocks-backfill binary share a pure-Rust block summarizer + BCH halving-schedule subsidy table — single source of truth.'
			]
		},
		{
			title: 'Front-page market data',
			status: 'done',
			bullets: [
				'1h / 24h / 7d price-change columns.',
				'7-day sparkline per token.',
				'Market cap column — hidden for low-liquidity tokens so the figure is never misleading.',
				'Default TVL-desc sort so listed tokens surface first.'
			]
		},
		{
			title: 'Accessibility + quality of life',
			status: 'done',
			bullets: [
				'Light / dark mode with pre-hydration bootstrap.',
				'Full-text search + fuzzy search via pg_trgm similarity ("grm" matches "GRIM").',
				'Moderation blocklist + public /moderated transparency page.',
				'Public "report a token" form.',
				'Animated-image policy — the directory is still-image only.',
				'CSP tightened to `mode: \'hash\'` with no `\'unsafe-inline\'` for scripts or styles.'
			]
		},
		{
			title: 'Wallet-tied user accounts',
			status: 'done',
			bullets: [
				'BCH wallet login via WalletConnect v2 + paste-and-go fallback. No email, no password, no OAuth — just an ECDSA signature against a server-issued challenge.',
				'Personal watchlist scoped to the visitor\'s wallet — single source of truth, no anonymous mode to migrate.',
				'Up / down votes on every token, with leaderboards (most upvoted, most downvoted, most controversial) on the homepage.',
				'Vote ranks weight votes by voter tenure × 7-day-decay recency (Sybil-resistant by construction); 20-vote/UTC-day quota per wallet.'
			]
		},
		{
			title: 'BlockBook-driven enrichment',
			status: 'done',
			bullets: [
				'Per-category live UTXO count, NFT count, holder count, fully-burned flag, current supply.',
				'Top holders table with %-of-supply on every token detail page.',
				'Gini distribution score + 5-tier badge (Excellent / Good / Fair / Poor / Whale-controlled) per token, plus a directory-wide median + per-tier histogram on /stats.',
				'24h gainer / loser / TVL-mover badges sourced from accumulated price history.'
			]
		},
		{
			title: 'Mint page (CashTokens minting wizard)',
			status: 'done',
			bullets: [
				'Wallet-gated `/mint` route with a 6-step wizard: Type → Identity → Supply → Review → Sign + broadcast → Publish BCMR.',
				'Genesis tx built browser-side via libauth — our server never sees a private key.',
				'BCMR JSON generated client-side; download or pin to IPFS via the user\'s own web3.storage / Pinata API key (the key never reaches our server).',
				'Resumable wizard sessions persisted across browser refreshes via the wallet-cookie.',
				'Direct WalletConnect `bch_signTransaction` is a follow-up; today the wallet handoff is paste-the-signed-hex, which works with every BCH wallet that signs raw tx hex.'
			]
		},
		{
			title: 'Icon safety pipeline',
			status: 'done',
			bullets: [
				'Default-deny: every BCMR icon goes through Cloudflare CSAM scanning (NCMEC + IWF) at the edge + Google Cloud Vision SafeSearch in our pipeline before any byte reaches a visitor.',
				'Content-addressed serving: scanned icons land at `/icons/<sha256>.webp` with a year-long immutable cache; un-cleared icons render the SVG placeholder.',
				'SVG support: `usvg` rasterisation step lets vector icons clear the same gates as raster.',
				'Weekly Sunday rescan timer catches same-URL-different-bytes attacks (icon hosts swapping content silently).',
				'Public /moderated transparency page lists hidden tokens + reason; /faq + /privacy disclose the scanning architecture.'
			]
		},
		{
			title: 'Cross-venue arbitrage scanner (/arbitrage)',
			status: 'done',
			bullets: [
				'Every token listed on at least 2 of 3 venues (Cauldron AMM / Fex AMM / Tapswap P2P), ranked by raw spread % with Buy / Sell action buttons.',
				'Per-row dynamic fee model: buy-leg + sell-leg fees specific to whichever venues the row\'s cheapest-vs-most-expensive pair is using.',
				'View toggles for ≥ 1% (default), ≥ 5%, and show-all.'
			]
		},
		{
			title: 'Per-block + mining dashboards',
			status: 'done',
			bullets: [
				'/blocks page — every block since CashTokens activation (792,772) with tx count, miner take, implied fees, total economic value transferred, block size; sparklines for 7d / 30d / all-time aggregates.',
				'/mining page — coinbase scriptSig miner-pool attribution; 4-card headline strip + 3-window pool-attribution tables; average block-time cards.'
			]
		},
		{
			title: 'Ecosystem dashboard at /stats',
			status: 'done',
			bullets: [
				'Cards for new categories in 24h / 7d / 30d, all linkable to the matching directory filter.',
				'By-type counters with FT / NFT / FT+NFT split.',
				'Tradeable counters per venue (Cauldron / Tapswap / Fex), each linking to the filtered directory.',
				'Three-venue overlap Venn — cauldron-only / fex-only / tapswap-only / pair intersections / all-three (the arb universe).',
				'Genesis-by-month growth chart (per-bar totals), decimals histogram, BCMR metadata completeness, FT supply distribution, 30-day ecosystem TVL sparkline, Cauldron live aggregates, Gini distribution histogram.'
			]
		},
		{
			title: 'Long-horizon charts on the token detail page',
			status: 'done',
			bullets: [
				'Native-SVG line chart with 24h / 7d / 30d / 90d / 1y / all range toggles, bookmarkable via ?range=… query param.',
				'Per-day volume bars below the price line, derived from |Δ tvl_satoshis| between consecutive token_price_history snapshots.',
				'Hover tooltip with per-bucket price + volume; lower-bound disclosure on the volume estimate matches the 4 h Cauldron sync cadence.'
			]
		}
	];

	const planned: Item[] = [
		{
			title: 'Operational hardening',
			status: 'planned',
			bullets: [
				'Nightly pg_dump + offsite ship (Backblaze B2 / Hetzner Storage Box, ~€1/mo) with 7-daily / 4-weekly retention.',
				'UptimeRobot free-tier monitor on /api/tokens?limit=1.',
				'Weekly Netcup snapshot toggle.'
			]
		},
		{
			title: 'Airdrop tools',
			status: 'planned',
			bullets: [
				'One-click "Airdrop" button on token detail pages — split your tokens equally (or by holder weight) across all holders of another token.',
				'Standalone airdrop page — paste/import any address list (manual entry, paste-many, CSV) and airdrop a chosen token to all of them in one tx.',
				'Set-algebra recipient builder: union / intersect / exclude across multiple categories + blocklists + watchlists.',
				'Block-height snapshots ("holders as of block 950,000") + multi-venue DEX-pool unwrapping so LP contracts don\'t eat budget meant for real holders.'
			]
		},
		{
			title: 'Token claim + management',
			status: 'planned',
			bullets: [
				'Wallet owners of a category can manage it via TokenStork: BCMR updates, dividends, mass distribution, manage minting NFTs, additional supply for FT+NFT hybrids.',
				'Import-existing-token flow for tokens minted elsewhere.',
				'Add BCMR support to existing-but-unregistered tokens.',
				'One-click submit to the TokenStork BCMR registry (replacement for OTR mirroring).'
			]
		},
		{
			title: 'Stats follow-ups + tagging',
			status: 'planned',
			bullets: [
				'Top gainers / losers and TVL movers on /stats — most are live; the long-window variants need ≥ 2 weeks of accumulated price history.',
				'Community-submitted tags for filtering the directory (stablecoin, memecoin, utility, DAO, etc.).',
				'NFT-aware Tapswap arbitrage — current /arbitrage is FT-only on the Tapswap side; NFT listings need per-commitment treatment.',
				'Holder concentration: top-10 horizontal bar chart on the detail page (Gini already shipped).'
			]
		},
		{
			title: 'CSV export + power-user APIs',
			status: 'planned',
			bullets: [
				'?format=csv on /api/tokens (directory rows with all the columns the UI renders).',
				'New /api/tokens/<cat>/history endpoint returning full price + TVL history for one category.',
				'Pairs naturally with the long-horizon chart — same data, two surfaces.'
			]
		}
	];

	const later: Item[] = [
		{
			title: 'Personal portfolio + alerts',
			status: 'later',
			bullets: [
				'Portfolio with P&L: manual buy entries OR derived from on-chain holdings at the linked wallet via BlockBook.',
				'Per-user price alerts (wallet-delivered notification, or email-as-metadata-only — never used for login).',
				'Personal annotations on tokens ("this one was the rug").'
			]
		},
		{
			title: 'Ecosystem leaderboards',
			status: 'later',
			bullets: [
				'/defi page — BCH locked across covenant families (Cauldron, AnyHedge, Moria, BCH Bull, BCH Guru, Badgers, Emerald DAO, BCH PUMP). Headline "Total BCH locked in DeFi".',
				'/nft page — minted / max supply, mint price, mint revenue, floor price, holders, last mint, mints in the last 7 days.',
				'Backed by a hand-curated projects/issuers layer that also powers category filter chips.',
				'Wallet-support badges ("Listed in Zapit / Paytaca / Cashonize / Electron Cash") via periodic scrape.'
			]
		},
		{
			title: 'BCMR identity management',
			status: 'later',
			bullets: [
				'Create and update BCMR identities for people and organisations.',
				'Full audit log of metadata changes.',
				'Updates feed when tokens revise their BCMR data; "recently updated" + "listed in registry X" badges on token cards.'
			]
		},
		{
			title: 'On-chain fundraising + dividends',
			status: 'later',
			bullets: [
				'Launch ICOs via form with accountability milestones + transparent treasury + investor voting.',
				'Dividend distribution tool.',
				'Trading-volume tracking + flipstarter integration.'
			]
		},
		{
			title: 'Performance + accessibility pass',
			status: 'later',
			bullets: [
				'Lighthouse pass: responsive images, CLS, CSP/XSS hardening.',
				'Streaming + suspense + islands for parallelised page loads.',
				'A11y sweep: aria labels, keyboard nav, screen-reader trend summaries.',
				'Custom site themes; responsive breakpoint audit.'
			]
		},
		{
			title: 'Ecosystem surfaces',
			status: 'later',
			bullets: [
				'Exchanges tab (volumes, pairs, founding).',
				'Dapps tab + news tab.',
				'Comments + reviews on tokens, dapps, NFT series.',
				'Airdrops calendar + upcoming events.',
				'Heatmaps, embeddable widgets, public API documentation.'
			]
		},
		{
			title: 'Real-world contracts',
			status: 'later',
			bullets: [
				'Additional on-chain products — annuities, structured payouts.',
				'Outreach for RWA tokenisation partnerships on CashTokens.',
				'Tokenisation use-case content + tooling demos.'
			]
		}
	];
</script>

<main class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent mb-4">
		Roadmap
	</h1>
	<p class="mb-10 ts-text-muted">
		TokenStork.com aims to be a market-cap site for BCH CashTokens and a
		comprehensive service provider for on-chain CashTokens operations and data.
		Working with CashTokens should be smooth and easy, and TokenStork.com aims
		to make it that way.
	</p>

	<section class="mb-12">
		<h2 class="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mb-6 flex items-center gap-2">
			<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<polyline points="20 6 9 17 4 12" />
			</svg>
			Shipped
		</h2>
		<div class="grid gap-5">
			{#each shipped as item (item.title)}
				<article class="p-5 rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/20">
					<h3 class="text-lg font-semibold text-slate-900 dark:text-white">{item.title}</h3>
					<ul class="list-disc list-inside ml-2 mt-2 text-sm space-y-1 ts-text-body">
						{#each item.bullets as b (b)}
							<li>{b}</li>
						{/each}
					</ul>
				</article>
			{/each}
		</div>
	</section>

	<section class="mb-12">
		<h2 class="text-2xl font-bold text-amber-600 dark:text-amber-400 mb-6 flex items-center gap-2">
			<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<circle cx="12" cy="12" r="10" />
				<polyline points="12 6 12 12 16 14" />
			</svg>
			Planned — next few months
		</h2>
		<div class="grid gap-5">
			{#each planned as item (item.title)}
				<article class="p-5 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20">
					<h3 class="text-lg font-semibold text-slate-900 dark:text-white">{item.title}</h3>
					<ul class="list-disc list-inside ml-2 mt-2 text-sm space-y-1 ts-text-body">
						{#each item.bullets as b (b)}
							<li>{b}</li>
						{/each}
					</ul>
				</article>
			{/each}
		</div>
	</section>

	<section class="mb-12">
		<h2 class="text-2xl font-bold mb-6 flex items-center gap-2 ts-text-muted">
			<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<circle cx="12" cy="12" r="10" />
				<polyline points="12 6 12 12 16 14" />
			</svg>
			Later — aspirational
		</h2>
		<div class="grid gap-5">
			{#each later as item (item.title)}
				<article class="p-5 rounded-xl border ts-border-subtle ts-surface-panel">
					<h3 class="text-lg font-semibold text-slate-900 dark:text-white">{item.title}</h3>
					<ul class="list-disc list-inside ml-2 mt-2 text-sm space-y-1 ts-text-body">
						{#each item.bullets as b (b)}
							<li>{b}</li>
						{/each}
					</ul>
				</article>
			{/each}
		</div>
	</section>

	<p class="text-xs mt-10 ts-text-muted">
		Roadmap last refreshed 2026-05-01. If you'd like to see something on here
		that isn't yet — email <a href="mailto:hello@panmoni.com" class="text-violet-600 dark:text-violet-400 hover:underline">hello@panmoni.com</a>
		or
		<a
			href="https://github.com/Panmoni/tokenstork/issues"
			target="_blank"
			rel="noopener noreferrer"
			class="text-violet-600 dark:text-violet-400 hover:underline"
		>open an issue on GitHub</a>.
	</p>
</main>
