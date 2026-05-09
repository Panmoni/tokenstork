// POST /api/airdrops/[id]/broadcast
//
// Body: { txIndex: number, signedHex: string }
//
// Forwards the signed hex to BCHN, marks airdrop_txs[tx_index] as
// broadcast (or failed), updates airdrop_outputs.vout_index +
// state for that chunk, recomputes the parent airdrop's state.
//
// Re-builds chunk K+1 just-in-time AFTER chunk K succeeds and returns
// it in the response so the wizard can immediately advance to the
// next signature without an extra round trip. This is also where we
// re-check the holder snapshot — if `sync-enrich` has run between
// chunks, we halt and surface the change.
//
// Auth-gated; ownership-checked (sender_cashaddr must match the
// authenticated session).

import { json, error, isHttpError } from '@sveltejs/kit';
import { sendRawTransaction } from '$lib/server/bchn';
import {
	getById,
	listOutputsFor,
	listTxsFor,
	markTxResult,
	MarkTxStateConflictError,
	markRemainingTxsSnapshotHalted,
	recomputeAirdropState,
	holderSnapshotFor
} from '$lib/server/airdrops';
import {
	buildAirdropChunk,
	MAX_RECIPIENTS_PER_CHUNK,
	AirdropBuildError
} from '$lib/server/airdropBuilder';
import { fetchWalletUtxos, type WalletUtxo } from '$lib/server/walletUtxos';
import { hexFromBytes } from '$lib/server/db';
import type { RequestHandler } from './$types';

interface PostBody {
	txIndex?: unknown;
	signedHex?: unknown;
}

