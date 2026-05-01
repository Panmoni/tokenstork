<script lang="ts">
	// CRC-20 badge. Renders a small amber pill for canonical winners and a
	// muted slate pill for non-canonical contenders that lost the per-symbol
	// canonical sort. Tooltip explains the meaning. See docs/crc20-plan.md
	// for the protocol-level "canonical winner" concept.

	interface Props {
		isCanonical: boolean;
		symbol: string | null;
		symbolIsHex: boolean;
		size?: 'xs' | 'sm';
	}

	let { isCanonical, symbol, symbolIsHex, size = 'xs' }: Props = $props();

	// The badge label itself is fixed ("CRC-20" + optional "·n.c."), so
	// the full symbol — which can be up to ~75 bytes — only appears in
	// the title-attribute tooltip where browser-native truncation /
	// wrapping handles overflow. The detail-page card renders the raw
	// symbol with `break-all` for the same reason.
	const display = $derived(symbol && symbol.length > 0 ? symbol : '—');

	const tooltip = $derived(
		isCanonical
			? `CRC-20 — owns the symbol "${display}" on-chain via covenant${symbolIsHex ? ' (raw bytes; non-UTF-8)' : ''}`
			: `CRC-20 — also claims "${display}" but lost the canonical sort to an earlier genesis`
	);

	const sizeClass = $derived(
		size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-0.5 text-[10px]'
	);

	const colorClass = $derived(
		isCanonical
			? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 ring-1 ring-amber-300/50 dark:ring-amber-700/40'
			: 'bg-slate-100 text-slate-500 dark:bg-zinc-800 dark:text-zinc-300 ring-1 ring-slate-300/50 dark:ring-zinc-700/40'
	);
</script>

<span
	class={`inline-flex items-center gap-1 rounded font-semibold ${sizeClass} ${colorClass}`}
	title={tooltip}
>
	{#if isCanonical}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 20 20"
			fill="currentColor"
			class="w-3 h-3"
			aria-hidden="true"
		>
			<path
				fill-rule="evenodd"
				d="M10 1.5l7 3v5c0 4.5-3 8.4-7 9-4-0.6-7-4.5-7-9v-5l7-3zm0 4.2l-3.2 3.2-1.3-1.3-1.4 1.4 2.7 2.7 4.6-4.6-1.4-1.4z"
				clip-rule="evenodd"
			/>
		</svg>
	{/if}
	CRC-20{#if !isCanonical}<span class="opacity-60">·n.c.</span>{/if}
</span>
