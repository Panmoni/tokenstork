// POST /api/bcmr/sessions/[id]/submit-backup
//
// Idempotent — inserts a row into `bcmr_tokenstork_submissions` carrying
// the session's canonical bcmr_json and content_hash, in `pending`
// review state. The on-chain publication is INDEPENDENT of approval
// state; this endpoint only registers an opt-in for the tokenstork-
// hosted backup. Operator reviews via /admin/bcmr-submissions
// (out-of-band) and either approves (writes to filesystem for Caddy to
// serve) or rejects with a note.
//
// Preconditions: session has been canonicalized (content_hash present)
// AND the user has verified their own host (publication_verified_at
// present). Without those, there's nothing meaningful to back up.

import { json, error, isHttpError } from '@sveltejs/kit';
import { getSession } from '$lib/server/bcmrPublishSessions';
import { submitBackup } from '$lib/server/bcmrTokenstorkSubmissions';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Wallet sign-in required');
	const sessionId = params.id!;
	const session = await getSession(locals.user.cashaddr, sessionId);
	if (!session) error(404, 'Session not found');
	if (!session.contentHashHex) {
		error(409, 'Canonicalize the BCMR first (step 3)');
	}
	if (!session.publicationVerifiedAt) {
		error(409, 'Verify your own host first (step 4)');
	}
	if (!session.bcmrJson) {
		// content_hash without bcmr_json shouldn't happen — guards against
		// a partial-write state.
		error(500, 'Session inconsistent: content_hash set but bcmr_json missing');
	}

	try {
		const submission = await submitBackup({
			contentHashHex: session.contentHashHex,
			categoryHex: session.categoryHex,
			cashaddr: locals.user.cashaddr,
			jsonBody: session.bcmrJson
		});
		return json({
			ok: true,
			submission: {
				contentHashHex: submission.contentHashHex,
				reviewState: submission.reviewState,
				submittedAt: submission.submittedAt
			}
		});
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[api/bcmr/submit-backup] error:', err);
		error(500, 'Failed to submit backup');
	}
};
