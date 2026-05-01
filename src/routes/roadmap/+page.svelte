<svelte:head>
	<title>Roadmap — Token Stork</title>
	<meta
		name="description"
		content="What's shipped and what's next on TokenStork."
	/>
</svelte:head>

<script lang="ts">
	// Roadmap items. `status` drives the icon + color. Last updated 2026-04-25
	// (post-/blocks ship) — if anything drifts by more than a quarter, come
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
				'BCMR metadata hydrator (Paytaca) on a 4-hour cadence.'
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
			title: 'Ecosystem dashboard at /stats',
			status: 'done',
			bullets: [
				'Cards for new categories in 24h / 7d / 30d, all linkable to the matching directory filter.',
				'By-type counters with FT / NFT / FT+NFT split.',
				'Tradeable counters per venue (Cauldron / Tapswap / Fex), each linking to the filtered directory.',
				'Three-venue overlap Venn — cauldron-only / fex-only / tapswap-only / pair intersections / all-three (the arb universe).',
				'Genesis-by-month growth chart, decimals histogram, BCMR metadata completeness, and live Cauldron AMM aggregates from indexer.cauldron.quest.'
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
				'Full-text search across name, symbol, description, and category.',
				'Moderation blocklist + public /moderated transparency page.',
				'Public "report a token" form.',
				'Animated-image policy — the directory is still-image only.'
			]
		}
	];

	const planned: Item[] = [
		{
			title: 'BlockBook integration (enrichment + verify)',
			status: 'planned',
			bullets: [
				'Unlocks live holder counts, NFT instance lists, and the "fully burned" counter on /stats.',
				'Closes an old max-supply edge case on high-activity addresses.',
				'Weekly canary comparing our index against BlockBook to catch drift.',
				'Currently mid-IBD on the production VPS — memory pressure caps the throughput at ~50 blocks/min in the early-CashTokens range; ETA ~1 week from now to reach tip given the remaining ~565k blocks.'
			]
		},
		{
			title: 'Icon safety pipeline',
			status: 'planned',
			bullets: [
				'Fetch → CSAM + NSFW scan → transcode to WebP → serve from our origin.',
				'Default-deny: the SVG placeholder is shown until each icon is explicitly cleared.',
				'Replaces the earlier transcode-only plan.'
			]
		},
		{
			title: 'Operational hardening',
			status: 'planned',
			bullets: [
				'Nightly Postgres backups with offsite ship.',
				'Uptime monitoring on the public API.',
				'Tail-staleness watchdog so a silently-stopped indexer gets noticed.',
				'Weekly VPS snapshot toggle.'
			]
		},
		{
			title: 'Wallet login (WalletConnect v2)',
			status: 'planned',
			bullets: [
				'Sign in by signing a server-issued challenge in your BCH wallet — no email, no password, no OAuth.',
				'WalletConnect v2 over the wc2-bch-bcr namespace (Cashonize, Paytaca, Zapit, EC plugin) as the primary UX; paste-cashaddr-and-signature fallback for users without a WC-aware wallet.',
				'libauth ECDSA recovery server-side. HttpOnly + Secure + SameSite=Strict 30-day session cookie. Single-use 5-min challenges to block replay.',
				'Schema, verifier, API endpoints, hooks middleware, /login page, and header indicator all built. Awaiting heavy-duty review + a WalletConnect Cloud project ID before the public ship.'
			]
		},
		{
			title: 'Wallet-tied watchlist',
			status: 'planned',
			bullets: [
				'Star button on token cards + a /watchlist route, scoped to the visitor\'s BCH wallet address — not localStorage.',
				'Lands right after wallet login so there\'s a stable identity to attach to from day one.',
				'No anonymous mode — single source of truth tied to the wallet, no anon-to-migrated handoff to keep correct.'
			]
		},
		{
			title: 'Richer token detail page',
			status: 'planned',
			bullets: [
				'Long-horizon price + volume charts with 24h / 7d / 30d / 90d / 1y / all ranges.',
				'Holder distribution + concentration metrics (top-10, Gini, Herfindahl) — needs BlockBook.'
			]
		},
		{
			title: 'Stats follow-ups',
			status: 'planned',
			bullets: [
				'Top gainers / losers and TVL movers on /stats — pending more accumulated price history.',
				'NFT-aware Tapswap arbitrage — current /arbitrage table is FT-only on the Tapswap side; NFT listings need their own per-commitment treatment because "lowest ask" doesn\'t aggregate cleanly across unique items.'
			]
		},
		{
			title: 'Search + tagging polish',
			status: 'planned',
			bullets: [
				'Fuzzy search via pg_trgm similarity ("grm" matches "GRIM", "suhi" matches "sushi").',
				'Community-submitted tags for filtering the directory (stablecoin, memecoin, utility, DAO, etc.).'
			]
		}
	];

	const later: Item[] = [
		{
			title: 'BCH wallet login',
			status: 'later',
			bullets: [
				'Challenge / response signed by the user\'s wallet — no email, no password, no OAuth.',
				'Unlocks cross-device watchlist, portfolio with P&L, price alerts, and personal annotations.',
				'CSV export on the directory + per-token history endpoint for power users.'
			]
		},
		{
			title: 'Token creation UI',
			status: 'later',
			bullets: [
				'Mint fungible tokens and NFTs + their BCMR metadata via a web form — no CLI required.',
				'WalletConnect 2 / CashConnect integration.',
				'Token management: metadata updates, dividends, mass distribution, airdrops, authbase hardening.'
			]
		},
		{
			title: 'Ecosystem leaderboards',
			status: 'later',
			bullets: [
				'/defi page — BCH locked across covenant families (Cauldron, AnyHedge, Moria, BCH Bull, BCH Guru, Badgers, Emerald DAO, BCH PUMP). Headline "Total BCH locked in DeFi".',
				'/nft page — minted / max supply, mint price, mint revenue, floor price, holders, last mint, mints in the last 7 days.',
				'Backed by a hand-curated projects/issuers layer that also powers category filter chips.'
			]
		},
		{
			title: 'BCMR identity management',
			status: 'later',
			bullets: [
				'Create and update BCMR identities for people and organisations.',
				'Full audit log of metadata changes.'
			]
		},
		{
			title: 'On-chain fundraising + dividends',
			status: 'later',
			bullets: [
				'Launch ICOs via form with accountability milestones + transparent treasury + investor voting.',
				'Dividend distribution tool.',
				'Trading-volume tracking.'
			]
		},
		{
			title: 'Ecosystem surfaces',
			status: 'later',
			bullets: [
				'Exchanges tab (volumes, pairs, founding).',
				'Dapps tab + news tab.',
				'Comments + reviews on tokens, dapps, NFT series.',
				'Airdrops calendar + upcoming events.'
			]
		}
	];
