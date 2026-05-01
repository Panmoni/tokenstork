<script lang="ts">
	// Edit `lastUpdated` whenever the substantive terms change. Anchor IDs are
	// part of the public URL contract — external links (and the /tos legacy
	// redirect) depend on them, so don't rename without updating callers.
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
					text: `Welcome to TokenStork.com (the "website"). These Terms of Service ("Terms") govern your access to and use of the website, which is operated by George Donnelly, doing business as Panmoni ("we", "us", "our").`
				},
				{
					kind: 'p',
					text: `By accessing or using the website, you agree to be bound by these Terms. If you do not agree, do not use the website.`
				}
			]
		},
		{
			id: 'eligibility',
			title: '2. Eligibility',
			body: [
				{
					kind: 'p',
					text: `You must be at least 18 years old to access or use the website. By agreeing to these Terms, you represent and warrant that you are at least 18 years old and have the legal capacity to enter into these Terms in your jurisdiction.`
				},
				{
					kind: 'p',
					text: `The website is not directed at children under 18, and we do not knowingly collect information from them.`
				}
			]
		},
		{
			id: 'no-advice',
			title: '3. No Financial, Investment, Tax or Legal Advice',
			body: [
				{
					kind: 'lead',
					label: 'Informational only.',
					text: `The content on this website is provided for informational purposes only and does not constitute financial, investment, tax, or legal advice, nor a recommendation, offer, or solicitation to buy, sell, or hold any token or other asset.`
				},
				{
					kind: 'p',
					text: `We are not your broker, dealer, financial advisor, or fiduciary, and no such relationship is created by your use of the website.`
				},
				{ kind: 'h3', text: 'Risks you accept by participating' },
				{
					kind: 'list',
					items: [
						`Total loss of principal`,
						`Illiquidity — you may not be able to exit a position when you want to`,
						`Regulatory uncertainty in your jurisdiction`,
						`Smart-contract failure or exploit`,
						`Extreme price volatility`
					]
				},
				{
					kind: 'p',
					text: `You are solely responsible for evaluating the merits and risks of any decision you make. Do your own research and consult qualified professionals before acting.`
				}
			]
		},
		{
			id: 'website-content',
			title: '4. Website Content and Accuracy',
			body: [
				{
					kind: 'p',
					text: `We aggregate and display on-chain data and metadata from the Bitcoin Cash CashTokens ecosystem and from third-party sources. While we make reasonable efforts to surface accurate information, we do not guarantee the accuracy, completeness, timeliness, or suitability of any data on the website.`
				},
				{
					kind: 'p',
					text: `We may modify, suspend, or remove content at any time without notice. Mention of any token, project, service, or organization is not an endorsement.`
				}
			]
		},
		{
			id: 'intellectual-property',
			title: '5. Intellectual Property',
			body: [
				{
					kind: 'p',
					text: `The TokenStork name, logo, and other brand assets are the exclusive property of Panmoni or its licensors.`
				},
				{
					kind: 'p',
					text: `The website's source code is published under its open-source license; review the repository on GitHub for the applicable terms. Other content on the website may not be reproduced, distributed, or used to create derivative works for commercial purposes without our prior written permission.`
				}
			]
		},
		{
			id: 'acceptable-use',
			title: '6. Acceptable Use',
			body: [
				{ kind: 'p', text: `You agree not to:` },
				{
					kind: 'list',
					items: [
						`Scrape, harvest, or systematically retrieve data from the website except via documented public endpoints and within reasonable rate limits.`,
						`Interfere with or disrupt the website, its servers, or its networks.`,
						`Attempt to gain unauthorized access to any part of the website or its underlying systems.`,
						`Use the website to transmit malware, phishing payloads, or other malicious content.`,
						`Use the website in violation of any applicable law.`
					]
				}
			]
		},
		{
			id: 'third-party-links',
			title: '7. Third-Party Links and Services',
			body: [
				{
					kind: 'p',
					text: `The website may link to or integrate with third-party content, websites, wallets, dapps, and services. We do not control and are not responsible for any third-party content or service.`
				},
				{
					kind: 'p',
					text: `Your interactions with third parties (including any transactions you initiate) are solely between you and that third party.`
				}
			]
		},
		{
			id: 'disclaimer',
			title: '8. Disclaimer of Warranties',
			body: [
				{
					kind: 'lead',
					label: 'As-is, as-available.',
					text: `The website and its content are provided on an "as is" and "as available" basis without warranties of any kind, whether express, implied, or statutory.`
				},
				{
					kind: 'p',
					text: `This includes, without limitation, warranties of merchantability, fitness for a particular purpose, non-infringement, accuracy, or uninterrupted access, to the fullest extent permitted by applicable law.`
				}
			]
		},
		{
			id: 'liability',
			title: '9. Limitation of Liability',
			body: [
				{
					kind: 'p',
					text: `To the maximum extent permitted by law, in no event shall Panmoni, its affiliates, owners, employees, agents, or licensors be liable for any indirect, incidental, special, consequential, exemplary, or punitive damages.`
				},
				{
					kind: 'p',
					text: `This includes any loss of profits, revenue, data, or use, arising out of or relating to your use of the website, whether based in contract, tort, strict liability, or any other legal theory, even if we have been advised of the possibility of such damages.`
				}
			]
		},
		{
			id: 'indemnification',
			title: '10. Indemnification',
			body: [
				{
					kind: 'p',
					text: `You agree to indemnify, defend, and hold harmless Panmoni and its affiliates, officers, employees, and agents from and against any claims, damages, losses, liabilities, and expenses (including reasonable legal fees) arising out of or related to:`
				},
				{
					kind: 'list',
					items: [
						`Your use of the website.`,
						`Your violation of these Terms.`,
						`Your violation of any rights of another party.`
					]
				}
			]
		},
		{
			id: 'termination',
			title: '11. Termination',
			body: [
				{
					kind: 'p',
					text: `We may suspend or terminate your access to the website at any time, with or without notice, including for any conduct that we believe violates these Terms or is otherwise harmful to other users, to us, or to third parties.`
				},
				{
					kind: 'p',
					text: `Sections that by their nature should survive termination — including intellectual property, disclaimers, limitations of liability, and indemnification — will survive.`
				}
			]
		},
		{
			id: 'changes',
			title: '12. Changes to These Terms',
			body: [
				{
					kind: 'p',
					text: `We may update these Terms from time to time. When we do, we will revise the "Last Updated" date at the top of this page. Material changes will, where reasonable, be highlighted on the website for a period after the change.`
				},
				{
					kind: 'p',
					text: `Your continued use of the website after a change takes effect constitutes acceptance of the updated Terms.`
				}
			]
		},
		{
			id: 'governing-law',
			title: '13. Governing Law and Disputes',
			body: [
				{
					kind: 'p',
					text: `These Terms are governed by the laws of the Hong Kong Special Administrative Region, without regard to conflict-of-laws principles.`
				},
				{
					kind: 'p',
					text: `Any dispute arising out of or relating to these Terms or your use of the website shall be resolved exclusively in the courts of Hong Kong, and you consent to the personal jurisdiction of those courts.`
				},
				{
					kind: 'lead',
					label: 'Consumer carve-out.',
					text: `Nothing in this section limits any non-waivable consumer-protection rights you may have under the mandatory laws of your country of residence.`
				}
			]
		},
		{
			id: 'miscellaneous',
			title: '14. Miscellaneous',
			body: [
				{
					kind: 'list',
					items: [
						`Severability — if any provision of these Terms is held unenforceable, the remaining provisions will remain in full force and effect.`,
						`No waiver — our failure to enforce any provision is not a waiver of that provision.`,
						`Assignment — you may not assign these Terms without our prior written consent; we may assign them freely.`,
						`Entire agreement — these Terms, together with the Privacy Policy, constitute the entire agreement between you and us regarding the website.`
					]
				}
			]
		},
		{
			id: 'contact',
			title: '15. Contact',
			body: [
				{
					kind: 'p',
					text: `Questions about these Terms can be sent to hello@panmoni.com.`
				}
			]
		}
	];
</script>

<svelte:head>
	<title>Terms of Service — Token Stork</title>
	<meta
		name="description"
		content="Terms of Service for TokenStork.com — the rules that govern your use of the site."
	/>
	<link rel="canonical" href="https://tokenstork.com/terms" />
</svelte:head>

<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<h1
		class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent mb-2"
	>
		Terms of Service
	</h1>
	<p class="text-slate-500 dark:text-zinc-300 mb-8">
		Last updated: {lastUpdated}. See also our <a
			href="/privacy"
			class="text-violet-600 hover:underline">Privacy Policy</a
		>.
	</p>

	<nav
		aria-label="Table of contents"
		class="mb-10 p-4 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900"
	>
		<h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-zinc-300 mb-3">
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
