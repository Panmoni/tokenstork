// GET /api/airdrops/[id]
//
// Returns the full state of an airdrop: parent record + per-tx state
// + per-recipient outputs. Drives the receipt page's progress UI and
// the wizard's resume-after-reload flow.
//
// Auth-gated. Ownership-checked: only the sender sees their own
// airdrops.

import { json, error } from '@sveltejs/kit';
import {
	getById,
	listTxsFor,
	listOutputsFor
} from '$lib/server/airdrops';
import { hexFromBytes } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Wallet sign-in required');
	const airdropId = params.id;
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(airdropId)) {
		error(400, 'invalid airdrop id');
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

	return json({
		airdrop: {
			id: airdrop.id,
			senderCashaddr: airdrop.sender_cashaddr,
			sourceCategoryHex: hexFromBytes(airdrop.source_category),
			recipientCategoryHex: hexFromBytes(airdrop.recipient_category),
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
	});
};