</script>

<main class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent mb-4">
		Roadmap
	</h1>
	<p class="text-slate-600 dark:text-zinc-300 mb-10">
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
					<ul class="list-disc list-inside ml-2 mt-2 text-sm text-slate-600 dark:text-zinc-200 space-y-1">
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
					<ul class="list-disc list-inside ml-2 mt-2 text-sm text-slate-600 dark:text-zinc-200 space-y-1">
						{#each item.bullets as b (b)}
							<li>{b}</li>
						{/each}
					</ul>
				</article>
			{/each}
		</div>
	</section>

	<section class="mb-12">
		<h2 class="text-2xl font-bold text-slate-500 dark:text-zinc-300 mb-6 flex items-center gap-2">
			<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<circle cx="12" cy="12" r="10" />
				<polyline points="12 6 12 12 16 14" />
			</svg>
			Later — aspirational
		</h2>
		<div class="grid gap-5">
			{#each later as item (item.title)}
				<article class="p-5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
					<h3 class="text-lg font-semibold text-slate-900 dark:text-white">{item.title}</h3>
					<ul class="list-disc list-inside ml-2 mt-2 text-sm text-slate-600 dark:text-zinc-200 space-y-1">
						{#each item.bullets as b (b)}
							<li>{b}</li>
						{/each}
					</ul>
				</article>
			{/each}
		</div>
	</section>

	<p class="text-xs text-slate-500 dark:text-zinc-300 mt-10">
		Roadmap last refreshed 2026-04-25. If you'd like to see something on here
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
