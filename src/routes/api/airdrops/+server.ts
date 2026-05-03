// POST /api/airdrops
//
// Auth-gated, rate-limited (1 airdrop / 15 min / cashaddr). Validates
// eligibility (sender holds source token), fetches the recipient list
// from token_holders, computes per-recipient amounts (equal or
// weighted), pulls the sender's UTXOs from local BlockBook, builds N
// unsigned chunks via libauth, persists airdrops + airdrop_txs +
// airdrop_outputs, returns the unsigned hex blobs to the wizard.
//
// The wizard signs each chunk in sequence and POSTs the signed hex to
// `/api/airdrops/<id>/broadcast`.

import { json, error } from '@sveltejs/kit';
import { categoryFromHex } from '$lib/server/db';
import { clientIp } from '$lib/server/clientIp';
import { airdropDraftRateLimiter } from '$lib/server/rateLimit';
import {
	createDraft,
	eligibilityFor,
	holderListFor,
	holderSnapshotFor,
	isCategoryModerated,
	stripCashaddrPrefix
} from '$lib/server/airdrops';
import {
	equalSplit,
	weightedSplit,
	type Recipient
} from '$lib/airdrop/distribute';
import {
	buildAirdropChunk,
	DEFAULT_AIRDROP_OUTPUT_SATS,
	MAX_RECIPIENTS_PER_CHUNK,
	MIN_AIRDROP_OUTPUT_SATS,
	MAX_AIRDROP_OUTPUT_SATS,
	AirdropBuildError
} from '$lib/server/airdropBuilder';
import { fetchWalletUtxos } from '$lib/server/walletUtxos';
import type { RequestHandler } from './$types';

interface PostBody {
	sourceCategory?: unknown;
	recipientCategory?: unknown;
	mode?: unknown;
	totalAmount?: unknown; // string (BigInt-safe)
	outputValueSats?: unknown;
}

