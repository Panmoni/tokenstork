<script lang="ts">
	// Minimal SVG sparkline. Takes an array of numeric points (oldest-first)
	// and renders a polyline into a fixed viewport. Color tracks trend —
	// emerald if end > start, rose if end < start, slate if flat or empty.
	//
	// The line is rendered via a pure `points` polyline, not path+curve —
	// we want the honest shape, not a smoothed interpretation of it.

	interface Props {
		points: number[];
		width?: number;
		height?: number;
	}

	let { points, width = 96, height = 28 }: Props = $props();

	// Accept >= 0, not > 0: zero is a legitimate price point (dead-token
	// scenario) that should show in the trend, not be silently dropped
	// and visually hidden behind an interpolated segment.
	const valid = $derived(points.filter((n) => Number.isFinite(n) && n >= 0));

	const trend = $derived(
		valid.length < 2 ? 'flat' : valid[valid.length - 1] > valid[0] ? 'up' : valid[valid.length - 1] < valid[0] ? 'down' : 'flat'
	);

	// Trend summary for screen readers. The line is aria-hidden (it's a
	// chart, not text), but the <title> gives the same signal.
	const pctChange = $derived.by(() => {
		if (valid.length < 2) return null;
		const first = valid[0];
		const last = valid[valid.length - 1];
		if (first === 0) return null;
		return ((last - first) / first) * 100;
	});
	const titleText = $derived.by(() => {
		if (pctChange === null) return 'Sparkline unavailable';
		const sign = pctChange > 0 ? '+' : '';
		return `7-day price change: ${sign}${pctChange.toFixed(2)}%`;
	});

	// Map points into viewport coordinates. y is inverted (SVG origin
	// top-left). `pad` keeps the line off the bounding box edges so the
	// stroke isn't clipped.
	const pathPoints = $derived.by(() => {
		if (valid.length < 2) return '';
		const pad = 2;
		const min = Math.min(...valid);
		const max = Math.max(...valid);
		const range = max - min || 1;
		const xStep = (width - pad * 2) / (valid.length - 1);
		return valid
			.map((v, i) => {
				const x = pad + i * xStep;
				const y = pad + (height - pad * 2) * (1 - (v - min) / range);
				return `${x.toFixed(2)},${y.toFixed(2)}`;
			})
			.join(' ');
	});

	const strokeClass = $derived(
		trend === 'up'
			? 'stroke-emerald-500 dark:stroke-emerald-400'
			: trend === 'down'
				? 'stroke-rose-500 dark:stroke-rose-400'
				: 'stroke-slate-400 dark:stroke-slate-500'
	);
</script>

{#if valid.length >= 2}
	<svg
		{width}
		{height}
		viewBox={`0 0 ${width} ${height}`}
		class="inline-block"
		role="img"
		aria-label={titleText}
	>
		<title>{titleText}</title>
		<polyline
			class={strokeClass}
			points={pathPoints}
			fill="none"
			stroke-width="1.5"
			stroke-linejoin="round"
			stroke-linecap="round"
		/>
	</svg>
{:else}
	<span class="text-slate-300 dark:text-slate-600 text-xs">—</span>
{/if}
