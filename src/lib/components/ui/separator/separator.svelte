<script lang="ts">
	import { Separator as SeparatorPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils';

	type Props = SeparatorPrimitive.RootProps & {
		orientation?: 'horizontal' | 'vertical';
	};

	let {
		class: className,
		orientation = 'horizontal',
		decorative = true,
		...rest
	}: Props = $props();
</script>

<SeparatorPrimitive.Root
	{decorative}
	{orientation}
	class={cn(
		'shrink-0 bg-border',
		orientation === 'horizontal' ? 'h-px w-full' : 'w-px h-full',
		className
	)}
	{...rest}
/>
