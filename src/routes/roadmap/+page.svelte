<svelte:head>
	<title>Roadmap — Token Stork</title>
	<meta
		name="description"
		content="What's next on TokenStork."
	/>
</svelte:head>

<script lang="ts">
	// Roadmap items. `status` drives the icon + color. Last groomed 2026-06-20 —
	// the "Shipped" section was retired; this page now lists only forward-looking
	// work. If anything drifts by more than a quarter, come back and groom. The
	// original roadmap had a version-number scheme (0.0.3, 0.0.4, …) that turned
	// out to be ambitious vaporware; we now group by theme + status.
	interface Item {
		title: string;
		status: 'planned' | 'later';
		bullets: string[];
	}

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
			title: 'Airdrop tools — follow-ups',
			status: 'planned',
			bullets: [
				'Standalone airdrop page — paste/import any address list (manual entry, paste-many, CSV) and airdrop a chosen token to all of them in one tx.',
				'Set-algebra recipient builder: union / intersect / exclude across multiple categories + blocklists + watchlists.',
				'Block-height snapshots ("holders as of block 950,000") + multi-venue DEX-pool unwrapping so LP contracts don\'t eat budget meant for real holders.',
				'WalletConnect v2 direct-sign in-page (currently paste-signed-hex matching /mint).'
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
		to make it that way. Below is what's next.
	</p>

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
		Roadmap last refreshed 2026-06-20. If you'd like to see something on here
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
