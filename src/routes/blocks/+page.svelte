<script lang="ts">
	import Sparkline from '$lib/components/Sparkline.svelte';

	let { data } = $props();

	// ---- formatters ---------------------------------------------------------
	// All sat amounts are decimal strings on the wire (NUMERIC / BIGINT).
	// Convert to BCH for human display; toFixed(8) keeps every sat visible.

	const SATS_PER_BCH = 100_000_000;

	const fmtBch = (sats: string): string => {
		const n = Number(sats);
		if (!Number.isFinite(n)) return '—';
		const bch = n / SATS_PER_BCH;
		if (Math.abs(bch) >= 1_000_000) return `${(bch / 1_000_000).toFixed(2)}M BCH`;
		if (Math.abs(bch) >= 1_000) return `${(bch / 1_000).toFixed(2)}k BCH`;
		if (Math.abs(bch) >= 1) return `${bch.toFixed(2)} BCH`;
		if (n === 0) return '0';
		return `${bch.toFixed(8)} BCH`;
	};

	const fmtUsd = (sats: string, bchPriceUSD: number): string => {
		if (bchPriceUSD <= 0) return '—';
		const n = Number(sats);
		if (!Number.isFinite(n) || n === 0) return '—';
		const usd = (n / SATS_PER_BCH) * bchPriceUSD;
		if (Math.abs(usd) >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(2)}B`;
		if (Math.abs(usd) >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
		if (Math.abs(usd) >= 1_000) return `$${(usd / 1_000).toFixed(1)}k`;
		if (Math.abs(usd) >= 1) return `$${usd.toFixed(0)}`;
		return `$${usd.toFixed(2)}`;
	};

	const fmtCount = (n: number): string => {
		if (!Number.isFinite(n)) return '—';
		if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
		if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
		return n.toLocaleString('en-US');
	};

	// Fee ratio = miner fees as a percentage of total economic value
	// transferred. Always small (BCH chain has near-zero fees relative to
	// throughput) so we widen the precision when it's sub-1%.
	const fmtFeeRatio = (feesSats: string, economicSats: string): string => {
		const f = Number(feesSats);
		const e = Number(economicSats);
		if (!Number.isFinite(f) || !Number.isFinite(e) || e <= 0) return '—';
		const pct = (f / e) * 100;
		if (pct === 0) return '0%';
		if (pct < 0.001) return '< 0.001%';
		if (pct < 1) return `${pct.toFixed(4)}%`;
		return `${pct.toFixed(2)}%`;
	};

	// Average inter-block time. Format as "M:SS" if < 1h, otherwise "H:MM:SS".
	// BCH targets 10 min/block; deviations show network speed.
	const fmtBlockTime = (seconds: number | null): string => {
		if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '—';
		const totalSec = Math.round(seconds);
		const m = Math.floor(totalSec / 60);
		const s = totalSec % 60;
		if (m < 60) return `${m}m ${s.toString().padStart(2, '0')}s`;
		const h = Math.floor(m / 60);
		const mm = m % 60;
		return `${h}h ${mm.toString().padStart(2, '0')}m`;
	};

	// Color the ratio against BCH's 10-minute target — emerald for faster
	// (< 9:30), slate for on-target, amber for slower (> 11:00).
	const blockTimeColor = (seconds: number | null): string => {
		if (seconds == null) return 'text-slate-700 dark:text-zinc-200';
		if (seconds < 570) return 'text-emerald-600 dark:text-emerald-400'; // < 9:30
		if (seconds > 660) return 'text-amber-600 dark:text-amber-400';     // > 11:00
		return 'text-slate-900 dark:text-white';
	};

	const fmtBytes = (b: number | null): string => {
		if (b === null || !Number.isFinite(b)) return '—';
		if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(2)} MB`;
		if (b >= 1_000) return `${(b / 1_000).toFixed(1)} kB`;
		return `${b} B`;
	};

	const shortHash = (h: string): string => `${h.slice(0, 8)}…${h.slice(-6)}`;

	const fmtRelative = (iso: string): string => {
		const t = new Date(iso).getTime();
		if (!Number.isFinite(t)) return iso;
		const diff = (Date.now() - t) / 1000;
		if (diff < 60) return `${Math.floor(diff)}s ago`;
		if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
		if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
		return new Date(iso).toISOString().slice(0, 10);
	};

	// External-explorer link. salemkode.com is the BCH-native explorer;
	// users following a row's hash get full tx-level detail without us
	// having to reproduce it in-app.
	const explorerUrl = (hashHex: string) => `https://explorer.salemkode.com/block/${hashHex}`;

	// ---- sparklines from day buckets ---------------------------------------
	// `data.dayBuckets` is oldest-first daily aggregates over the last 30
	// days. Sparkline.svelte expects oldest-first numeric arrays.

	const txCountSpark = $derived(data.dayBuckets.map((d) => d.txCount));
	const feesSpark = $derived(data.dayBuckets.map((d) => d.feesSats));
	// Daily total economic value (sum of non-coinbase outputs). Plotted
	// alongside the "Economic value — 7d" headline so the sparkline and
	// the number agree about what they're showing.
	const economicSpark = $derived(data.dayBuckets.map((d) => d.economicSats));

	// ---- pagination --------------------------------------------------------
	const prevPage = $derived(Math.max(1, data.page - 1));
	const nextPage = $derived(data.page + 1);
	const showPrev = $derived(data.page > 1);
	// Hide "Next" if this page returned fewer than PAGE_SIZE rows — that
	// means there's no further history.
	const showNext = $derived(data.rows.length >= data.pageSize);
