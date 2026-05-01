<script lang="ts">
	import Sparkline from '$lib/components/Sparkline.svelte';

	let { data } = $props();

	const SATS_PER_BCH = 100_000_000;

	const fmtBch = (sats: string | number): string => {
		const n = typeof sats === 'string' ? Number(sats) : sats;
		if (!Number.isFinite(n)) return '—';
		const bch = n / SATS_PER_BCH;
		if (Math.abs(bch) >= 1_000) return `${(bch / 1_000).toFixed(2)}k BCH`;
		if (Math.abs(bch) >= 1) return `${bch.toFixed(3)} BCH`;
		if (n === 0) return '0';
		return `${bch.toFixed(8)} BCH`;
	};

	const fmtCount = (n: number): string => {
		if (!Number.isFinite(n)) return '—';
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
		return n.toLocaleString('en-US');
	};

	// Pool-share percentage relative to the window's total blocks.
	function poolShare(blocks: number, totalBlocks: number): string {
		if (totalBlocks === 0) return '—';
		return `${((blocks / totalBlocks) * 100).toFixed(1)}%`;
	}

	const totalBlocks7d = $derived(data.pool7d.reduce((s, p) => s + p.blocks, 0));
	const totalBlocks30d = $derived(data.pool30d.reduce((s, p) => s + p.blocks, 0));
	const totalBlocksAll = $derived(data.poolAll.reduce((s, p) => s + p.blocks, 0));

	// Sparkline series — oldest-first, matches the Sparkline component contract.
	const blocksSpark = $derived(data.dayBuckets.map((d) => d.blocks));
	const feesSpark = $derived(data.dayBuckets.map((d) => d.feesSats));
	const feeRateSpark = $derived(data.dayBuckets.map((d) => d.feeRateSatsPerByte));

	// Headline aggregates over the 30-day window.
	const totalFees30dSats = $derived(data.dayBuckets.reduce((s, d) => s + d.feesSats, 0));
	const totalTxs30d = $derived(data.dayBuckets.reduce((s, d) => s + d.txCount, 0));
	const avgFeeRate30d = $derived.by(() => {
		const totalBytes = data.dayBuckets.reduce((s, d) => s + d.bytes, 0);
		const totalFees = data.dayBuckets.reduce((s, d) => s + d.feesSats, 0);
		return totalBytes > 0 ? totalFees / totalBytes : 0;
	});
</script>

<svelte:head>
	<title>Mining — Token Stork</title>
	<meta
		name="description"
		content="BCH mining pool attribution + fee market dynamics, derived from on-chain coinbase scriptSig analysis since CashTokens activation."
	/>
</svelte:head>

