<script lang="ts">
	import { Tooltip as TooltipPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils';

	let {
		class: className,
		sideOffset = 4,
		children,
		ref = $bindable(null),
		...restProps
	}: TooltipPrimitive.ContentProps = $props();
</script>

<TooltipPrimitive.Portal>
	<TooltipPrimitive.Content
		bind:ref
		{sideOffset}
		class={cn(
			// Uses emerald-700 — same brand-coded BCH teal family as the
			// CTA banner's bg-accent (#0ac18e), but darker so white text
			// meets WCAG AA for small text. emerald-700 (#047857) with
			// white is ~5.26:1, comfortably over the 4.5:1 AA bar; the
			// lighter bg-accent was ~2.4:1 and failed.
			'z-50 overflow-hidden rounded-md bg-emerald-700 dark:bg-emerald-600 px-3 py-1.5 text-xs text-white shadow-md',
			'animate-in fade-in-0 zoom-in-95',
			'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
			'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
			'max-w-xs leading-snug',
			className
		)}
		{...restProps}
	>
		{@render children?.()}
	</TooltipPrimitive.Content>
</TooltipPrimitive.Portal>
