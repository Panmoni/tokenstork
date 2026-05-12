// POST /api/bcmr/sessions/[id]/verify-uri
//
// Body: { publicationUri: string }
//
// Fetches the user-supplied URL via the SSRF-hardened bcmrFetch helper,
// computes sha256 of the body, compares against session.content_hash.
// On match: persists `publication_uri` + `publication_verified_at = now()`
// onto the session, returns ok=true. On mismatch / fetch error: returns
// ok=false with a precise reason but does NOT persist anything (the
// wizard surfaces the error inline and the user can retry).

import { json, error, isHttpError } from '@sveltejs/kit';
import { getSession, updateSession } from '$lib/server/bcmrPublishSessions';
import { fetchAndHashBcmr, BcmrFetchError } from '$lib/server/bcmrFetch';
import type { RequestHandler } from './$types';

interface PostBody {
	publicationUri?: unknown;
}

const MAX_URL_LEN = 2048;

export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) error(401, 'Wallet sign-in required');
	const sessionId = params.id!;
	const session = await getSession(locals.user.cashaddr, sessionId);
	if (!session) error(404, 'Session not found');
	if (session.state !== 'drafting') {
		error(409, `Session is in state '${session.state}'; can only verify drafts`);
	}
	if (!session.contentHashHex) {
		error(409, 'Run canonicalize first (step 3) before verifying a publication URL');
	}

	let body: PostBody;
	try {
		body = (await request.json()) as PostBody;
	} catch {
		error(400, 'Body must be JSON');
	}
	if (typeof body.publicationUri !== 'string') {
		error(400, 'publicationUri must be a string');
	}
	const url = body.publicationUri.trim();
	if (url.length === 0) error(400, 'publicationUri cannot be empty');
	if (url.length > MAX_URL_LEN) error(400, `publicationUri exceeds ${MAX_URL_LEN} chars`);

	// Fetch + hash. BcmrFetchError carries a precise `kind` we surface
	// to the wizard so the user knows whether to fix the URL, fix the
	// host, or just retry.
	let fetched: Awaited<ReturnType<typeof fetchAndHashBcmr>>;
	try {
		fetched = await fetchAndHashBcmr(url);
	} catch (err) {
		if (err instanceof BcmrFetchError) {
			return json({ ok: false, reason: err.kind, message: err.message }, { status: 200 });
		}
		console.error('[api/bcmr/verify-uri] unexpected error:', err);
		error(500, 'verify failed');
	}

	const expected = session.contentHashHex.toLowerCase();
	const observed = fetched.sha256Hex.toLowerCase();
	if (expected !== observed) {
		return json(
			{
				ok: false,
				reason: 'hash-mismatch',
				message: `Hosted file's sha256 doesn't match the canonical content hash`,
				expected,
				observed,
				sizeBytes: fetched.sizeBytes
			},
			{ status: 200 }
		);
	}

	// Match — persist. The wizard advances to step 5 on a successful
	// response.
	try {
		const updated = await updateSession(locals.user.cashaddr, sessionId, {
			publicationUri: url,
			publicationVerifiedAt: 'now'
		});
		if (!updated) error(409, 'Session changed during verify; reload and retry');
		return json({ ok: true, session: updated, sizeBytes: fetched.sizeBytes });
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[api/bcmr/verify-uri] persist error:', err);
		error(500, 'verify succeeded but persistence failed');
	}
};