export const POST: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user) error(401, 'Wallet sign-in required');
	const senderCashaddr = locals.user.cashaddr;

	// Per-cashaddr rate limit FIRST (cheap, no DB writes).
	const cashaddrRl = airdropDraftRateLimiter.consume(senderCashaddr);
	if (!cashaddrRl.allowed) {
		const retryAfter = Math.ceil((cashaddrRl.retryAfterMs ?? 0) / 1000);
		error(429, `Wait ${retryAfter}s before drafting another airdrop`);
	}
	// Per-IP cap as defense against rotated cashaddrs.
	const ip = clientIp({ request, getClientAddress });
	const ipRl = airdropDraftRateLimiter.consume(`ip:${ip}`);
	if (!ipRl.allowed) {
		const retryAfter = Math.ceil((ipRl.retryAfterMs ?? 0) / 1000);
		error(429, `too many airdrop drafts from this address; try again in ${retryAfter}s`);
	}

	let body: PostBody;
	try {
		body = (await request.json()) as PostBody;
	} catch {
		error(400, 'Body must be JSON');
	}

	const sourceCategoryHex = stringField(body.sourceCategory, 'sourceCategory');
	const recipientCategoryHex = stringField(body.recipientCategory, 'recipientCategory');
	const mode = stringField(body.mode, 'mode');
	if (mode !== 'equal' && mode !== 'weighted') {
		error(400, 'mode must be "equal" or "weighted"');
	}
	const totalAmount = bigintField(body.totalAmount, 'totalAmount');
	if (totalAmount <= 0n) error(400, 'totalAmount must be > 0');

	const outputValueSats = body.outputValueSats == null
		? DEFAULT_AIRDROP_OUTPUT_SATS
		: numberField(body.outputValueSats, 'outputValueSats');
	if (
		outputValueSats < MIN_AIRDROP_OUTPUT_SATS ||
		outputValueSats > MAX_AIRDROP_OUTPUT_SATS
	) {
		error(
			400,
			`outputValueSats must be ${MIN_AIRDROP_OUTPUT_SATS}..${MAX_AIRDROP_OUTPUT_SATS}`
		);
	}

	let sourceCategoryBytes: Buffer;
	let recipientCategoryBytes: Buffer;
	try {
		sourceCategoryBytes = categoryFromHex(sourceCategoryHex);
		recipientCategoryBytes = categoryFromHex(recipientCategoryHex);
	} catch {
		error(400, 'invalid category hex');
	}

	// Moderation gate. Airdrops refuse to operate on a moderated source
	// (we won't help redistribute hidden tokens) or recipient (we won't
	// help target a moderated holder set). Both checks fire before the
	// eligibility / holder-list reads, since those would 410 anyway but
	// with a less specific message.
	const [sourceMod, recipMod] = await Promise.all([
		isCategoryModerated(sourceCategoryBytes),
		isCategoryModerated(recipientCategoryBytes)
	]);
	if (sourceMod) error(410, 'Source token is moderated; airdrop unavailable');
	if (recipMod) error(410, 'Recipient token is moderated; airdrop unavailable');

	// Eligibility: sender must hold the source token.
	const eligibility = await eligibilityFor(senderCashaddr, sourceCategoryBytes);
	if (!eligibility) {
		error(410, "You don't currently hold this token; airdrop unavailable");
	}

	// Build the recipient list from token_holders for the recipient
	// category. Filter out the sender's own cashaddr (in either format).
	const holders = await holderListFor(recipientCategoryBytes);
	const senderBare = stripCashaddrPrefix(senderCashaddr);
	const filteredHolders = holders.filter((h) => h.address !== senderBare);
	if (filteredHolders.length === 0) {
		error(410, 'Recipient set is empty after filtering — token has no other holders');
	}

	// Snapshot freshness: capture the latest snapshot_at for the
	// recipient category. Re-checked at every broadcast.
	const snapshotAt = await holderSnapshotFor(recipientCategoryBytes);
	if (!snapshotAt) {
		error(410, 'No holder snapshot available for the recipient category');
	}

	// Compute per-recipient amounts.
	// Weighted uses balance + nft_count as the weight (every NFT counts
	// as one weight unit; every base unit of FT counts the same; this
	// keeps NFT-only collectors visible). Equal mode ignores weight.
	const recipients: Recipient[] = filteredHolders.map((h) => ({
		cashaddr: h.address,
		weight: h.balance + BigInt(h.nftCount)
	}));
	let split;
	try {
		split = mode === 'equal'
			? equalSplit(totalAmount, recipients)
			: weightedSplit(totalAmount, recipients);
	} catch (err) {
		error(400, (err as Error).message);
	}

	// Drop allocations that round to zero (weighted mode common case for
	// tiny weights). This keeps tx size + dust from blowing up on
	// vanishingly small holders.
	const filteredAllocations = split.allocations.filter((a) => a.amount > 0n);
	const filteredOutCount = split.allocations.length - filteredAllocations.length;
	if (filteredAllocations.length === 0) {
		error(400, 'No recipient receives a non-zero amount; increase totalAmount');
	}

	// Sort allocations by cashaddr ASC. This makes the build-time tx
	// output order match the DB read-back order from `listOutputsFor`
	// (which `ORDER BY recipient_cashaddr ASC`), so the broadcast
	// endpoint's voutMap = 1+i lines up with the actual on-chain vout.
	// Without this sort, recipients ordered by balance DESC at build
	// time get attributed to alphabetically-sorted vout slots — DB
	// metadata diverges from on-chain reality.
	const allocations = filteredAllocations.sort((a, b) =>
		a.cashaddr < b.cashaddr ? -1 : a.cashaddr > b.cashaddr ? 1 : 0
	);

	// Sender's eligibility balance must cover totalAmount in base units.
	if (BigInt(eligibility.balance) < totalAmount) {
		error(
			400,
			`totalAmount ${totalAmount} exceeds your balance ${eligibility.balance}`
		);
	}

	// Chunk into ≤ MAX_RECIPIENTS_PER_CHUNK groups.
	const txCount = Math.ceil(allocations.length / MAX_RECIPIENTS_PER_CHUNK);
	const chunks: Array<typeof allocations> = [];
	for (let i = 0; i < txCount; i++) {
		chunks.push(
			allocations.slice(
				i * MAX_RECIPIENTS_PER_CHUNK,
				(i + 1) * MAX_RECIPIENTS_PER_CHUNK
			)
		);
	}

	// Fetch sender UTXOs from local BlockBook.
	let walletUtxos;
	try {
		walletUtxos = await fetchWalletUtxos(senderCashaddr);
	} catch (err) {
		console.error('[api/airdrops] BlockBook fetch failed:', (err as Error).message);
		error(503, 'UTXO fetch failed; try again in a moment');
	}

	// Build all chunks UP FRONT against the same UTXO snapshot. The
	// chunk-K builder pretends chunk K-1's outputs already exist (we
	// chain change-UTXOs in memory) — but actually a simpler approach
	// is to just rebuild chunk K against the BlockBook snapshot AT
	// CHUNK K's BROADCAST TIME (in /broadcast endpoint). For draft
	// time, we build chunk 0 only and the wizard re-fetches per chunk.
	//
	// V1 simplification: build only chunk 0 here. The /broadcast
	// endpoint rebuilds chunk K+1 just-in-time after K confirms. This
	// keeps the draft cheap and lets us re-resolve UTXOs against the
	// current chain state for each chunk.
	let firstChunkBuild;
	try {
		firstChunkBuild = buildAirdropChunk({
			airdropId: '00000000-0000-0000-0000-000000000000', // placeholder; rewritten after insert
			senderCashaddr,
			sourceCategoryHex,
			recipients: chunks[0].map((a) => ({
				cashaddr: a.cashaddr,
				amountBaseUnits: a.amount
			})),
			availableTokenUtxos: walletUtxos,
			availableBchUtxos: walletUtxos,
			outputValueSats
		});
	} catch (err) {
		if (err instanceof AirdropBuildError) error(400, err.message);
		throw err;
	}

	// Insert the airdrop record + child rows. The partial unique index
	// `airdrops_one_drafting_per_sender_idx` will throw if the user has
	// another draft in flight.
	const airdropId = await createDraft({
		senderCashaddr,
		sourceCategory: sourceCategoryBytes,
		recipientCategory: recipientCategoryBytes,
		mode: mode as 'equal' | 'weighted',
		totalAmount,
		outputValueSats,
		holdersSnapshotAt: snapshotAt,
		allocations: allocations.map((a, i) => ({
			cashaddr: a.cashaddr,
			amount: a.amount,
			txIndex: Math.floor(i / MAX_RECIPIENTS_PER_CHUNK)
		})),
		txCount
	}).catch((err: Error & { code?: string }) => {
		if (err.code === '23505') {
			// unique_violation on partial index → another draft in flight
			error(
				409,
				'You already have an airdrop draft in progress; finish or cancel it first'
			);
		}
		throw err;
	});

	// Now rebuild chunk 0 with the real airdropId so the OP_RETURN
	// audit prefix carries the correct id. Cheap — no DB I/O.
	const finalFirstChunk = buildAirdropChunk({
		airdropId,
		senderCashaddr,
		sourceCategoryHex,
		recipients: chunks[0].map((a) => ({
			cashaddr: a.cashaddr,
			amountBaseUnits: a.amount
		})),
		availableTokenUtxos: walletUtxos,
		availableBchUtxos: walletUtxos,
		outputValueSats
	});

	return json({
		airdropId,
		txCount,
		holderCount: allocations.length,
		// Truncation residue from the split (in source-token base units).
		// Stays with the sender — the math is `floor(...)` so this is
		// at most `holderCount - 1` base units in equal mode and ≤ N in
		// weighted mode. Surfaced so the wizard can show "X of your
		// total stays in your wallet due to integer-division rounding."
		splitLeftover: split.leftover.toString(),
		// Number of recipients dropped because their weighted-share
		// rounded to 0n. Common in weighted mode for tiny holders.
		filteredOutCount,
		// First chunk's unsigned hex; the wizard signs and broadcasts,
		// then asks /broadcast (which rebuilds K+1 just-in-time) for
		// the next.
		firstChunk: {
			txIndex: 0,
			unsignedTxHex: finalFirstChunk.unsignedTxHex,
			sourceOutputs: finalFirstChunk.sourceOutputs,
			feeSats: finalFirstChunk.feeSats,
			recipientCount: chunks[0].length,
			encodedTxBytes: finalFirstChunk.encodedTxBytes
		}
	});
};

// --- helpers -------------------------------------------------------

function stringField(v: unknown, name: string): string {
	if (typeof v !== 'string' || v.length === 0) {
		error(400, `${name} (string) is required`);
	}
	return v;
}

function bigintField(v: unknown, name: string): bigint {
	if (typeof v === 'string') {
		try {
			const n = BigInt(v);
			return n;
		} catch {
			error(400, `${name} must be a base-10 integer string`);
		}
	}
	if (typeof v === 'number' && Number.isInteger(v)) {
		return BigInt(v);
	}
	error(400, `${name} must be a base-10 integer string`);
}

function numberField(v: unknown, name: string): number {
	if (typeof v === 'number' && Number.isInteger(v)) return v;
	if (typeof v === 'string') {
		const n = Number(v);
		if (Number.isInteger(n)) return n;
	}
	error(400, `${name} must be an integer`);
}
