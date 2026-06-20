<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
</script>

<svelte:head>
	<title>{m.about_meta_title()}</title>
	<meta
		name="description"
		content={m.about_meta_description()}
	/>
</svelte:head>

<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent mb-6">
		{m.about_h1()}
	</h1>

	<div class="prose prose-slate dark:prose-invert max-w-none">
		<p class="ts-text-body">
			{m.about_intro_1()}
			<a href="https://bchworks.com/" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">BCH</a>
			<a href="https://cashtokens.org/" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">CashTokens</a>
			{m.about_intro_2()}
			<a href="https://georgedonnelly.com/" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">George Donnelly</a>.
			<a href="https://github.com/Panmoni/tokenstork" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">{m.about_code_oss()}</a>.
			{m.about_intro_3()}
			<a href="https://github.com/Panmoni/tokenstork/issues" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">{m.about_issues()}</a>
			{m.about_intro_or()} <a href={localizeHref('/roadmap')} class="text-violet-600 dark:text-violet-400 hover:underline">{m.about_roadmap_link()}</a>.
		</p>
		<p class="mt-4 ts-text-body">
			{m.about_feedback()}
		</p>
	</div>

	<div class="grid gap-5 md:grid-cols-2 mt-10">
		<section class="p-6 rounded-xl border ts-border-subtle ts-surface-panel">
			<h2 class="text-xl font-bold text-slate-900 dark:text-white mb-3">{m.about_help_h2()}</h2>
			<p class="ts-text-body">
				{m.about_help_1()} <strong>{m.about_help_hire()}</strong> {m.about_help_2()}
				<a href="mailto:george@panmoni.com" class="text-violet-600 dark:text-violet-400 hover:underline">george@panmoni.com</a>
				{m.about_help_3()}
			</p>
		</section>

		<section class="p-6 rounded-xl border ts-border-subtle ts-surface-panel">
			<h2 class="text-xl font-bold text-slate-900 dark:text-white mb-3">{m.about_news_h2()}</h2>
			<p class="ts-text-body">
				{m.about_news_1()}
				<a href="https://www.reddit.com/r/BCHCashTokens/" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">r/BCHCashTokens</a>{m.about_news_2()}
			</p>
		</section>

		<section class="p-6 rounded-xl border md:col-span-2 ts-border-subtle ts-surface-panel">
			<h2 class="text-xl font-bold text-slate-900 dark:text-white mb-3">
				{m.about_registry_h2()}
			</h2>
			<p class="ts-text-body">
				{m.about_registry_1()}
				<a
					href="https://tokenstork.com/.well-known/bitcoin-cash-metadata-registry.json"
					target="_blank"
					rel="noopener noreferrer"
					class="text-violet-600 dark:text-violet-400 hover:underline"
				>TokenStorkRegistry</a>{m.about_registry_2()}
				<a
					href="https://github.com/Panmoni/tokenstork/blob/main/public/.well-known/bitcoin-cash-metadata-registry.json"
					target="_blank"
					rel="noopener noreferrer"
					class="text-violet-600 dark:text-violet-400 hover:underline"
				>{m.about_registry_repo()}</a>{m.about_registry_3()}
				<a href="https://otr.cash" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">otr.cash</a>.
			</p>
		</section>

		<section class="p-6 rounded-xl border border-violet-200 dark:border-violet-900/50 bg-violet-50/40 dark:bg-violet-950/20 md:col-span-2">
			<h2 class="text-xl font-bold text-slate-900 dark:text-white mb-3">{m.about_support_h2()}</h2>
			<p class="mb-4 ts-text-body">
				{m.about_support_body()}
			</p>
			<p class="font-mono text-sm border rounded px-3 py-2 inline-block select-all break-all ts-text-primary ts-border-strong ts-surface-panel">
				bitcoincash:qz3pxmwda8gd42wa8k9yfxcwhcaapeuhygjc8mc4m8
			</p>
		</section>

		<section class="p-6 rounded-xl border md:col-span-2 ts-border-subtle ts-surface-panel">
			<h2 class="text-xl font-bold text-slate-900 dark:text-white mb-3">{m.about_ack_h2()}</h2>
			<p class="mb-4 ts-text-body">
				{m.about_ack_intro()}
			</p>
			<ul class="list-disc list-inside ml-2 space-y-1.5 ts-text-body">
				<li>
					<a href="https://cashtokens.org/docs/category/cashtokens-chip/" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">CashTokens CHIP</a>
					{m.about_ack_cashtokens()}
				</li>
				<li>
					<a href="https://github.com/bitjson/chip-bcmr" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">CHIP-BCMR</a>
					{m.about_ack_chipbcmr()}
				</li>
				<li>
					<a href="https://cauldron.quest/" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">Cauldron</a>
					{m.about_ack_cauldron()}
				</li>
				<li>
					<a href="https://tapswap.cash/" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">Tapswap</a>
					+
					<a href="https://x.com/mainnet_pat" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">mainnet_pat</a>
					{m.about_ack_tapswap()}
				</li>
				<li>
					<a href="https://github.com/mainnet-pat/blockbook" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">BlockBook (cashtokens fork)</a>
					{m.about_by()}
					<a href="https://x.com/mainnet_pat" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">mainnet_pat</a>
					{m.about_ack_blockbook()}
					<a href="https://github.com/trezor/blockbook" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">Trezor's BlockBook</a>
				</li>
				<li>
					<a href="https://www.coingecko.com/en" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">CoinGecko</a>
					{m.about_ack_coingecko()}
				</li>
				<li>
					<a href="https://bchn.org/" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">Bitcoin Cash Node (BCHN)</a>
					{m.about_ack_bchn_1()}
					<a href="https://www.bitcoinabc.org/" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">Bitcoin ABC</a>{m.about_ack_bchn_2()}
					<a href="https://bitcoincore.org/" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">original Bitcoin node</a>
					{m.about_ack_bchn_3()}
				</li>
				<li>
					<a href="https://bchworks.com/" target="_blank" rel="noopener noreferrer" class="text-violet-600 dark:text-violet-400 hover:underline">BCHWorks</a>
					{m.about_ack_bchworks()}
				</li>
			</ul>
		</section>

		<section class="p-6 rounded-xl border md:col-span-2 ts-border-subtle ts-surface-panel">
			<h2 class="text-xl font-bold text-slate-900 dark:text-white mb-3">{m.about_contact_h2()}</h2>
			<p class="ts-text-body">
				{m.about_contact_1()}
				<a href="mailto:hello@panmoni.com" class="text-violet-600 dark:text-violet-400 hover:underline">hello@panmoni.com</a>
				{m.about_contact_2()}
			</p>
		</section>
	</div>
</main>
