<script lang="ts">
	// Native-SVG line chart + volume bars for the token detail page.
	// Two stacked panes inside one viewBox: price line on top (~70% of
	// the height), volume bars on bottom (~25%, separated by a divider).
	//
	// Inputs:
	//   - `buckets`: server-side time-bucketed series, oldest first.
	//   - `decimals`: token decimals; used to derive USD per displayable
	//     unit from the raw `priceSats` (sats per smallest token unit).
	//   - `bchPriceUSD`: BCH/USD spot for converting both price and
	//     volume from sats → USD.
	//
	// Empty-state: when fewer than 2 points are available, render a
	// "Not enough history yet" message instead of a flat-line chart.
	// Two points is the minimum to draw a line segment + a single
	// volume bar.

	export interface PriceBucket {
		/** Bucket-start in unix seconds. */
		ts: number;
		/** Mean price across the bucket (sats per smallest token unit), or
		 *  null if no rows landed in this bucket. */
		priceSats: number | null;
		/** Sum of |TVL deltas| within the bucket, in sats. Lower bound on
		 *  actual swap volume — between snapshots TVL can oscillate and
		 *  we'd miss the round-trip. Null when the bucket has zero
		 *  observable change. */
		volumeSats: number | null;
	}

	interface Props {
		buckets: PriceBucket[];
		decimals: number;
		bchPriceUSD: number;
		/** Display label for the active range (e.g., "24h"). Shown in the
		 *  hover tooltip's bucket-size context. */
		rangeLabel: string;
	}

	let { buckets, decimals, bchPriceUSD, rangeLabel }: Props = $props();

	// SVG canvas dimensions. The chart is responsive via viewBox + 100%
	// width on the parent; this is the internal coordinate system.
	const W = 800;
	const H = 280;
	const PAD_L = 56;
	const PAD_R = 12;
	const PAD_T = 12;
	const PAD_B = 24;
	const DIVIDER_Y = Math.round(H * 0.7);

	const PRICE_PANE_TOP = PAD_T;
	const PRICE_PANE_BOTTOM = DIVIDER_Y - 8;
	const VOLUME_PANE_TOP = DIVIDER_Y + 8;
	const VOLUME_PANE_BOTTOM = H - PAD_B;

	// USD per displayable token unit. Same formula as elsewhere in the
	// site: priceSats * 10^decimals / 1e8 → BCH per displayable unit;
	// × bchPriceUSD → USD per displayable unit. Returns null when any
	// component is missing.
	function priceSatsToUSD(priceSats: number | null): number | null {
		if (priceSats == null || priceSats <= 0 || bchPriceUSD <= 0) return null;
		return (priceSats * Math.pow(10, decimals) / 1e8) * bchPriceUSD;
	}

	// Sats → BCH-side USD. For volume, the sats are already BCH-side
	// (TVL deltas in sats), so just sat→BCH→USD without the decimals
	// scale-up.
	function satsToUSD(sats: number | null): number {
		if (sats == null || sats <= 0 || bchPriceUSD <= 0) return 0;
		return (sats / 1e8) * bchPriceUSD;
	}

	const validPoints = $derived(
		buckets
			.map((b) => ({
				ts: b.ts,
				price: priceSatsToUSD(b.priceSats),
				volume: satsToUSD(b.volumeSats)
			}))
			.filter((p) => p.price !== null) as Array<{ ts: number; price: number; volume: number }>
	);

	const hasPoints = $derived(validPoints.length >= 2);

	const xMin = $derived(validPoints.length > 0 ? validPoints[0].ts : 0);
	const xMax = $derived(
		validPoints.length > 0 ? validPoints[validPoints.length - 1].ts : 1
	);
	const xRange = $derived(Math.max(xMax - xMin, 1));

	const priceMin = $derived(
		validPoints.length > 0 ? Math.min(...validPoints.map((p) => p.price)) : 0
	);
	const priceMax = $derived(
		validPoints.length > 0 ? Math.max(...validPoints.map((p) => p.price)) : 1
	);
	// 5% headroom top + bottom so the line doesn't kiss the pane edges.
	const priceRange = $derived(Math.max(priceMax - priceMin, priceMax * 0.05, 1e-12));
	const priceLowerBound = $derived(priceMin - priceRange * 0.05);
	const priceUpperBound = $derived(priceMax + priceRange * 0.05);

	const volumeMax = $derived(
		validPoints.length > 0 ? Math.max(...validPoints.map((p) => p.volume), 1e-9) : 1
	);

	function xScale(ts: number): number {
		return PAD_L + ((ts - xMin) / xRange) * (W - PAD_L - PAD_R);
	}

	function priceY(usd: number): number {
		const t = (usd - priceLowerBound) / Math.max(priceUpperBound - priceLowerBound, 1e-12);
		return PRICE_PANE_BOTTOM - t * (PRICE_PANE_BOTTOM - PRICE_PANE_TOP);
	}

	function volumeY(usd: number): number {
		const t = usd / volumeMax;
		return VOLUME_PANE_BOTTOM - t * (VOLUME_PANE_BOTTOM - VOLUME_PANE_TOP);
	}

	const linePath = $derived(
		validPoints
			.map((p, i) => {
				const x = xScale(p.ts);
				const y = priceY(p.price);
				return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.join(' ')
	);

	// Trend color: emerald if last > first, rose if less, slate if flat.
	const trendColor = $derived.by(() => {
		if (validPoints.length < 2) return 'stroke-slate-400 dark:stroke-zinc-500';
		const first = validPoints[0].price;
		const last = validPoints[validPoints.length - 1].price;
		if (last > first) return 'stroke-emerald-500 dark:stroke-emerald-400';
		if (last < first) return 'stroke-rose-500 dark:stroke-rose-400';
		return 'stroke-slate-400 dark:stroke-zinc-500';
	});

	// Y-axis price ticks: 4 evenly-spaced labels between bound min/max.
	const priceTicks = $derived.by(() => {
		if (!hasPoints) return [] as Array<{ y: number; label: string }>;
		const N = 4;
		const ticks: Array<{ y: number; label: string }> = [];
		for (let i = 0; i <= N; i++) {
			const t = i / N;
			const usd = priceUpperBound - t * (priceUpperBound - priceLowerBound);
			ticks.push({ y: priceY(usd), label: fmtUsd(usd) });
		}
		return ticks;
	});

	// X-axis ticks: first, middle, last — deduplicated via Set so a
	// 2-point chart doesn't render "middle" and "last" at the same
	// position (which collides visually with the right-edge label).
	// Date format depends on range length: short ranges show time-of-
	// day, long ranges show ISO date.
	const xTicks = $derived.by(() => {
		if (validPoints.length === 0) return [] as Array<{ x: number; label: string }>;
		const indexSet = new Set<number>([
			0,
			Math.floor(validPoints.length / 2),
			validPoints.length - 1
		]);
		const indices = [...indexSet].sort((a, b) => a - b);
		const showTime = xRange < 86400 * 3; // < 3 days
		return indices.map((i) => {
			const p = validPoints[i];
			const d = new Date(p.ts * 1000);
			const label = showTime
				? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
				: d.toISOString().slice(0, 10);
			return { x: xScale(p.ts), label };
		});
	});

	function pad(n: number): string {
		return n.toString().padStart(2, '0');
	}

	// Decimal-first USD formatting. Picks decimal places based on
	// magnitude so values stay human-readable across the full
	// price-of-CashTokens range:
	//   $1.23           ($1+, 2 decimals)
	//   $0.1234         ($0.01-$1, 4 decimals)
	//   $0.001234       ($0.0001-$0.01, 6 decimals)
	//   $0.00000123     ($1e-6 - $0.0001, 8 decimals)
	//   $1.23e-7        (below $1e-6, exponential — decimal becomes
	//                    unreadably wide past 8 zeros)
	// Thousand separators on $1,234. The decimal-place ladder gives 3
	// significant digits past the leading zeros at every tier — enough
	// for adjacent y-axis ticks to stay visually distinct on the
	// tightest realistic price ranges.
	function fmtUsd(usd: number): string {
		if (!Number.isFinite(usd)) return '—';
		if (usd === 0) return '$0';
		const sign = usd < 0 ? '-' : '';
		const abs = Math.abs(usd);
		let decimals: number;
		if (abs >= 1) decimals = 2;
		else if (abs >= 0.01) decimals = 4;
		else if (abs >= 0.0001) decimals = 6;
		else if (abs >= 0.000001) decimals = 8;
		else return `${sign}$${abs.toExponential(2)}`;
		return `${sign}$${abs.toLocaleString('en-US', {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals
		})}`;
	}

	// Hover state: SVG mousemove finds the nearest bucket by xScale
	// distance and shows a crosshair + tooltip with the bucket's
	// price + volume + timestamp.
	let hoverIndex: number | null = $state(null);

	function onMouseMove(e: MouseEvent) {
		const svg = e.currentTarget as SVGSVGElement | null;
		if (!svg || validPoints.length === 0) return;
		const rect = svg.getBoundingClientRect();
		// Map client x → viewBox x (the SVG is rendered responsive width
		// at constant viewBox coords, so we need the ratio).
		const viewBoxX = ((e.clientX - rect.left) / rect.width) * W;
		// Find nearest point.
		let bestIdx = 0;
		let bestDist = Infinity;
		for (let i = 0; i < validPoints.length; i++) {
			const dx = Math.abs(xScale(validPoints[i].ts) - viewBoxX);
			if (dx < bestDist) {
				bestDist = dx;
				bestIdx = i;
			}
		}
		hoverIndex = bestIdx;
	}

	function onMouseLeave() {
		hoverIndex = null;
	}

	const hoverPoint = $derived(
		hoverIndex !== null && hoverIndex < validPoints.length ? validPoints[hoverIndex] : null
	);
</script>

<div class="w-full">
	{#if !hasPoints}
		<div class="flex items-center justify-center h-64 rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/30 text-sm text-slate-500 dark:text-zinc-300 px-4 text-center">
			Not enough history yet for the {rangeLabel} window. Cauldron snapshots accrue every 4 h
			(plus a 10 min fast-pass for already-listed tokens) — try a shorter range or check back
			in a day.
		</div>
	{:else}
		<svg
			viewBox={`0 0 ${W} ${H}`}
			class="w-full block aspect-[20/7] select-none"
			role="img"
			aria-label="{rangeLabel} price + volume chart"
			onmousemove={onMouseMove}
			onmouseleave={onMouseLeave}
		>
			<title>{rangeLabel} price chart with volume</title>

			<!-- Price-pane gridlines + Y-axis labels -->
			{#each priceTicks as tick, i (i)}
				<line
					x1={PAD_L}
					y1={tick.y}
					x2={W - PAD_R}
					y2={tick.y}
					class="stroke-slate-200 dark:stroke-zinc-800"
					stroke-width="0.5"
					stroke-dasharray="2 3"
				/>
				<text
					x={PAD_L - 6}
					y={tick.y + 3}
					text-anchor="end"
					class="fill-slate-500 dark:fill-zinc-400 font-mono"
					font-size="9"
				>
					{tick.label}
				</text>
			{/each}

			<!-- Pane divider -->
			<line
				x1={PAD_L}
				y1={DIVIDER_Y}
				x2={W - PAD_R}
				y2={DIVIDER_Y}
				class="stroke-slate-300 dark:stroke-zinc-700"
				stroke-width="0.5"
			/>

			<!-- Volume bars. Width: ideally one-per-bucket fills the full
			     pane minus 1px gap, but capped at 40px so a sparse
			     2-point chart doesn't draw two giant bars that cover the
			     pane and run off the right edge. -->
			{#each validPoints as p, i (i)}
				{@const x = xScale(p.ts)}
				{@const y = volumeY(p.volume)}
				{@const barW = Math.max(
					2,
					Math.min(40, (W - PAD_L - PAD_R) / validPoints.length - 1)
				)}
				<rect
					x={x - barW / 2}
					y={y}
					width={barW}
					height={Math.max(0, VOLUME_PANE_BOTTOM - y)}
					class="fill-violet-300 dark:fill-violet-800"
					opacity={hoverIndex === i ? 1 : 0.7}
				/>
			{/each}

			<!-- Price line -->
			<path
				d={linePath}
				fill="none"
				stroke-width="1.5"
				stroke-linejoin="round"
				stroke-linecap="round"
				class={trendColor}
			/>

			<!-- X-axis labels -->
			{#each xTicks as tick, i (i)}
				<text
					x={tick.x}
					y={H - 6}
					text-anchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
					class="fill-slate-500 dark:fill-zinc-400 font-mono"
					font-size="9"
				>
					{tick.label}
				</text>
			{/each}

			<!-- Hover crosshair + dot -->
			{#if hoverPoint}
				<line
					x1={xScale(hoverPoint.ts)}
					y1={PRICE_PANE_TOP}
					x2={xScale(hoverPoint.ts)}
					y2={VOLUME_PANE_BOTTOM}
					class="stroke-slate-400 dark:stroke-zinc-500"
					stroke-width="0.5"
					stroke-dasharray="3 3"
				/>
				<circle
					cx={xScale(hoverPoint.ts)}
					cy={priceY(hoverPoint.price)}
					r="3"
					class="fill-violet-600 dark:fill-violet-400"
				/>
			{/if}
		</svg>

		{#if hoverPoint}
			<div class="mt-2 text-xs font-mono text-slate-600 dark:text-zinc-300 flex flex-wrap gap-x-6 gap-y-1">
				<span>
					{new Date(hoverPoint.ts * 1000).toISOString().slice(0, 16).replace('T', ' ')}Z
				</span>
				<span>
					price <span class="text-slate-900 dark:text-white">{fmtUsd(hoverPoint.price)}</span>
				</span>
				<span>
					vol <span class="text-slate-900 dark:text-white">{fmtUsd(hoverPoint.volume)}</span>
				</span>
			</div>
		{:else}
			<div class="mt-2 text-xs text-slate-500 dark:text-zinc-300">
				{validPoints.length} {validPoints.length === 1 ? 'point' : 'points'} · hover for details
			</div>
		{/if}
	{/if}
</div>
