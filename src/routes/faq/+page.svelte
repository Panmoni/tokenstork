<script lang="ts">
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';

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

	// Each Q&A is a native <details> (JS-free accordion, keyboard-accessible).
	// `q`/`a` are i18n message functions (faq_q*/faq_a*); their HTML is rendered
	// with {@html} so inline links/code/badges survive translation. `id` (when
	// set) keeps the deep-link anchors other pages target; `wide` => space-y-3.
	const faqs: { id?: string; wide?: boolean; q: () => string; a: () => string }[] = [
		{ q: m.faq_q1, a: m.faq_a1 },
		{ q: m.faq_q2, a: m.faq_a2 },
		{ id: 'faq-crc20-vs-bcmr', wide: true, q: m.faq_q3, a: m.faq_a3 },
		{ id: 'faq-ft-nft', wide: true, q: m.faq_q4, a: m.faq_a4 },
		{ q: m.faq_q5, a: m.faq_a5 },
		{ q: m.faq_q6, a: m.faq_a6 },
		{ q: m.faq_q7, a: m.faq_a7 },
		{ q: m.faq_q8, a: m.faq_a8 },
		{ q: m.faq_q9, a: m.faq_a9 },
		{ q: m.faq_q10, a: m.faq_a10 },
		{ id: 'faq-mcap-hidden', q: m.faq_q11, a: m.faq_a11 },
		{ q: m.faq_q12, a: m.faq_a12 },
		{ id: 'faq-emoji', q: m.faq_q13, a: m.faq_a13 },
		{ id: 'faq-icons', q: m.faq_q14, a: m.faq_a14 },
		{ id: 'faq-tvl', q: m.faq_q15, a: m.faq_a15 },
		{ id: 'faq-txs-24h', q: m.faq_q16, a: m.faq_a16 },
		{ id: 'faq-bcmr-publish', q: m.faq_q17, a: m.faq_a17 },
		{ q: m.faq_q18, a: m.faq_a18 },
		{ id: 'faq-vote-ranking', wide: true, q: m.faq_q19, a: m.faq_a19 },
		{ id: 'faq-airdrops', q: m.faq_q20, a: m.faq_a20 },
		{ q: m.faq_q21, a: m.faq_a21 }
	];
</script>

<svelte:head>
	<title>{m.faq_meta_title()}</title>
	<meta
		name="description"
		content={m.faq_meta_description()}
	/>
</svelte:head>

<main class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent mb-6">
		{m.faq_h1()}
	</h1>
	<p class="mb-10 ts-text-muted">
		{m.faq_intro_1()}
		<a href="mailto:hello@panmoni.com" class="text-violet-600 dark:text-violet-400 hover:underline">hello@panmoni.com</a>
		{m.faq_intro_2()}
	</p>

	<div class="space-y-3">
		{#each faqs as item (item.q)}
			<details
				id={item.id}
				class="group p-5 rounded-xl border {item.id ? 'scroll-mt-20 ' : ''}ts-border-subtle ts-surface-panel"
			>
				<summary class="cursor-pointer text-lg font-semibold text-slate-900 dark:text-white flex items-center justify-between gap-4 list-none">
					<span>{@html item.q()}</span>
					<span class="text-violet-500 group-open:rotate-45 transition-transform select-none">+</span>
				</summary>
				<div class="mt-3 {item.wide ? 'space-y-3' : 'space-y-2'} ts-text-body">{@html item.a()}</div>
			</details>
		{/each}
	</div>

	<p class="text-sm mt-10 ts-text-muted">
		{m.faq_footer_1()}
		<a href="mailto:hello@panmoni.com" class="text-violet-600 dark:text-violet-400 hover:underline">hello@panmoni.com</a>
		{m.faq_footer_2()}
	</p>
</main>
