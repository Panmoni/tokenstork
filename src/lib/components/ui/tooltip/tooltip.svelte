<script lang="ts">
	// Root wrapper around bits-ui's Tooltip.Root. Keeps delay + open-state
	// wiring consistent across usages. Pair with <TooltipProvider> higher
	// in the tree if you want shared delays across many tooltips.
	import { Tooltip as TooltipPrimitive } from 'bits-ui';
	let { ...restProps }: TooltipPrimitive.RootProps = $props();
</script>

<TooltipPrimitive.Root {...restProps} />
