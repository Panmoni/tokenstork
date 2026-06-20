<script lang="ts">
	// Standard "ⓘ" help affordance: a circle-i icon that reveals the shared
	// green (bg-emerald-700) Tooltip on hover/focus. Use this for every little
	// help icon that explains a section or field, so they all look + behave
	// identically site-wide instead of falling back to the unstyled native
	// browser `title=` tooltip. The green styling + WCAG rationale lives in
	// ui/tooltip/tooltip-content.svelte.
	//
	// Pass `href` to ALSO make the icon a deep link (e.g. a FAQ anchor): the
	// trigger then renders as an <a> via bits-ui's `child` render-delegation,
	// so clicking navigates while hovering still shows the tooltip. Without
	// `href` the trigger is a plain button that only reveals the tooltip.
	import { Tooltip, TooltipTrigger, TooltipContent } from '$lib/components/ui/tooltip';
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';

	interface Props {
		/** Accessible label for the trigger (read by screen readers). */
		label: string;
		/** Tooltip body. Provide this or the default `children` snippet. */
		text?: string;
		/** Optional deep link — when set, the trigger renders as an <a>. */
		href?: string;
		/** Extra classes for the trigger (colour / hit-area / hover-bg). */
		class?: string;
		/** Classes for the icon itself (size / colour). Defaults to w-4 h-4. */
		iconClass?: string;
		/** Rich tooltip body as an alternative to `text`. */
		children?: Snippet;
	}

	let { label, text, href, class: className, iconClass = 'w-4 h-4', children }: Props = $props();

	// Matches the 24h-movers icon: slate by default, violet on hover.
	const triggerClass = $derived(
		cn(
			'inline-flex items-center justify-center text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors cursor-help',
			className
		)
	);
</script>

<Tooltip>
	<TooltipTrigger>
		{#snippet child({ props })}
			{#if href}
				<a {href} class={triggerClass} aria-label={label} {...props} type={undefined}>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={iconClass} aria-hidden="true">
						<circle cx="12" cy="12" r="10" />
						<line x1="12" y1="16" x2="12" y2="12" />
						<line x1="12" y1="8" x2="12.01" y2="8" />
					</svg>
				</a>
			{:else}
				<button class={triggerClass} aria-label={label} {...props}>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={iconClass} aria-hidden="true">
						<circle cx="12" cy="12" r="10" />
						<line x1="12" y1="16" x2="12" y2="12" />
						<line x1="12" y1="8" x2="12.01" y2="8" />
					</svg>
				</button>
			{/if}
		{/snippet}
	</TooltipTrigger>
	<TooltipContent>
		{#if children}{@render children()}{:else}{text}{/if}
	</TooltipContent>
</Tooltip>
