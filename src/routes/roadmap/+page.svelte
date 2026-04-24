<svelte:head>
	<title>Roadmap — Token Stork</title>
	<meta
		name="description"
		content="What's shipped and what's next on TokenStork."
	/>
</svelte:head>

<script lang="ts">
	// Roadmap items. `status` drives the icon + color. Last updated 2026-04-24
	// — if anything drifts by more than a quarter, come back and groom. The
	// original roadmap had a version-number scheme (0.0.3, 0.0.4, …) that
	// turned out to be ambitious vaporware; we now group by theme + status.
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
				'Tapswap P2P — listings detected on-chain via the MPSW OP_RETURN protocol (no GraphQL).',
				'Cauldron + Tapswap venue logos on every directory row.'
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
				'Initial sync currently running.'
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
			title: 'Anonymous watchlist',
			status: 'planned',
			bullets: [
				'Star button on token cards + a /watchlist route, backed by localStorage.',
				'Foundation for a cross-device portfolio once wallet login ships.'
			]
		},
		{
			title: 'Fex.cash — third venue',
			status: 'planned',
			bullets: [
				'On-chain UTXO walker for the Fex AMM pools; no public indexer needed.',
				'Adds an "On Fex" directory filter + venue badge.',
				'Small ecosystem today (~10 pools) but feeds the arbitrage scanner real content.'
			]
		},
		{
			title: 'Cross-venue arbitrage + richer /stats',
			status: 'planned',
			bullets: [
				'New /arbitrage page surfacing Cauldron ↔ Tapswap price gaps (after fees + slippage).',
				'Expanded /stats ecosystem dashboard: top gainers/losers, growth curve, venue overlap, metadata completeness, active-minting count.'
			]
		},
		{
			title: 'Richer token detail page',
			status: 'planned',
			bullets: [
				'Long-horizon price + volume charts with 24h / 7d / 30d / 90d / 1y / all ranges.',
				'Holder distribution + concentration metrics (top-10, Gini, Herfindahl) — needs BlockBook.',
				'Tapswap spend-lifecycle detection so stale offers drop off.'
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
	<p class="text-slate-600 dark:text-slate-400 mb-10">
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
					<ul class="list-disc list-inside ml-2 mt-2 text-sm text-slate-600 dark:text-slate-300 space-y-1">
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
					<ul class="list-disc list-inside ml-2 mt-2 text-sm text-slate-600 dark:text-slate-300 space-y-1">
						{#each item.bullets as b (b)}
							<li>{b}</li>
						{/each}
					</ul>
				</article>
			{/each}
		</div>
	</section>

	<section class="mb-12">
		<h2 class="text-2xl font-bold text-slate-500 dark:text-slate-400 mb-6 flex items-center gap-2">
			<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<circle cx="12" cy="12" r="10" />
				<polyline points="12 6 12 12 16 14" />
			</svg>
			Later — aspirational
		</h2>
		<div class="grid gap-5">
			{#each later as item (item.title)}
				<article class="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
					<h3 class="text-lg font-semibold text-slate-900 dark:text-white">{item.title}</h3>
					<ul class="list-disc list-inside ml-2 mt-2 text-sm text-slate-600 dark:text-slate-300 space-y-1">
						{#each item.bullets as b (b)}
							<li>{b}</li>
						{/each}
					</ul>
				</article>
			{/each}
		</div>
	</section>

	<p class="text-xs text-slate-500 dark:text-slate-400 mt-10">
		Roadmap last refreshed 2026-04-24. If you'd like to see something on here
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
