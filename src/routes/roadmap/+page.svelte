<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	// Roadmap items. `status` drives the icon + color. Last groomed 2026-06-20 —
	// the "Shipped" section was retired; this page now lists only forward-looking
	// work. If anything drifts by more than a quarter, come back and groom. The
	// original roadmap had a version-number scheme (0.0.3, 0.0.4, …) that turned
	// out to be ambitious vaporware; we now group by theme + status.
	//
	// Titles + bullets are i18n message functions (rm_* keys). When grooming,
	// edit the en/es catalogs and the key lists below in lockstep.
	interface Item {
		title: string;
		status: 'planned' | 'later';
		bullets: string[];
	}

	const planned = $derived<Item[]>([
		{
			title: m.rm_p1_title(),
			status: 'planned',
			bullets: [m.rm_p1_b1(), m.rm_p1_b2(), m.rm_p1_b3()]
		},
		{
			title: m.rm_p2_title(),
			status: 'planned',
			bullets: [m.rm_p2_b1(), m.rm_p2_b2(), m.rm_p2_b3(), m.rm_p2_b4()]
		},
		{
			title: m.rm_p3_title(),
			status: 'planned',
			bullets: [m.rm_p3_b1(), m.rm_p3_b2()]
		},
		{
			title: m.rm_p4_title(),
			status: 'planned',
			bullets: [m.rm_p4_b1(), m.rm_p4_b2(), m.rm_p4_b3()]
		}
	]);

	const later = $derived<Item[]>([
		{
			title: m.rm_l1_title(),
			status: 'later',
			bullets: [m.rm_l1_b1(), m.rm_l1_b2(), m.rm_l1_b3()]
		},
		{
			title: m.rm_l2_title(),
			status: 'later',
			bullets: [m.rm_l2_b1(), m.rm_l2_b2(), m.rm_l2_b3(), m.rm_l2_b4()]
		},
		{
			title: m.rm_l3_title(),
			status: 'later',
			bullets: [m.rm_l3_b1(), m.rm_l3_b2(), m.rm_l3_b3()]
		},
		{
			title: m.rm_l4_title(),
			status: 'later',
			bullets: [m.rm_l4_b1(), m.rm_l4_b2(), m.rm_l4_b3()]
		},
		{
			title: m.rm_l5_title(),
			status: 'later',
			bullets: [m.rm_l5_b1(), m.rm_l5_b2(), m.rm_l5_b3(), m.rm_l5_b4()]
		},
		{
			title: m.rm_l6_title(),
			status: 'later',
			bullets: [m.rm_l6_b1(), m.rm_l6_b2(), m.rm_l6_b3(), m.rm_l6_b4(), m.rm_l6_b5()]
		},
		{
			title: m.rm_l7_title(),
			status: 'later',
			bullets: [m.rm_l7_b1(), m.rm_l7_b2(), m.rm_l7_b3()]
		}
	]);
</script>

<svelte:head>
	<title>{m.roadmap_meta_title()}</title>
	<meta
		name="description"
		content={m.roadmap_meta_description()}
	/>
</svelte:head>

<main class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent mb-4">
		{m.roadmap_h1()}
	</h1>
	<p class="mb-10 ts-text-muted">
		{m.roadmap_intro()}
	</p>

	<section class="mb-12">
		<h2 class="text-2xl font-bold text-amber-600 dark:text-amber-400 mb-6 flex items-center gap-2">
			<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<circle cx="12" cy="12" r="10" />
				<polyline points="12 6 12 12 16 14" />
			</svg>
			{m.roadmap_planned_h()}
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
			{m.roadmap_later_h()}
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
		{m.roadmap_footer_1()} <a href="mailto:hello@panmoni.com" class="text-violet-600 dark:text-violet-400 hover:underline">hello@panmoni.com</a>
		{m.roadmap_footer_or()}
		<a
			href="https://github.com/Panmoni/tokenstork/issues"
			target="_blank"
			rel="noopener noreferrer"
			class="text-violet-600 dark:text-violet-400 hover:underline"
		>{m.roadmap_footer_issue()}</a>.
	</p>
</main>
