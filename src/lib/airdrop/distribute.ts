// Airdrop split helpers — pure BigInt math, no I/O. Computes
// per-recipient amounts in base units of the source token from a total
// budget + a list of recipients. Two modes:
//
//   equal     — total / N (floor); leftover dust < N stays with sender.
//   weighted  — proportional to weight: amount_i = floor(total * w_i / Σw).
//
// Sender's own cashaddr is always filtered out before the split runs;
// the caller is responsible for populating `recipients` after that filter.
//
// Why floor + sender-keeps-dust:
// - All-BigInt math means no float drift, but division still loses up to
//   N-1 base units to truncation.
// - Distributing the truncation across "the first K recipients get +1"
//   would make the per-recipient amount depend on row order — surprising
//   and hard to verify against a snapshot. Sender keeping the dust is
//   predictable: total = sum(per-recipient) + leftover.

export interface Recipient {
	cashaddr: string;
	weight: bigint; // ignored in equal mode; required in weighted mode
}

export interface Allocation {
	cashaddr: string;
	amount: bigint;
}

export interface SplitResult {
	allocations: Allocation[];
	leftover: bigint; // base units that stay with sender (truncation residue)
}

/** Equal split. Each recipient receives `floor(total / N)`. Truncation
 *  residue is returned in `leftover`. Throws if recipients is empty —
 *  caller should not invoke with an empty list. */
export function equalSplit(total: bigint, recipients: Recipient[]): SplitResult {
	if (recipients.length === 0) {
		throw new Error('equalSplit: empty recipient list');
	}
	if (total < 0n) {
		throw new Error('equalSplit: negative total');
	}
	const n = BigInt(recipients.length);
	const each = total / n;
	const leftover = total - each * n;
	const allocations: Allocation[] = recipients.map((r) => ({
		cashaddr: r.cashaddr,
		amount: each
	}));
	return { allocations, leftover };
}

/** Weighted split. Each recipient receives `floor(total * weight_i / Σweight)`.
 *  Truncation residue is returned in `leftover`. Recipients with weight 0
 *  still appear in the allocation list but with amount 0 — caller can
 *  filter them out before persisting if desired. Throws on empty list or
 *  zero total weight (the latter would be a degenerate "everyone gets 0"
 *  case that's better surfaced as an error than silently returning all-zero). */
export function weightedSplit(total: bigint, recipients: Recipient[]): SplitResult {
	if (recipients.length === 0) {
		throw new Error('weightedSplit: empty recipient list');
	}
	if (total < 0n) {
		throw new Error('weightedSplit: negative total');
	}
	let sumWeights = 0n;
	for (const r of recipients) {
		if (r.weight < 0n) {
			throw new Error('weightedSplit: negative weight');
		}
		sumWeights += r.weight;
	}
	if (sumWeights === 0n) {
		throw new Error('weightedSplit: total weight is zero');
	}
	let distributed = 0n;
	const allocations: Allocation[] = recipients.map((r) => {
		const amount = (total * r.weight) / sumWeights;
		distributed += amount;
		return { cashaddr: r.cashaddr, amount };
	});
	return { allocations, leftover: total - distributed };
}
