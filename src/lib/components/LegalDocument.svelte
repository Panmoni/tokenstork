<script lang="ts">
	import type { Section } from '$lib/legalDocument';

	interface Props {
		title: string;
		lastUpdated: string;
		// Cross-link shown in the sub-header (Terms → Privacy, Privacy → Terms).
		related: { label: string; href: string };
		sections: Section[];
	}

	let { title, lastUpdated, related, sections }: Props = $props();
</script>

<main class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<h1
		class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent mb-2"
	>
		{title}
	</h1>
	<p class="mb-8 ts-text-muted">
		Last updated: {lastUpdated}. See also our <a
			href={related.href}
			class="text-violet-600 dark:text-violet-400 hover:underline">{related.label}</a
		>.
	</p>

	<nav
		aria-label="Table of contents"
		class="mb-12 p-4 rounded-xl border ts-border-subtle ts-surface-soft"
	>
		<h2 class="text-sm font-semibold uppercase tracking-wide mb-3 ts-text-muted">On this page</h2>
		<ol class="grid gap-x-6 gap-y-1 sm:grid-cols-2 list-none p-0 m-0">
			{#each sections as { id, title }}
				<li>
					<a
						href="#{id}"
						class="block py-0.5 text-violet-600 dark:text-violet-400 hover:underline"
						>{title}</a
					>
				</li>
			{/each}
		</ol>
	</nav>

	<!-- Each numbered section is separated by a top rule + generous spacing so
	     the document scans as discrete sections rather than one block of text.
	     `prose` is intentionally absent — @tailwindcss/typography is not part of
	     the build, so all body styling is explicit utilities + ts-* tokens (same
	     pattern as the About page). -->
	<div class="ts-text-body">
		{#each sections as { id, title, body }}
			<section
				{id}
				class="scroll-mt-24 border-t ts-border-subtle pt-10 mt-10 first:border-t-0 first:pt-0 first:mt-0"
			>
				<h2 class="text-2xl font-bold ts-text-primary mb-5">{title}</h2>
				<div class="space-y-5">
					{#each body as block}
						{#if block.kind === 'p'}
							<p class="leading-[1.75]">{block.text}</p>
						{:else if block.kind === 'lead'}
							<p class="leading-[1.75]">
								<strong class="font-semibold ts-text-primary">{block.label}</strong>
								{block.text}
							</p>
						{:else if block.kind === 'h3'}
							<h3 class="text-sm font-semibold uppercase tracking-wide ts-text-strong pt-2">
								{block.text}
							</h3>
						{:else if block.kind === 'list'}
							<ul
								class="list-disc pl-6 space-y-2.5 marker:text-violet-500 dark:marker:text-violet-400"
							>
								{#each block.items as item}
									<li class="leading-[1.75] pl-1">{item}</li>
								{/each}
							</ul>
						{/if}
					{/each}
				</div>
			</section>
		{/each}
	</div>
</main>
