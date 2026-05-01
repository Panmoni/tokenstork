// POST /api/tokens/[category]/vote — auth-gated. Sets the caller's vote
// for the given token. Body shape:
//   { vote: 'up' | 'down' | null }
// where null retracts an existing vote. Returns the post-write user
// state plus the updated public counts so the UI can update both
// without a follow-up call.
//
//   200 { vote, upCount, downCount }   on success
//   401                                 if no authenticated session
//   400                                 if body / category malformed
//   404                                 if the category doesn't exist

import { error, json } from '@sveltejs/kit';
import {
	setVote,
	VoteCooldownError,
	VoteRejectedError,
	VoteQuotaError,
	type VoteState
} from '$lib/server/votes';
import type { RequestHandler } from './$types';

const HEX_CATEGORY_RE = /^[0-9a-fA-F]{64}$/;

export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) {
		throw error(401, 'sign in required');
	}

	const cat = params.category;
	if (!cat || !HEX_CATEGORY_RE.test(cat)) {
		throw error(400, 'category must be a 64-char hex string');
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid JSON');
	}
	if (typeof body !== 'object' || body === null) {
		throw error(400, 'expected JSON object body');
	}
	const rawVote = (body as { vote?: unknown }).vote;
	let vote: VoteState;
	if (rawVote === 'up' || rawVote === 'down') {
		vote = rawVote;
	} else if (rawVote === null) {
		vote = null;
	} else {
		throw error(400, "vote must be 'up', 'down', or null");
	}

	const categoryBytes = Buffer.from(cat.toLowerCase(), 'hex');
	try {
		const result = await setVote(locals.user.cashaddr, categoryBytes, vote);
		return json(result);
	} catch (err) {
		// Daily-quota exhausted — 429 with a clear hint that it resets at
		// 00:00 UTC. The transaction rollback already undid the increment
		// that triggered this, so a 429 doesn't burn any more budget.
		if (err instanceof VoteQuotaError) {
			throw error(429, 'daily vote limit reached — try again tomorrow (UTC)');
		}
		// Per-(wallet, category) churn cooldown — same vote target was
		// flipped within PER_TARGET_COOLDOWN_MS. Surfaces as 429 with the
		// retry-after hint embedded in the message; the cooldown gate
		// rolled back before any quota was consumed.
		if (err instanceof VoteCooldownError) {
			throw error(
				429,
				`please wait ${err.retryAfterSeconds}s before voting on this token again`
			);
		}
		// setVote rejected the cast — token is missing from `tokens` or is
		// moderation-hidden. 410 Gone matches the per-token detail page's
		// behaviour for moderated tokens; 404 would suggest the URL was
		// invalid, which it isn't.
		if (err instanceof VoteRejectedError) {
			throw error(410, 'this token is not eligible for voting');
		}
		// Defensive fallback for FK violations the conditional INSERT
		// shouldn't surface (the WHERE EXISTS already filters), but
		// keep the translation in case a future setVote variant uses a
		// path that does hit a raw FK error.
		if (err && typeof err === 'object' && 'code' in err && err.code === '23503') {
			throw error(404, 'unknown token category');
		}
		throw err;
	}
};
