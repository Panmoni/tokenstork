// /airdrops/[id] — receipt page. Same shape as the API endpoint at
// /api/airdrops/[id]; loads server-side for SSR + initial paint.

import { error, redirect } from '@sveltejs/kit';
import {
	getById,
	listOutputsFor,
	listTxsFor
} from '$lib/server/airdrops';
import { hexFromBytes, query } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.user) {
		throw redirect(303, `/login?return=${encodeURIComponent(url.pathname)}`);
	}
	const airdropId = params.id;
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(airdropId)) {
		error(404, 'airdrop not found');
	}

	const airdrop = await getById(airdropId);
	if (!airdrop) error(404, 'airdrop not found');
	if (airdrop.sender_cashaddr !== locals.user.cashaddr) {
		error(403, 'not your airdrop');
	}

	const [txs, outputs] = await Promise.all([
		listTxsFor(airdropId),
		listOutputsFor(airdropId)
	]);

	const sourceHex = hexFromBytes(airdrop.source_category) ?? '';
	const recipientHex = hexFromBytes(airdrop.recipient_category) ?? '';
	// BCMR display fields come from the cached token_metadata rows the
	// on-chain walker populates. No live HTTP call.
	const metaRes = await query<{
		category: Buffer;
		name: string | null;
		symbol: string | null;
		decimals: number | null;
	}>(
		`SELECT category, name, symbol, decimals
		   FROM token_metadata
		  WHERE category = ANY($1::bytea[])`,
		[[airdrop.source_category, airdrop.recipient_category]]
	);
	const metaByHex = new Map<string, { name: string | null; symbol: string | null; decimals: number | null }>();
	for (const m of metaRes.rows) {
		const h = hexFromBytes(m.category);
		if (h) metaByHex.set(h, { name: m.name, symbol: m.symbol, decimals: m.decimals });
	}
	const sourceBcmr = metaByHex.get(sourceHex) ?? null;
	const recipientBcmr = metaByHex.get(recipientHex) ?? null;

	return {
		airdrop: {
			id: airdrop.id,
			sourceCategoryHex: sourceHex,
			sourceName: sourceBcmr?.name ?? null,
			sourceSymbol: sourceBcmr?.symbol ?? null,
			sourceDecimals: sourceBcmr?.decimals ?? 0,
			recipientCategoryHex: recipientHex,
			recipientName: recipientBcmr?.name ?? null,
			recipientSymbol: recipientBcmr?.symbol ?? null,
			mode: airdrop.mode,
			totalAmount: airdrop.total_amount,
			holderCount: airdrop.holder_count,
			outputValueSats: airdrop.output_value_sats,
			holdersSnapshotAt: airdrop.holders_snapshot_at,
			state: airdrop.state,
			txCount: airdrop.tx_count,
			createdAt: airdrop.created_at,
			updatedAt: airdrop.updated_at
		},
		txs: txs.map((t) => ({
			txIndex: t.tx_index,
			txid: hexFromBytes(t.txid),
			state: t.state,
			failReason: t.fail_reason
		})),
		outputs: outputs.map((o) => ({
			recipientCashaddr: o.recipient_cashaddr,
			amount: o.amount,
			txIndex: o.tx_index,
			voutIndex: o.vout_index,
			state: o.state
		}))
	};
};