</script>

<svelte:head>
	<title>Blocks — Token Stork</title>
	<meta
		name="description"
		content="Per-block economics dashboard for Bitcoin Cash from CashTokens activation forward: tx count, miner take, fees, total economic value transferred, block size."
	/>
</svelte:head>

<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<div class="mb-8">
		<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent">
			Blocks
		</h1>
		<p class="mt-2 max-w-3xl ts-text-muted">
			Per-block economics for Bitcoin Cash from CashTokens activation (block 792,772) onward.
			Each row summarizes a single block: how many transactions it contains, what the miner
			collected, how much of that was fees vs. the protocol subsidy, and the total economic
			value transferred across non-coinbase outputs.
		</p>
	</div>

	<!--
		Headline strip: 7d / 30d / all-time aggregates. Three cards stack on
		mobile, three-up on desktop. Each card pairs the headline number with
		a tiny sparkline from the daily bucket series.
	-->
	<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
		<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
			<div class="text-xs uppercase tracking-wider ts-text-muted">
				Blocks indexed
			</div>
			<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">
				{fmtCount(data.summaryAll.blockCount)}
			</div>
			<div class="mt-1 text-xs ts-text-muted">
				since {data.summaryAll.minHeight ?? '—'}
				{#if data.summaryAll.maxHeight !== null}· tip {data.summaryAll.maxHeight}{/if}
			</div>
		</div>

		<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
			<div class="flex items-start justify-between">
				<div>
					<div class="text-xs uppercase tracking-wider ts-text-muted">
						Tx — last 7d
					</div>
					<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">
						{fmtCount(data.summary7d.totalTxCount)}
					</div>
					<div class="mt-1 text-xs ts-text-muted">
						avg {data.summary7d.blockCount > 0 ? Math.round(data.summary7d.totalTxCount / data.summary7d.blockCount) : 0}/block
					</div>
				</div>
				<Sparkline points={txCountSpark} width={64} height={28} />
			</div>
		</div>

		<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
			<div class="flex items-start justify-between">
				<div>
					<div class="text-xs uppercase tracking-wider ts-text-muted">
						Fees — last 7d
					</div>
					<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">
						{fmtBch(data.summary7d.totalFeesSats)}
					</div>
					<div class="mt-1 text-xs ts-text-muted">
						{fmtUsd(data.summary7d.totalFeesSats, data.bchPriceUSD)}
					</div>
				</div>
				<Sparkline points={feesSpark} width={64} height={28} />
			</div>
		</div>

		<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
			<div class="flex items-start justify-between">
				<div>
					<div class="text-xs uppercase tracking-wider ts-text-muted">
						Economic value — 7d
					</div>
					<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">
						{fmtBch(data.summary7d.totalEconomicSats)}
					</div>
					<div class="mt-1 text-xs ts-text-muted">
						{fmtUsd(data.summary7d.totalEconomicSats, data.bchPriceUSD)}
					</div>
				</div>
				<Sparkline points={economicSpark} width={64} height={28} />
			</div>
		</div>
	</div>

	<!--
		Average inter-block time over 24h / 7d / 30d. BCH targets 10 minutes
		per block via difficulty adjustment; deviations show network speed.
		Color: emerald when faster than 9:30, amber when slower than 11:00,
		default at-target.
	-->
	<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
		<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
			<div class="text-xs uppercase tracking-wider ts-text-muted">
				Avg block time — 24h
			</div>
			<div class="mt-2 text-3xl font-semibold {blockTimeColor(data.blockTime.w24h.avgSeconds)}">
				{fmtBlockTime(data.blockTime.w24h.avgSeconds)}
			</div>
			<div class="mt-1 text-xs ts-text-muted">
				{fmtCount(data.blockTime.w24h.blocks)} {data.blockTime.w24h.blocks === 1 ? 'block' : 'blocks'} · target 10m 00s
			</div>
		</div>
		<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
			<div class="text-xs uppercase tracking-wider ts-text-muted">
				Avg block time — 7d
			</div>
			<div class="mt-2 text-3xl font-semibold {blockTimeColor(data.blockTime.w7d.avgSeconds)}">
				{fmtBlockTime(data.blockTime.w7d.avgSeconds)}
			</div>
			<div class="mt-1 text-xs ts-text-muted">
				{fmtCount(data.blockTime.w7d.blocks)} blocks
			</div>
		</div>
		<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
			<div class="text-xs uppercase tracking-wider ts-text-muted">
				Avg block time — 30d
			</div>
			<div class="mt-2 text-3xl font-semibold {blockTimeColor(data.blockTime.w30d.avgSeconds)}">
				{fmtBlockTime(data.blockTime.w30d.avgSeconds)}
			</div>
			<div class="mt-1 text-xs ts-text-muted">
				{fmtCount(data.blockTime.w30d.blocks)} blocks
			</div>
		</div>
	</div>

	<!--
		30d & all-time secondary card row — same shape, just the longer
		windows. Helps grok whether the 7d numbers are typical or anomalous.
	-->
	<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
		<div class="p-4 rounded-xl border bg-slate-50/50 dark:bg-zinc-900/50 ts-border-subtle">
			<div class="text-xs uppercase tracking-wider mb-2 ts-text-muted">
				Last 30 days
			</div>
			<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-sm">
				<div>
					<div class="text-xs text-slate-500">Blocks</div>
					<div class="font-mono">{fmtCount(data.summary30d.blockCount)}</div>
				</div>
				<div>
					<div class="text-xs text-slate-500">Txs</div>
					<div class="font-mono">{fmtCount(data.summary30d.totalTxCount)}</div>
				</div>
				<div>
					<div class="text-xs text-slate-500">Fees</div>
					<div class="font-mono">{fmtBch(data.summary30d.totalFeesSats)}</div>
				</div>
				<div>
					<div class="text-xs text-slate-500" title="Sum of outputs across non-coinbase txs">Value</div>
					<div class="font-mono">{fmtBch(data.summary30d.totalEconomicSats)}</div>
				</div>
				<div>
					<div class="text-xs text-slate-500" title="Miner fees as a percentage of total economic value transferred">Fee / Value</div>
					<div class="font-mono">{fmtFeeRatio(data.summary30d.totalFeesSats, data.summary30d.totalEconomicSats)}</div>
				</div>
			</div>
		</div>
		<div class="p-4 rounded-xl border bg-slate-50/50 dark:bg-zinc-900/50 ts-border-subtle">
			<div class="text-xs uppercase tracking-wider mb-2 ts-text-muted">
				All time (since CashTokens activation)
			</div>
			<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-sm">
				<div>
					<div class="text-xs text-slate-500">Blocks</div>
					<div class="font-mono">{fmtCount(data.summaryAll.blockCount)}</div>
				</div>
				<div>
					<div class="text-xs text-slate-500">Txs</div>
					<div class="font-mono">{fmtCount(data.summaryAll.totalTxCount)}</div>
				</div>
				<div>
					<div class="text-xs text-slate-500">Fees</div>
					<div class="font-mono">{fmtBch(data.summaryAll.totalFeesSats)}</div>
				</div>
				<div>
					<div class="text-xs text-slate-500" title="Sum of outputs across non-coinbase txs">Value</div>
					<div class="font-mono">{fmtBch(data.summaryAll.totalEconomicSats)}</div>
				</div>
				<div>
					<div class="text-xs text-slate-500" title="Miner fees as a percentage of total economic value transferred">Fee / Value</div>
					<div class="font-mono">{fmtFeeRatio(data.summaryAll.totalFeesSats, data.summaryAll.totalEconomicSats)}</div>
				</div>
			</div>
		</div>
	</div>

	{#if data.rows.length === 0}
		<div class="p-8 rounded-xl border bg-slate-50 dark:bg-zinc-900/50 text-center ts-border-subtle">
			<p class="ts-text-muted">
				No blocks indexed yet. The backfill will populate this page in ~30 minutes; the live
				tail walker keeps it current from there.
			</p>
		</div>
	{:else}
		<!-- Desktop table -->
		<div class="hidden md:block overflow-hidden rounded-xl border ts-border-subtle">
			<div class="grid grid-cols-[0.8fr_1.4fr_0.7fr_0.6fr_0.9fr_0.8fr_0.9fr_0.6fr] gap-2 px-4 py-3 bg-slate-50 dark:bg-zinc-900/50 border-b text-xs font-semibold uppercase tracking-wider items-center ts-text-muted ts-border-subtle">
				<div>Height</div>
				<div>Time</div>
				<div class="text-right">Hash</div>
				<div class="text-right">Txs</div>
				<div class="text-right" title="Coinbase output = subsidy + fees">Miner take</div>
				<div class="text-right">Fees</div>
				<div class="text-right" title="Sum of outputs across non-coinbase txs">Value</div>
				<div class="text-right">Size</div>
			</div>
			{#each data.rows as r (r.height)}
				<div class="grid grid-cols-[0.8fr_1.4fr_0.7fr_0.6fr_0.9fr_0.8fr_0.9fr_0.6fr] gap-2 px-4 py-3 border-b last:border-b-0 items-center hover:bg-slate-50/50 dark:hover:bg-zinc-900/30 transition-colors text-sm ts-border-subtle">
					<div class="font-mono font-semibold text-slate-900 dark:text-white">
						{r.height.toLocaleString('en-US')}
					</div>
					<div class="ts-text-muted">
						<div>{fmtRelative(r.time)}</div>
						<div class="text-xs ts-text-faint">
							{new Date(r.time).toISOString().slice(0, 19).replace('T', ' ')}
						</div>
					</div>
					<div class="text-right">
						<a
							href={explorerUrl(r.hashHex)}
							target="_blank"
							rel="noopener noreferrer"
							class="text-xs font-mono text-violet-600 dark:text-violet-400 hover:underline"
							title={r.hashHex}
						>
							{shortHash(r.hashHex)} ↗
						</a>
					</div>
					<div class="text-right font-mono">{r.txCount.toLocaleString('en-US')}</div>
					<div class="text-right font-mono">
						<div>{fmtBch(r.coinbaseSats)}</div>
						<div class="text-xs text-slate-400">{fmtUsd(r.coinbaseSats, data.bchPriceUSD)}</div>
					</div>
					<div class="text-right font-mono {Number(r.feesSats) > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500'}">
						{fmtBch(r.feesSats)}
					</div>
					<div class="text-right font-mono">
						<div>{fmtBch(r.totalOutputSats)}</div>
						<div class="text-xs text-slate-400">{fmtUsd(r.totalOutputSats, data.bchPriceUSD)}</div>
					</div>
					<div class="text-right font-mono ts-text-muted">
						{fmtBytes(r.sizeBytes)}
					</div>
				</div>
			{/each}
		</div>

		<!-- Mobile: stacked cards. The desktop grid would crush at <md. -->
		<div class="md:hidden space-y-3">
			{#each data.rows as r (r.height)}
				<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
					<div class="flex items-baseline justify-between mb-2">
						<div class="font-mono text-lg font-semibold text-slate-900 dark:text-white">
							{r.height.toLocaleString('en-US')}
						</div>
						<a
							href={explorerUrl(r.hashHex)}
							target="_blank"
							rel="noopener noreferrer"
							class="text-xs font-mono text-violet-600 dark:text-violet-400 hover:underline"
						>
							{shortHash(r.hashHex)} ↗
						</a>
					</div>
					<div class="text-xs mb-3 ts-text-muted">
						{fmtRelative(r.time)} ·
						{new Date(r.time).toISOString().slice(0, 19).replace('T', ' ')}
					</div>
					<div class="grid grid-cols-2 gap-2 text-sm">
						<div>
							<div class="text-xs text-slate-500">Txs</div>
							<div class="font-mono">{r.txCount.toLocaleString('en-US')}</div>
						</div>
						<div>
							<div class="text-xs text-slate-500">Size</div>
							<div class="font-mono">{fmtBytes(r.sizeBytes)}</div>
						</div>
						<div>
							<div class="text-xs text-slate-500">Miner take</div>
							<div class="font-mono">{fmtBch(r.coinbaseSats)}</div>
						</div>
						<div>
							<div class="text-xs text-slate-500">Fees</div>
							<div class="font-mono {Number(r.feesSats) > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500'}">
								{fmtBch(r.feesSats)}
							</div>
						</div>
						<div class="col-span-2">
							<div class="text-xs text-slate-500">Economic value</div>
							<div class="font-mono">{fmtBch(r.totalOutputSats)} <span class="text-xs text-slate-400">{fmtUsd(r.totalOutputSats, data.bchPriceUSD)}</span></div>
						</div>
					</div>
				</div>
			{/each}
		</div>

		<!-- Pagination -->
		<div class="mt-6 flex items-center justify-between text-sm">
			<div class="ts-text-muted">
				Page {data.page} · {data.pageSize} per page
			</div>
			<div class="flex gap-2">
				{#if showPrev}
					<a
						href={`/blocks${prevPage === 1 ? '' : `?page=${prevPage}`}`}
						class="px-3 py-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-700 ts-text-strong ts-surface-chip"
					>
						← Newer
					</a>
				{/if}
				{#if showNext}
					<a
						href={`/blocks?page=${nextPage}`}
						class="px-3 py-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-700 ts-text-strong ts-surface-chip"
					>
						Older →
					</a>
				{/if}
			</div>
		</div>
	{/if}

	<section class="mt-10 p-5 rounded-xl border bg-slate-50/50 dark:bg-zinc-900/30 ts-border-subtle">
		<h2 class="text-base font-semibold text-slate-900 dark:text-white mb-2">Notes</h2>
		<ul class="text-sm space-y-1.5 list-disc list-inside ts-text-muted">
			<li>
				<strong>Miner take</strong> is the sum of the coinbase transaction's outputs — what the
				block's miner actually claimed. It equals the protocol <em>subsidy</em> plus all
				transaction fees, and a miner can legally claim less (any unclaimed sats are burned).
			</li>
			<li>
				<strong>Fees</strong> are derived as <code class="text-xs px-1.5 py-0.5 rounded font-mono ts-surface-chip">miner_take − subsidy_at_height</code>, where the subsidy follows the BCH halving schedule (50 BCH from genesis, halving every 210,000 blocks). At the current era subsidy is 6.25 BCH per block.
			</li>
			<li>
				<strong>Economic value</strong> is the sum of every output across the block's
				non-coinbase transactions. It overstates "value transferred" because most txs include
				change-back-to-self outputs — but it's a useful, deterministic-from-the-block lens
				without needing to fetch every prev-output to compute net flows.
			</li>
			<li>
				Block hashes link out to
				<a class="text-violet-600 dark:text-violet-400 hover:underline" href="https://explorer.salemkode.com/" target="_blank" rel="noopener noreferrer">salemkode.com</a>
				for full transaction-level detail. tokenstork.com indexes the per-block summary; the
				explorer has the per-tx breakdown.
			</li>
			<li>
				Coverage starts at block <strong>792,772</strong> (CashTokens activation, May 2023).
				Pre-activation history is out of scope.
			</li>
		</ul>
	</section>
</main>
