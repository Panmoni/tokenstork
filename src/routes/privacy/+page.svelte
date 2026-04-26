<script lang="ts">
	// Edit `lastUpdated` whenever processors, cookies, or data flows change —
	// not for cosmetic edits. The processor list below must match what the
	// CSP in svelte.config.js actually allows; if you add or remove a third-
	// party endpoint there, mirror the change here.
	const lastUpdated = '26 Apr 2026';

	type Section = {
		id: string;
		title: string;
		body: string;
	};

	const sections: Section[] = [
		{
			id: 'introduction',
			title: '1. Introduction',
			body: `This Privacy Policy explains what information TokenStork.com (the "website", operated by George Donnelly d/b/a Panmoni) collects when you visit, why we collect it, who we share it with, and what choices you have. We aim to collect as little personal information as possible.`
		},
		{
			id: 'what-we-collect',
			title: '2. Information We Collect',
			body: `We do not require an account to browse the website, and we do not ask for your name, address, or other directly identifying information for general use. The website does collect or process the following limited categories of data: (a) standard request metadata that any web server records (your IP address, user agent, referrer, requested URL, and timestamp), retained for a short period for operations and abuse prevention; (b) optional account data if you choose to sign in with a wallet (a public wallet address linked to a session cookie set by us); and (c) any information you voluntarily send us, for example when you email us for support.`
		},
		{
			id: 'how-we-use',
			title: '3. How We Use Information',
			body: `We use the information described above to operate, maintain, and improve the website; to keep you signed in if you log in with a wallet; to detect, investigate, and prevent abuse, fraud, and security incidents; to understand aggregate usage patterns so we can prioritise improvements; and to respond to your inquiries. We do not sell your personal information, and we do not use it for behavioural advertising.`
		},
		{
			id: 'cookies',
			title: '4. Cookies and Local Storage',
			body: `We use the minimum cookies and local-storage entries needed for the site to function: a session cookie when you sign in with a wallet, a small preference entry to remember your light/dark theme choice, and any cookies set by our hosting provider for security and load-balancing. You can clear cookies and local storage at any time through your browser; doing so will sign you out and reset your theme preference.`
		},
		{
			id: 'third-party-services',
			title: '5. Third-Party Services',
			body: `We rely on a small number of third parties to deliver the website. These currently include: (a) OVH, our hosting provider, which receives standard request metadata in order to serve pages; and (b) WalletConnect, used only on the wallet-login page to broker the connection between your wallet app and the website — see WalletConnect's own policy for details. Each provider receives only the data necessary for its function. We do not share your information with third parties for their own marketing purposes.`
		},
		{
			id: 'on-chain-data',
			title: '6. On-Chain Data',
			body: `If you sign in with a wallet, your public wallet address is stored alongside your session and may be associated with on-chain activity that is, by the nature of public blockchains, visible to anyone. We do not control and cannot remove on-chain data.`
		},
		{
			id: 'retention',
			title: '7. Data Retention',
			body: `We keep request logs and security-related data only as long as needed for the purposes described above and then delete or anonymise them. Aggregated analytics data has no fixed expiry because it is not tied to an identifiable individual. Account data tied to a wallet sign-in is kept for as long as the account is active and then deleted on request.`
		},
		{
			id: 'your-rights',
			title: '8. Your Rights',
			body: `Depending on where you live, you may have rights under laws such as the EU/UK GDPR or the California Consumer Privacy Act, including the right to access the personal information we hold about you, to request that it be corrected or deleted, to object to or restrict certain processing, and to data portability. To exercise any of these rights, contact us at hello@panmoni.com. We will respond within the timeframe required by applicable law. You also have the right to lodge a complaint with your local data-protection authority.`
		},
		{
			id: 'security',
			title: '9. Security',
			body: `We use commercially reasonable technical and organisational measures to protect the information we hold, including HTTPS in transit, a strict Content Security Policy, restricted server access, and least-privilege credentials. No system is perfectly secure, and we cannot guarantee absolute security.`
		},
		{
			id: 'international',
			title: '10. International Transfers',
			body: `The website's infrastructure may process data in countries other than the one you are accessing it from. By using the website, you understand that your information may be transferred to and processed in those countries.`
		},
		{
			id: 'changes',
			title: '11. Changes to This Policy',
			body: `We may update this Privacy Policy from time to time. When we do, we will revise the "Last Updated" date at the top of this page. Material changes will, where reasonable, be highlighted on the website for a period after the change.`
		},
		{
			id: 'contact',
			title: '12. Contact',
			body: `For privacy questions, requests, or complaints, email hello@panmoni.com.`
		}
	];
</script>

<svelte:head>
	<title>Privacy Policy — Token Stork</title>
	<meta
		name="description"
		content="Privacy Policy for TokenStork.com — what we collect, how we use it, and your rights."
	/>
	<link rel="canonical" href="https://tokenstork.com/privacy" />
</svelte:head>

<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<h1
		class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent mb-2"
	>
		Privacy Policy
	</h1>
	<p class="text-slate-500 dark:text-slate-400 mb-8">
		Last updated: {lastUpdated}. See also our <a
			href="/terms"
			class="text-violet-600 hover:underline">Terms of Service</a
		>.
	</p>

	<nav
		aria-label="Table of contents"
		class="mb-10 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900"
	>
		<h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">
			On this page
		</h2>
		<ol class="grid gap-1 sm:grid-cols-2 list-none p-0 m-0">
			{#each sections as { id, title }}
				<li>
					<a href="#{id}" class="text-violet-600 dark:text-violet-400 hover:underline">{title}</a>
				</li>
			{/each}
		</ol>
	</nav>

	<div class="prose prose-slate dark:prose-invert max-w-none">
		{#each sections as { id, title, body }}
			<section id={id} class="scroll-mt-24">
				<h2>{title}</h2>
				<p>{body}</p>
			</section>
		{/each}
	</div>
</main>
