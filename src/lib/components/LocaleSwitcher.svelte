<script lang="ts">
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import { locales, getLocale, localizeHref, deLocalizeHref } from '$lib/paraglide/runtime';

	// Each locale's name rendered in its OWN language (autonym) — "English",
	// "Español", "Deutsch" — so a visitor recognizes their language without
	// reading the current UI language. Falls back to the raw code if the
	// runtime can't resolve a display name.
	function displayName(locale: string): string {
		try {
			return new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale;
		} catch {
			return locale;
		}
	}

	const current = $derived(getLocale());

	// Build a switch link per locale that keeps the visitor on the same page.
	// De-localize first so an already-prefixed path (e.g. /es/about) doesn't
	// get double-prefixed. `data-sveltekit-reload` forces a full server round
	// trip so the locale cookie + SSR'd content update together.
	const options = $derived(
		locales.map((locale) => ({
			locale,
			label: displayName(locale),
			href: localizeHref(deLocalizeHref(page.url.pathname), { locale }),
			active: locale === current
		}))
	);

	let open = $state(false);
	let el: HTMLDivElement | undefined = $state();

	function onWindowClick(e: MouseEvent) {
		if (open && el && !el.contains(e.target as Node)) open = false;
	}
	function onWindowKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') open = false;
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={onWindowKeydown} />

<div class="relative" bind:this={el}>
	<button
		type="button"
		onclick={() => (open = !open)}
		class="inline-flex items-center gap-1.5 text-sm font-medium hover:text-violet-600 dark:hover:text-violet-400 transition-colors ts-text-body"
		aria-haspopup="menu"
		aria-expanded={open}
		aria-label={m.locale_switcher_label()}
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			class="w-4 h-4"
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="9" />
			<path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
		</svg>
		<span>{displayName(current)}</span>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 20 20"
			fill="currentColor"
			class="w-3.5 h-3.5 transition-transform {open ? 'rotate-180' : ''}"
			aria-hidden="true"
		>
			<path
				fill-rule="evenodd"
				d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
				clip-rule="evenodd"
			/>
		</svg>
	</button>

	{#if open}
		<div
			class="absolute right-0 bottom-full mb-2 max-h-72 w-44 overflow-y-auto rounded-lg border py-1 shadow-lg z-50 ts-border-subtle ts-surface-panel"
			role="menu"
		>
			{#each options as opt (opt.locale)}
				<a
					href={opt.href}
					data-sveltekit-reload
					role="menuitem"
					hreflang={opt.locale}
					class="block px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-zinc-800 {opt.active
						? 'text-violet-600 dark:text-violet-400 font-semibold'
						: 'ts-text-body'}"
				>
					{opt.label}
				</a>
			{/each}
		</div>
	{/if}
</div>