export const POST: RequestHandler = async ({ locals, request, params }) => {
	if (!locals.user) error(401, 'Wallet sign-in required');
	const senderCashaddr = locals.user.cashaddr;
	const airdropId = params.id;
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(airdropId)) {
		error(400, 'invalid airdrop id');
	}

	const airdrop = await getById(airdropId);
	if (!airdrop) error(404, 'airdrop not found');
	if (airdrop.sender_cashaddr !== senderCashaddr) error(403, 'not your airdrop');
	if (airdrop.state === 'complete' || airdrop.state === 'failed') {
		error(409, `airdrop already ${airdrop.state}`);
	}

	let body: PostBody;
	try {
		body = (await request.json()) as PostBody;
	} catch {
		error(400, 'Body must be JSON');
	}

	const txIndex = numberField(body.txIndex, 'txIndex');
	const signedHex = stringField(body.signedHex, 'signedHex');
	if (!/^[0-9a-fA-F]+$/.test(signedHex) || signedHex.length % 2 !== 0) {
		error(400, 'signedHex must be even-length hex');
	}
	if (signedHex.length > 200_000) error(400, 'signedHex exceeds 100 KB tx-size cap');
	if (txIndex < 0 || txIndex >= airdrop.tx_count) error(400, 'txIndex out of range');

	// Confirm this chunk hasn't already been broadcast.
	const txs = await listTxsFor(airdropId);
	const target = txs.find((t) => t.tx_index === txIndex);
	if (!target) error(500, 'airdrop_txs row missing for index');
	if (target.state === 'broadcast') error(409, 'chunk already broadcast');

	// Forward to BCHN.
	let txid: string;
	try {
		txid = await sendRawTransaction(signedHex);
	} catch (err) {
		if (isHttpError(err)) throw err;
		const e = err as Error & { code?: number };
		console.error('[api/airdrops/broadcast] BCHN error:', e.message, 'code=', e.code);
		// Persist the failure so the receipt page can surface it +
		// offer retry.
		await markTxResult(airdropId, txIndex, { error: e.message ?? 'BCHN rejected' });
		const newState = await recomputeAirdropState(airdropId);
		error(400, `BCHN rejected: ${e.message ?? 'unknown'} (state=${newState})`);
	}

	// Build the (recipient_cashaddr → vout_index) map for this chunk.
	// Output layout: [0]=OP_RETURN, [1..N]=recipients, [N+1]=token-change,
	// [N+2]=BCH-change. Recipient at allocation-row offset i is at vout
	// 1+i within the chunk.
	const outputs = await listOutputsFor(airdropId);
	const chunkRecipients = outputs.filter((o) => o.tx_index === txIndex);
	const voutMap = new Map<string, number>();
	chunkRecipients.forEach((o, i) => voutMap.set(o.recipient_cashaddr, 1 + i));

	const txidBuf = Buffer.from(txid, 'hex');
	try {
		await markTxResult(airdropId, txIndex, { txid: txidBuf, voutMap });
	} catch (err) {
		if (err instanceof MarkTxStateConflictError) {
			// A concurrent broadcast for the same chunk already flipped the
			// row out of pending/signed. The tx WE just sent went to BCHN
			// (might or might not have been accepted depending on whether
			// the racing broadcast spent the same UTXOs). We must not
			// overwrite the canonical txid that the winning request
			// recorded. Surface the conflict so the wizard can re-fetch
			// state from the receipt page.
			console.warn('[api/airdrops/broadcast] mark-tx race', {
				airdropId,
				txIndex,
				attemptedTxid: txid
			});
			error(409, 'Concurrent broadcast detected for this chunk; refresh and check the receipt page');
		}
		throw err;
	}
	const newState = await recomputeAirdropState(airdropId);
	console.info('[api/airdrops/broadcast] success', {
		airdropId,
		txIndex,
		txid,
		sender: senderCashaddr,
		recipientCount: chunkRecipients.length,
		newState
	});

	// Build the next chunk's unsigned hex if there is one. Re-check
	// snapshot freshness — if sync-enrich ran between chunks, the
	// recipient set may have shifted; we halt rather than send to
	// possibly-stale targets.
	let nextChunk: NextChunkPayload | null = null;
	// Captures why a nextChunk build/UTXO-fetch failed so the wizard
	// can surface "next chunk failed; visit receipt page to retry"
	// instead of treating null as silent success.
	let nextChunkError: string | null = null;
	const nextIdx = txIndex + 1;
	if (nextIdx < airdrop.tx_count && newState !== 'failed') {
		const currentSnapshot = await holderSnapshotFor(airdrop.recipient_category);
		if (
			currentSnapshot &&
			currentSnapshot.getTime() > airdrop.holders_snapshot_at.getTime()
		) {
			// Snapshot moved — chunk K succeeded but K+1's recipients
			// may be stale. Mark all remaining chunks (and their
			// outputs) as failed with a snapshot-halt reason so the
			// parent state machine returns 'partial' honestly via
			// recomputeAirdropState. The receipt page now matches the
			// wizard's view.
			const halted = await markRemainingTxsSnapshotHalted(airdropId, nextIdx);
			const finalState = await recomputeAirdropState(airdropId);
			console.warn('[api/airdrops/broadcast] snapshot advanced mid-airdrop', {
				airdropId,
				oldSnapshot: airdrop.holders_snapshot_at,
				newSnapshot: currentSnapshot,
				haltedChunks: halted,
				finalState
			});
			return json({
				txid,
				newState: finalState,
				snapshotAdvanced: true,
				nextChunk: null,
				nextChunkError: null
			});
		}

		const allocsForNext = outputs.filter((o) => o.tx_index === nextIdx);
		if (allocsForNext.length === 0) error(500, 'no airdrop_outputs for next tx_index');

		const sourceHex = hexFromBytes(airdrop.source_category);
		if (!sourceHex) {
			console.error('[api/airdrops/broadcast] invalid source_category bytes', {
				airdropId
			});
			nextChunkError = 'internal: invalid source category';
		} else {
			let walletUtxos: WalletUtxo[] | null = null;
			try {
				walletUtxos = await fetchWalletUtxos(senderCashaddr);
			} catch (err) {
				console.warn('[api/airdrops/broadcast] BlockBook UTXO fetch failed', {
					airdropId,
					nextIdx,
					error: (err as Error).message
				});
				nextChunkError = 'utxo-fetch-failed';
			}
			if (walletUtxos) {
				try {
					const build = buildAirdropChunk({
						airdropId,
						senderCashaddr,
						sourceCategoryHex: sourceHex,
						recipients: allocsForNext.map((a) => ({
							cashaddr: a.recipient_cashaddr,
							amountBaseUnits: BigInt(a.amount)
						})),
						availableTokenUtxos: walletUtxos,
						availableBchUtxos: walletUtxos,
						outputValueSats: airdrop.output_value_sats
					});
					nextChunk = {
						txIndex: nextIdx,
						unsignedTxHex: build.unsignedTxHex,
						sourceOutputs: build.sourceOutputs,
						feeSats: build.feeSats,
						recipientCount: allocsForNext.length,
						encodedTxBytes: build.encodedTxBytes
					};
				} catch (err) {
					if (err instanceof AirdropBuildError) {
						console.warn('[api/airdrops/broadcast] next-chunk build failed', {
							airdropId,
							nextIdx,
							error: err.message
						});
						nextChunkError = `build-failed: ${err.message}`;
					} else {
						throw err;
					}
				}
			}
		}
	}

	return json({ txid, newState, nextChunk, nextChunkError });
};

interface NextChunkPayload {
	txIndex: number;
	unsignedTxHex: string;
	sourceOutputs: ReturnType<typeof buildAirdropChunk>['sourceOutputs'];
	feeSats: number;
	recipientCount: number;
	encodedTxBytes: number;
}

function stringField(v: unknown, name: string): string {
	if (typeof v !== 'string' || v.length === 0) error(400, `${name} required`);
	return v;
}

function numberField(v: unknown, name: string): number {
	if (typeof v === 'number' && Number.isInteger(v)) return v;
	if (typeof v === 'string') {
		const n = Number(v);
		if (Number.isInteger(n)) return n;
	}
	error(400, `${name} must be an integer`);
}