<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<div class="mb-8">
		<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent">
			Mining
		</h1>
		<p class="mt-2 max-w-3xl ts-text-muted">
			Mining-pool attribution + fee market dynamics for Bitcoin Cash since CashTokens
			activation (block 792,772). Pool identity is decoded from each block's coinbase
			scriptSig — the same byte-pattern matching every BCH explorer does.
		</p>
	</div>

	<!-- 30-day headline strip -->
	<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
		<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
			<div class="flex items-start justify-between">
				<div>
					<div class="text-xs uppercase tracking-wider ts-text-muted">
						Blocks — last 30d
					</div>
					<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">
						{fmtCount(totalBlocks30d)}
					</div>
					<div class="mt-1 text-xs ts-text-muted">
						across {data.pool30d.length} {data.pool30d.length === 1 ? 'pool' : 'pools'}
					</div>
				</div>
				<Sparkline points={blocksSpark} width={64} height={28} />
			</div>
		</div>

		<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
			<div class="flex items-start justify-between">
				<div>
					<div class="text-xs uppercase tracking-wider ts-text-muted">
						Tx — last 30d
					</div>
					<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">
						{fmtCount(totalTxs30d)}
					</div>
					<div class="mt-1 text-xs ts-text-muted">
						avg {totalBlocks30d > 0 ? Math.round(totalTxs30d / totalBlocks30d) : 0}/block
					</div>
				</div>
			</div>
		</div>

		<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
			<div class="flex items-start justify-between">
				<div>
					<div class="text-xs uppercase tracking-wider ts-text-muted">
						Fees — last 30d
					</div>
					<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">
						{fmtBch(totalFees30dSats)}
					</div>
					<div class="mt-1 text-xs ts-text-muted">
						miner take above subsidy
					</div>
				</div>
				<Sparkline points={feesSpark} width={64} height={28} />
			</div>
		</div>

		<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
			<div class="flex items-start justify-between">
				<div>
					<div class="text-xs uppercase tracking-wider ts-text-muted">
						Fee rate — 30d avg
					</div>
					<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">
						{avgFeeRate30d.toFixed(2)}
					</div>
					<div class="mt-1 text-xs ts-text-muted">
						sats per byte (proxy)
					</div>
				</div>
				<Sparkline points={feeRateSpark} width={64} height={28} />
			</div>
		</div>
	</div>

	<!-- Pool attribution tables. Three side-by-side windows. -->
	<section class="mb-8">
		<h2 class="text-xl font-semibold text-slate-900 dark:text-white mb-4">
			Mining pool attribution
		</h2>
		<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
			{#each [
				{ label: '7 days', stats: data.pool7d, total: totalBlocks7d },
				{ label: '30 days', stats: data.pool30d, total: totalBlocks30d },
				{ label: 'All time', stats: data.poolAll, total: totalBlocksAll }
			] as window (window.label)}
				<div class="rounded-xl border overflow-hidden ts-border-subtle">
					<div class="px-4 py-3 bg-slate-50 dark:bg-zinc-900/50 border-b text-xs font-semibold uppercase tracking-wider ts-text-muted ts-border-subtle">
						{window.label} · {fmtCount(window.total)} blocks
					</div>
					{#if window.stats.length === 0}
						<div class="px-4 py-6 text-sm text-center ts-text-muted">
							No blocks in this window yet.
						</div>
					{:else}
						{#each window.stats as p (p.pool)}
							<div class="grid grid-cols-[1.4fr_0.6fr_0.8fr] gap-2 px-4 py-2 border-b last:border-b-0 items-center text-sm ts-border-subtle">
								<div class="font-medium text-slate-900 dark:text-white truncate">
									{p.pool}
								</div>
								<div class="text-right font-mono text-xs ts-text-strong">
									{fmtCount(p.blocks)}
								</div>
								<div class="text-right font-mono text-xs ts-text-muted">
									{poolShare(p.blocks, window.total)}
								</div>
							</div>
						{/each}
					{/if}
				</div>
			{/each}
		</div>
	</section>

	<section class="mt-10 p-5 rounded-xl border bg-slate-50/50 dark:bg-zinc-900/30 ts-border-subtle">
		<h2 class="text-base font-semibold text-slate-900 dark:text-white mb-2">Notes</h2>
		<ul class="text-sm space-y-1.5 list-disc list-inside ts-text-muted">
			<li>
				<strong>Pool attribution</strong> is decoded from each block's coinbase scriptSig
				via byte-substring matching against a hand-curated list of pool tags
				(<code class="text-xs px-1.5 py-0.5 rounded font-mono ts-surface-chip">/ViaBTC/</code>,
				<code class="text-xs px-1.5 py-0.5 rounded font-mono ts-surface-chip">/AntPool/</code>,
				<code class="text-xs px-1.5 py-0.5 rounded font-mono ts-surface-chip">Foundry USA Pool</code>, etc.). Solo miners and
				unrecognized tags bucket as <em>Unknown</em>.
			</li>
			<li>
				<strong>Fee rate</strong> is sats / byte computed from the day's total fees ÷ total
				block bytes. It's a proxy for the fee market — actual mempool fee rates are higher
				because empty space in low-utilization blocks brings the average down.
			</li>
			<li>
				<strong>Miner take</strong> per block is the coinbase output value (subsidy + fees).
				Today the BCH subsidy is fixed at 6.25 BCH/block until the next halving in 2028; fee
				revenue is a small fraction on top.
			</li>
			<li>
				Coverage starts at block <strong>792,772</strong> (CashTokens activation, May 2023).
				Pre-activation history is out of scope for this site.
			</li>
		</ul>
	</section>
</main>
