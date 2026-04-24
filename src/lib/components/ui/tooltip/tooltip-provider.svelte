<script lang="ts">
	// Mount one <TooltipProvider> high in the tree (typically +layout.svelte)
	// and all Tooltip instances inside it share the delay + close-on-escape
	// plumbing. Passes delayDuration through; default 200 ms matches the
	// shadcn-svelte convention.
	import { Tooltip as TooltipPrimitive } from 'bits-ui';
	let {
		delayDuration = 200,
		...restProps
	}: TooltipPrimitive.ProviderProps = $props();
</script>

<TooltipPrimitive.Provider {delayDuration} {...restProps} />
