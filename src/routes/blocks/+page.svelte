<script lang="ts">
	import Sparkline from '$lib/components/Sparkline.svelte';
	import * as m from '$lib/paraglide/messages';
	import { getLocale, localizeHref } from '$lib/paraglide/runtime';

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
		return n.toLocaleString(getLocale());
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
		if (diff < 60) return m.bl_rel_s({ n: Math.floor(diff) });
		if (diff < 3600) return m.wl_ago_m({ n: Math.floor(diff / 60) });
		if (diff < 86400) return m.wl_ago_h({ n: Math.floor(diff / 3600) });
		if (diff < 86400 * 30) return m.wl_ago_d({ n: Math.floor(diff / 86400) });
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
	<title>{m.bl_meta_title()}</title>
	<meta
		name="description"
		content={m.bl_meta_description()}
	/>
</svelte:head>

<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<div class="mb-8">
		<h1 class="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent">
			{m.bl_h1()}
		</h1>
		<p class="mt-2 max-w-3xl ts-text-muted">
			{m.bl_intro()}
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
				{m.bl_blocks_indexed()}
			</div>
			<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">
				{fmtCount(data.summaryAll.blockCount)}
			</div>
			<div class="mt-1 text-xs ts-text-muted">
				{m.bl_since()} {data.summaryAll.minHeight ?? '—'}
				{#if data.summaryAll.maxHeight !== null}{m.bl_tip()} {data.summaryAll.maxHeight}{/if}
			</div>
		</div>

		<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
			<div class="flex items-start justify-between">
				<div>
					<div class="text-xs uppercase tracking-wider ts-text-muted">
						{m.bl_tx_7d()}
					</div>
					<div class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">
						{fmtCount(data.summary7d.totalTxCount)}
					</div>
					<div class="mt-1 text-xs ts-text-muted">
						{m.mn_avg_per_block({ n: data.summary7d.blockCount > 0 ? Math.round(data.summary7d.totalTxCount / data.summary7d.blockCount) : 0 })}
					</div>
				</div>
				<Sparkline points={txCountSpark} width={64} height={28} />
			</div>
		</div>

		<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
			<div class="flex items-start justify-between">
				<div>
					<div class="text-xs uppercase tracking-wider ts-text-muted">
						{m.bl_fees_7d()}
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
						{m.bl_econ_7d()}
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
				{m.bl_block_time_24h()}
			</div>
			<div class="mt-2 text-3xl font-semibold {blockTimeColor(data.blockTime.w24h.avgSeconds)}">
				{fmtBlockTime(data.blockTime.w24h.avgSeconds)}
			</div>
			<div class="mt-1 text-xs ts-text-muted">
				{fmtCount(data.blockTime.w24h.blocks)} {data.blockTime.w24h.blocks === 1 ? m.bl_block() : m.bl_blocks()} {m.bl_target()}
			</div>
		</div>
		<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
			<div class="text-xs uppercase tracking-wider ts-text-muted">
				{m.bl_block_time_7d()}
			</div>
			<div class="mt-2 text-3xl font-semibold {blockTimeColor(data.blockTime.w7d.avgSeconds)}">
				{fmtBlockTime(data.blockTime.w7d.avgSeconds)}
			</div>
			<div class="mt-1 text-xs ts-text-muted">
				{fmtCount(data.blockTime.w7d.blocks)} {m.bl_blocks()}
			</div>
		</div>
		<div class="p-4 rounded-xl border ts-border-subtle ts-surface-panel">
			<div class="text-xs uppercase tracking-wider ts-text-muted">
				{m.bl_block_time_30d()}
			</div>
			<div class="mt-2 text-3xl font-semibold {blockTimeColor(data.blockTime.w30d.avgSeconds)}">
				{fmtBlockTime(data.blockTime.w30d.avgSeconds)}
			</div>
			<div class="mt-1 text-xs ts-text-muted">
				{fmtCount(data.blockTime.w30d.blocks)} {m.bl_blocks()}
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
				{m.bl_last_30d()}
			</div>
			<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-sm">
				<div>
					<div class="text-xs text-slate-500">{m.bl_lbl_blocks()}</div>
					<div class="font-mono">{fmtCount(data.summary30d.blockCount)}</div>
				</div>
				<div>
					<div class="text-xs text-slate-500">{m.bl_lbl_txs()}</div>
					<div class="font-mono">{fmtCount(data.summary30d.totalTxCount)}</div>
				</div>
				<div>
					<div class="text-xs text-slate-500">{m.bl_lbl_fees()}</div>
					<div class="font-mono">{fmtBch(data.summary30d.totalFeesSats)}</div>
				</div>
				<div>
					<div class="text-xs text-slate-500" title={m.bl_value_title()}>{m.bl_lbl_value()}</div>
					<div class="font-mono">{fmtBch(data.summary30d.totalEconomicSats)}</div>
				</div>
				<div>
					<div class="text-xs text-slate-500" title={m.bl_fee_value_title()}>{m.bl_lbl_fee_value()}</div>
					<div class="font-mono">{fmtFeeRatio(data.summary30d.totalFeesSats, data.summary30d.totalEconomicSats)}</div>
				</div>
			</div>
		</div>
		<div class="p-4 rounded-xl border bg-slate-50/50 dark:bg-zinc-900/50 ts-border-subtle">
			<div class="text-xs uppercase tracking-wider mb-2 ts-text-muted">
				{m.bl_all_time_full()}
			</div>
			<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-sm">
				<div>
					<div class="text-xs text-slate-500">{m.bl_lbl_blocks()}</div>
					<div class="font-mono">{fmtCount(data.summaryAll.blockCount)}</div>
				</div>
				<div>
					<div class="text-xs text-slate-500">{m.bl_lbl_txs()}</div>
					<div class="font-mono">{fmtCount(data.summaryAll.totalTxCount)}</div>
				</div>
				<div>
					<div class="text-xs text-slate-500">{m.bl_lbl_fees()}</div>
					<div class="font-mono">{fmtBch(data.summaryAll.totalFeesSats)}</div>
				</div>
				<div>
					<div class="text-xs text-slate-500" title={m.bl_value_title()}>{m.bl_lbl_value()}</div>
					<div class="font-mono">{fmtBch(data.summaryAll.totalEconomicSats)}</div>
				</div>
				<div>
					<div class="text-xs text-slate-500" title={m.bl_fee_value_title()}>{m.bl_lbl_fee_value()}</div>
					<div class="font-mono">{fmtFeeRatio(data.summaryAll.totalFeesSats, data.summaryAll.totalEconomicSats)}</div>
				</div>
			</div>
		</div>
	</div>

	{#if data.rows.length === 0}
		<div class="p-8 rounded-xl border bg-slate-50 dark:bg-zinc-900/50 text-center ts-border-subtle">
			<p class="ts-text-muted">
				{m.bl_empty()}
			</p>
		</div>
	{:else}
		<!-- Desktop table -->
		<div class="hidden md:block overflow-hidden rounded-xl border ts-border-subtle">
			<div class="grid grid-cols-[0.8fr_1.4fr_0.7fr_0.6fr_0.9fr_0.8fr_0.9fr_0.6fr] gap-2 px-4 py-3 bg-slate-50 dark:bg-zinc-900/50 border-b text-xs font-semibold uppercase tracking-wider items-center ts-text-muted ts-border-subtle">
				<div>{m.bl_col_height()}</div>
				<div>{m.bl_col_time()}</div>
				<div class="text-right">{m.bl_col_hash()}</div>
				<div class="text-right">{m.bl_lbl_txs()}</div>
				<div class="text-right" title={m.bl_miner_take_title()}>{m.bl_col_miner_take()}</div>
				<div class="text-right">{m.bl_lbl_fees()}</div>
				<div class="text-right" title={m.bl_value_title()}>{m.bl_lbl_value()}</div>
				<div class="text-right">{m.bl_col_size()}</div>
			</div>
			{#each data.rows as r (r.height)}
				<div class="grid grid-cols-[0.8fr_1.4fr_0.7fr_0.6fr_0.9fr_0.8fr_0.9fr_0.6fr] gap-2 px-4 py-3 border-b last:border-b-0 items-center hover:bg-slate-50/50 dark:hover:bg-zinc-900/30 transition-colors text-sm ts-border-subtle">
					<div class="font-mono font-semibold text-slate-900 dark:text-white">
						{r.height.toLocaleString(getLocale())}
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
					<div class="text-right font-mono">{r.txCount.toLocaleString(getLocale())}</div>
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
							{r.height.toLocaleString(getLocale())}
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
							<div class="text-xs text-slate-500">{m.bl_lbl_txs()}</div>
							<div class="font-mono">{r.txCount.toLocaleString(getLocale())}</div>
						</div>
						<div>
							<div class="text-xs text-slate-500">{m.bl_col_size()}</div>
							<div class="font-mono">{fmtBytes(r.sizeBytes)}</div>
						</div>
						<div>
							<div class="text-xs text-slate-500">{m.bl_col_miner_take()}</div>
							<div class="font-mono">{fmtBch(r.coinbaseSats)}</div>
						</div>
						<div>
							<div class="text-xs text-slate-500">{m.bl_lbl_fees()}</div>
							<div class="font-mono {Number(r.feesSats) > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500'}">
								{fmtBch(r.feesSats)}
							</div>
						</div>
						<div class="col-span-2">
							<div class="text-xs text-slate-500">{m.bl_econ_value()}</div>
							<div class="font-mono">{fmtBch(r.totalOutputSats)} <span class="text-xs text-slate-400">{fmtUsd(r.totalOutputSats, data.bchPriceUSD)}</span></div>
						</div>
					</div>
				</div>
			{/each}
		</div>

		<!-- Pagination -->
		<div class="mt-6 flex items-center justify-between text-sm">
			<div class="ts-text-muted">
				{m.bl_page_info({ page: data.page, size: data.pageSize })}
			</div>
			<div class="flex gap-2">
				{#if showPrev}
					<a
						href={localizeHref(`/blocks${prevPage === 1 ? '' : `?page=${prevPage}`}`)}
						class="px-3 py-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-700 ts-text-strong ts-surface-chip"
					>
						← {m.ui_newer()}
					</a>
				{/if}
				{#if showNext}
					<a
						href={localizeHref(`/blocks?page=${nextPage}`)}
						class="px-3 py-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-700 ts-text-strong ts-surface-chip"
					>
						{m.ui_older()} →
					</a>
				{/if}
			</div>
		</div>
	{/if}

	<section class="mt-10 p-5 rounded-xl border bg-slate-50/50 dark:bg-zinc-900/30 ts-border-subtle">
		<h2 class="text-base font-semibold text-slate-900 dark:text-white mb-2">{m.ui_notes()}</h2>
		<ul class="text-sm space-y-1.5 list-disc list-inside ts-text-muted">
			<li>{@html m.bl_note1()}</li>
			<li>{@html m.bl_note2()}</li>
			<li>{@html m.bl_note3()}</li>
			<li>{@html m.bl_note4()}</li>
			<li>{@html m.bl_note5()}</li>
		</ul>
	</section>
</main>
