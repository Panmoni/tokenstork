<script lang="ts">
	// Edit `lastUpdated` whenever processors, cookies, or data flows change —
	// not for cosmetic edits. The processor list below must match what the
	// CSP in svelte.config.js actually allows; if you add or remove a third-
	// party endpoint there, mirror the change here.
	const lastUpdated = '26 Apr 2026';

	// Each section's body is a list of structured blocks so the page reads as
	// a scannable document rather than a wall of text. Block kinds:
	//   p    — plain paragraph
	//   lead — bold lead-in (label) + remaining text in the same paragraph
	//   list — unordered list (rendered with disc bullets via prose styles)
	//   h3   — sub-section heading inside a numbered section
	type Block =
		| { kind: 'p'; text: string }
		| { kind: 'lead'; label: string; text: string }
		| { kind: 'list'; items: string[] }
		| { kind: 'h3'; text: string };

	type Section = {
		id: string;
		title: string;
		body: Block[];
	};

	const sections: Section[] = [
		{
			id: 'introduction',
			title: '1. Introduction',
			body: [
				{
					kind: 'p',
					text: `This Privacy Policy explains what information TokenStork.com (the "website", operated by George Donnelly d/b/a Panmoni) collects when you visit, why we collect it, who we share it with, and what choices you have.`
				},
				{
					kind: 'lead',
					label: 'Our posture:',
					text: `we aim to collect as little personal information as possible.`
				}
			]
		},
		{
			id: 'what-we-collect',
			title: '2. Information We Collect',
			body: [
				{
					kind: 'p',
					text: `We do not require an account to browse the website, and we do not ask for your name, address, or other directly identifying information for general use. The website does collect or process the following limited categories of data:`
				},
				{ kind: 'h3', text: 'Request metadata' },
				{
					kind: 'p',
					text: `Standard request metadata that any web server records — IP address, user agent, referrer, requested URL, and timestamp. Retained for a short period for operations and abuse prevention.`
				},
				{ kind: 'h3', text: 'Optional account data' },
				{
					kind: 'p',
					text: `If you choose to sign in with a wallet, we store a public wallet address linked to a session cookie set by us. No password, no email.`
				},
				{ kind: 'h3', text: 'Voluntary correspondence' },
				{
					kind: 'p',
					text: `Any information you voluntarily send us — for example, when you email us for support.`
				}
			]
		},
		{
			id: 'how-we-use',
			title: '3. How We Use Information',
			body: [
				{ kind: 'p', text: `We use the information described above to:` },
				{
					kind: 'list',
					items: [
						`Operate, maintain, and improve the website.`,
						`Keep you signed in if you log in with a wallet.`,
						`Detect, investigate, and prevent abuse, fraud, and security incidents.`,
						`Understand aggregate usage patterns so we can prioritise improvements.`,
						`Respond to your inquiries.`
					]
				},
				{
					kind: 'lead',
					label: 'What we do not do:',
					text: `we do not sell your personal information, and we do not use it for behavioural advertising.`
				}
			]
		},
		{
			id: 'cookies',
			title: '4. Cookies and Local Storage',
			body: [
				{
					kind: 'p',
					text: `We use the minimum cookies and local-storage entries needed for the site to function:`
				},
				{
					kind: 'list',
					items: [
						`A session cookie when you sign in with a wallet.`,
						`A small preference entry to remember your light/dark theme choice.`,
						`Any cookies set by our hosting provider for security and load-balancing.`
					]
				},
				{
					kind: 'p',
					text: `You can clear cookies and local storage at any time through your browser; doing so will sign you out and reset your theme preference.`
				}
			]
		},
		{
			id: 'third-party-services',
			title: '5. Third-Party Services',
			body: [
				{
					kind: 'p',
					text: `We rely on a small number of third parties to deliver the website. Each provider receives only the data necessary for its function.`
				},
				{ kind: 'h3', text: 'Current processors' },
				{
					kind: 'list',
					items: [
						`Netcup — our hosting provider (Germany), which receives standard request metadata in order to serve pages.`,
						`Cloudflare — provides our CDN + DDoS protection. CF terminates TLS at its edge and forwards requests to our origin. Cloudflare's CSAM Scanning Tool runs against every image we serve from our origin (token icons cached at /icons/<hash>.webp); known CSAM hashes are matched against NCMEC + IWF databases at the edge, and any match is auto-reported by Cloudflare per US/EU mandatory-reporting law. We never see the original bytes; we never receive a copy of the report.`,
						`Google Cloud Vision (SafeSearch) — classifies token icon images for adult content before we serve them. Each icon's bytes are sent once, classified as a single floating-point score, and discarded by Google per their SafeSearch retention policy. We send only the icon bytes — no user identifier, no IP, no session, no cookie. Google does not use the bytes to train models per their Cloud Vision data-use terms. See Google's Cloud Vision privacy notice.`,
						`WalletConnect — used only on the wallet-login page to broker the connection between your wallet app and the website. See WalletConnect's own policy for details.`
					]
				},
				{
					kind: 'p',
					text: `We do not share your information with third parties for their own marketing purposes.`
				}
			]
		},
		{
			id: 'on-chain-data',
			title: '6. On-Chain Data',
			body: [
				{
					kind: 'p',
					text: `If you sign in with a wallet, your public wallet address is stored alongside your session and may be associated with on-chain activity that is, by the nature of public blockchains, visible to anyone.`
				},
				{
					kind: 'lead',
					label: 'Important:',
					text: `we do not control and cannot remove on-chain data.`
				}
			]
		},
		{
			id: 'retention',
			title: '7. Data Retention',
			body: [
				{
					kind: 'p',
					text: `We keep request logs and security-related data only as long as needed for the purposes described above and then delete or anonymise them.`
				},
				{
					kind: 'p',
					text: `Aggregated analytics data has no fixed expiry because it is not tied to an identifiable individual.`
				},
				{
					kind: 'p',
					text: `Account data tied to a wallet sign-in is kept for as long as the account is active and then deleted on request.`
				}
			]
		},
		{
			id: 'your-rights',
			title: '8. Your Rights',
			body: [
				{
					kind: 'p',
					text: `Depending on where you live, you may have rights under laws such as the EU/UK GDPR or the California Consumer Privacy Act, including:`
				},
				{
					kind: 'list',
					items: [
						`Access — the right to see the personal information we hold about you.`,
						`Correction or deletion — the right to have it corrected or deleted.`,
						`Restriction or objection — the right to restrict or object to certain processing.`,
						`Portability — the right to receive your data in a portable format.`
					]
				},
				{
					kind: 'p',
					text: `To exercise any of these rights, contact us at hello@panmoni.com. We will respond within the timeframe required by applicable law. You also have the right to lodge a complaint with your local data-protection authority.`
				}
			]
		},
		{
			id: 'security',
			title: '9. Security',
			body: [
				{
					kind: 'p',
					text: `We use commercially reasonable technical and organisational measures to protect the information we hold:`
				},
				{
					kind: 'list',
					items: [
						`HTTPS in transit.`,
						`A strict Content Security Policy.`,
						`Restricted server access.`,
						`Least-privilege credentials.`
					]
				},
				{
					kind: 'p',
					text: `No system is perfectly secure, and we cannot guarantee absolute security.`
				}
			]
		},
		{
			id: 'international',
			title: '10. International Transfers',
			body: [
				{
					kind: 'p',
					text: `The website's infrastructure may process data in countries other than the one you are accessing it from. By using the website, you understand that your information may be transferred to and processed in those countries.`
				}
			]
		},
		{
			id: 'changes',
			title: '11. Changes to This Policy',
			body: [
				{
					kind: 'p',
					text: `We may update this Privacy Policy from time to time. When we do, we will revise the "Last Updated" date at the top of this page. Material changes will, where reasonable, be highlighted on the website for a period after the change.`
				}
			]
		},
		{
			id: 'contact',
			title: '12. Contact',
			body: [
				{
					kind: 'p',
					text: `For privacy questions, requests, or complaints, email hello@panmoni.com.`
				}
			]
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
				{#each body as block}
					{#if block.kind === 'p'}
						<p>{block.text}</p>
					{:else if block.kind === 'lead'}
						<p><strong>{block.label}</strong> {block.text}</p>
					{:else if block.kind === 'h3'}
						<h3>{block.text}</h3>
					{:else if block.kind === 'list'}
						<ul>
							{#each block.items as item}
								<li>{item}</li>
							{/each}
						</ul>
					{/if}
				{/each}
			</section>
		{/each}
	</div>
</main>
