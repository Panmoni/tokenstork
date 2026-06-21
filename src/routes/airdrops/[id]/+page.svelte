<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';

	let { data } = $props();

	const stateTone = $derived.by(() => {
		switch (data.airdrop.state) {
			case 'complete':
				return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300';
			case 'failed':
				return 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300';
			case 'partial':
				return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
			default:
				return 'bg-slate-100 dark:bg-zinc-800 ts-text-muted';
		}
	});

	function formatBaseUnits(s: string, dec: number): string {
		const big = BigInt(s);
		if (dec === 0) return big.toString();
		const padded = big.toString().padStart(dec + 1, '0');
		const whole = padded.slice(0, -dec);
		const frac = padded.slice(-dec).replace(/0+$/, '');
		return frac.length === 0 ? whole : `${whole}.${frac}`;
	}
</script>

<svelte:head>
	<title>{m.adr_meta_title()}</title>
</svelte:head>

<div class="max-w-4xl mx-auto px-4 py-8">
	<div class="flex items-center justify-between mb-1">
		<h1 class="text-3xl font-bold ts-text-strong">{m.adr_h1()}</h1>
		<span class={`px-2 py-1 rounded text-xs font-semibold ${stateTone}`}>{data.airdrop.state}</span>
	</div>
	<p class="text-xs ts-text-muted font-mono mb-6">{data.airdrop.id}</p>

	<section class="rounded-xl border ts-border-subtle p-5 ts-surface-panel mb-6">
		<dl class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
			<div>
				<dt class="text-xs uppercase tracking-wider ts-text-muted">{m.adr_source()}</dt>
				<dd class="font-mono">{data.airdrop.sourceSymbol ?? data.airdrop.sourceName ?? data.airdrop.sourceCategoryHex.slice(0, 16) + '…'}</dd>
			</div>
			<div>
				<dt class="text-xs uppercase tracking-wider ts-text-muted">{m.adr_recipients_of()}</dt>
				<dd class="font-mono">{data.airdrop.recipientSymbol ?? data.airdrop.recipientName ?? data.airdrop.recipientCategoryHex.slice(0, 16) + '…'}</dd>
			</div>
			<div>
				<dt class="text-xs uppercase tracking-wider ts-text-muted">{m.adr_total_sent()}</dt>
				<dd class="font-mono">{formatBaseUnits(data.airdrop.totalAmount, data.airdrop.sourceDecimals)} {data.airdrop.sourceSymbol ?? ''}</dd>
			</div>
			<div>
				<dt class="text-xs uppercase tracking-wider ts-text-muted">{m.adr_recipients()}</dt>
				<dd class="font-mono">{data.airdrop.holderCount}</dd>
			</div>
			<div>
				<dt class="text-xs uppercase tracking-wider ts-text-muted">{m.adr_mode()}</dt>
				<dd class="font-mono">{data.airdrop.mode}</dd>
			</div>
			<div>
				<dt class="text-xs uppercase tracking-wider ts-text-muted">{m.adr_bch_dust()}</dt>
				<dd class="font-mono">{data.airdrop.outputValueSats} sats</dd>
			</div>
			<div>
				<dt class="text-xs uppercase tracking-wider ts-text-muted">{m.adr_created()}</dt>
				<dd class="font-mono">{new Date(data.airdrop.createdAt).toUTCString()}</dd>
			</div>
			<div>
				<dt class="text-xs uppercase tracking-wider ts-text-muted">{m.adr_holder_snapshot()}</dt>
				<dd class="font-mono">{new Date(data.airdrop.holdersSnapshotAt).toUTCString()}</dd>
			</div>
		</dl>
	</section>

	<section class="rounded-xl border ts-border-subtle p-5 ts-surface-panel mb-6">
		<h2 class="text-lg font-semibold mb-3 ts-text-strong">{m.adr_txs_h2({ count: data.txs.length })}</h2>
		<table class="w-full text-sm">
			<thead class="text-xs font-semibold uppercase tracking-wider ts-text-muted border-b ts-border-subtle">
				<tr>
					<th class="text-left py-2">#</th>
					<th class="text-left py-2">{m.adr_tx_state()}</th>
					<th class="text-left py-2">TXID</th>
					<th class="text-left py-2">{m.adr_tx_note()}</th>
				</tr>
			</thead>
			<tbody>
				{#each data.txs as t (t.txIndex)}
					<tr class="border-b border-slate-100 dark:border-zinc-800/50 last:border-0">
						<td class="py-2 font-mono">{t.txIndex + 1}</td>
						<td class="py-2 font-mono text-xs">{t.state}</td>
						<td class="py-2 font-mono text-xs truncate max-w-xs">
							{#if t.txid}
								<a
									href={`https://explorer.salemkode.com/tx/${t.txid}`}
									target="_blank"
									rel="noopener noreferrer"
									class="text-violet-600 dark:text-violet-400 hover:underline"
								>{t.txid}</a>
							{:else}
								—
							{/if}
						</td>
						<td class="py-2 text-xs ts-text-muted">{t.failReason ?? ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>

	<section class="rounded-xl border ts-border-subtle p-5 ts-surface-panel">
		<h2 class="text-lg font-semibold mb-3 ts-text-strong">{m.adr_recipients_h2({ count: data.outputs.length })}</h2>
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead class="text-xs font-semibold uppercase tracking-wider ts-text-muted border-b ts-border-subtle">
					<tr>
						<th class="text-left py-2">{m.adr_recip_address()}</th>
						<th class="text-right py-2">{m.adr_recip_amount()}</th>
						<th class="text-right py-2">{m.adr_recip_tx()}</th>
						<th class="text-right py-2">{m.adr_recip_vout()}</th>
						<th class="text-right py-2">{m.adr_recip_state()}</th>
					</tr>
				</thead>
				<tbody>
					{#each data.outputs as o (o.recipientCashaddr)}
						<tr class="border-b border-slate-100 dark:border-zinc-800/50 last:border-0">
							<td class="py-2 font-mono text-xs truncate max-w-xs">{o.recipientCashaddr}</td>
							<td class="py-2 text-right font-mono">{formatBaseUnits(o.amount, data.airdrop.sourceDecimals)}</td>
							<td class="py-2 text-right font-mono">{o.txIndex + 1}</td>
							<td class="py-2 text-right font-mono">{o.voutIndex ?? '—'}</td>
							<td class="py-2 text-right font-mono text-xs">{o.state}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<div class="mt-8 flex items-center justify-between text-sm">
		<a href={localizeHref('/airdrops')} class="text-violet-600 dark:text-violet-400 hover:underline">← {m.adr_all_airdrops()}</a>
		<a href={localizeHref('/airdrops/new')} class="text-violet-600 dark:text-violet-400 hover:underline">{m.adl_new()} →</a>
	</div>
</div>
