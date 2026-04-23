// POST /api/tokens/<category_hex>/report
//
// Public endpoint that accepts user reports of problematic tokens, persists
// them to `token_reports`, and kicks off a best-effort webhook alert to the
// operator. See docs/moderation-runbook.md (gitignored) for triage.

import { error, isHttpError, json } from '@sveltejs/kit';
import { bytesFromHex, query } from '$lib/server/db';
import { dispatchReportAlert } from '$lib/server/reportAlert';
import { REPORT_REASONS_SET } from '$lib/moderation';
import type { RequestHandler } from './$types';

const HEX_REGEX = /^[0-9a-fA-F]{64}$/;

const MAX_DETAILS_LEN = 2000;
const MAX_EMAIL_LEN = 200;

// Rate-limit windows. Module-scope Map keyed by `ip:<addr>` or
// `cat:<hex>` → array of submission timestamps (ms). On each request we
// prune stale entries and reject if the remaining count hits the cap.
//
// In-memory, per-process. Resets on `tokenstork.service` restart, which
// is rare and operationally fine for v1. If we ever run more than one
// SvelteKit instance, back this with Redis.
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_PER_IP = 5;
const RATE_LIMIT_PER_CATEGORY = 10;

const rateBuckets: Map<string, number[]> = new Map();

// Periodic pruner. checkRateLimit() only trims timestamps within a key
// when that key is accessed, so a one-shot attacker rotating through many
// distinct IPs would leave a key-per-IP in the map forever. This walks the
// map every 30 min and removes keys whose timestamps have all aged out.
// `.unref()` so the interval doesn't keep the event loop alive at
// shutdown — the whole map is in-memory anyway and discarded on restart.
//
// `globalThis` guard so hot-reload in dev doesn't stack new intervals on
// every module re-eval. The interval handle is stashed on a Symbol'd
// global key so subsequent evals clear the previous one.
const PRUNER_KEY = Symbol.for('tokenstork.reportRateLimitPruner');
type PrunerGlobal = typeof globalThis & { [PRUNER_KEY]?: NodeJS.Timeout };
{
	const g = globalThis as PrunerGlobal;
	if (g[PRUNER_KEY]) clearInterval(g[PRUNER_KEY]);
	const handle: NodeJS.Timeout = setInterval(() => {
		const cutoff = Date.now() - RATE_WINDOW_MS;
		for (const [key, timestamps] of rateBuckets) {
			const fresh = timestamps.filter((ts) => ts > cutoff);
			if (fresh.length === 0) rateBuckets.delete(key);
			else if (fresh.length !== timestamps.length) rateBuckets.set(key, fresh);
		}
	}, 30 * 60 * 1000);
	handle.unref?.();
	g[PRUNER_KEY] = handle;
}

function checkRateLimit(key: string, cap: number): boolean {
	const now = Date.now();
	const cutoff = now - RATE_WINDOW_MS;
	const current = (rateBuckets.get(key) ?? []).filter((ts) => ts > cutoff);
	if (current.length >= cap) {
		rateBuckets.set(key, current);
		return false;
	}
	current.push(now);
	rateBuckets.set(key, current);
	return true;
}

function clientIp(request: Request, getClientAddress: () => string): string {
	// Behind Cloudflare on carson, so prefer CF-Connecting-IP; fall back
	// through the standard forwarded-for chain; finally SvelteKit's own
	// getClientAddress(). No header is trusted enough to authenticate on,
	// but they're all fine for rate-limit bucketing.
	const cf = request.headers.get('cf-connecting-ip');
	if (cf) return cf.trim();
	const xff = request.headers.get('x-forwarded-for');
	if (xff) return xff.split(',')[0].trim();
	try {
		return getClientAddress();
	} catch {
		return 'unknown';
	}
}

export const POST: RequestHandler = async ({ params, request, getClientAddress }) => {
	const category = params.category;
	if (!category || !HEX_REGEX.test(category)) {
		error(400, 'invalid category (expected 64 hex chars)');
	}

	// Body parse — be strict. Limit raw payload size well under anything
	// that'd matter; the server-side enforced caps (2000 details, 200 email)
	// are the real guardrails.
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'body must be valid JSON');
	}
	if (!body || typeof body !== 'object') {
		error(400, 'body must be a JSON object');
	}
	const { reason, details, reporter_email: reporterEmail } = body as {
		reason?: unknown;
		details?: unknown;
		reporter_email?: unknown;
	};
	if (typeof reason !== 'string' || !REPORT_REASONS_SET.has(reason)) {
		error(400, 'invalid reason');
	}
	if (details !== undefined && details !== null) {
		if (typeof details !== 'string') error(400, 'details must be a string');
		if (details.length > MAX_DETAILS_LEN)
			error(400, `details must be at most ${MAX_DETAILS_LEN} characters`);
	}
	if (reporterEmail !== undefined && reporterEmail !== null) {
		if (typeof reporterEmail !== 'string')
			error(400, 'reporter_email must be a string');
		if (reporterEmail.length > MAX_EMAIL_LEN)
			error(400, `reporter_email must be at most ${MAX_EMAIL_LEN} characters`);
	}

	const ip = clientIp(request, getClientAddress);

	// Rate-limit in two buckets. Per-IP first so a noisy visitor doesn't
	// consume a category's quota; per-category second so a hundred
	// coordinated IPs can't flood a single token either.
	if (!checkRateLimit(`ip:${ip}`, RATE_LIMIT_PER_IP)) {
		error(429, 'too many reports from this address; please try again later');
	}
	if (!checkRateLimit(`cat:${category.toLowerCase()}`, RATE_LIMIT_PER_CATEGORY)) {
		error(429, 'this token has been reported many times recently; the operator has been notified');
	}

	const categoryBytes = bytesFromHex(category);

	try {
		// Existence + moderation guard. Collapse both checks into one round-
		// trip: the endpoint replies 404 if the category doesn't exist at all
		// and 410 if it's already moderated. Both responses look identical to
		// a client that doesn't differentiate, but 410 specifically signals
		// "we already know" to any observant reporter.
		//
		// `category_exists` (not `exists`) as the column alias because `exists`
		// is a reserved keyword in Postgres — valid as an unquoted alias in
		// modern versions but fragile across clients / future releases.
		const existsRes = await query<{ hidden: boolean; category_exists: boolean }>(
			`SELECT EXISTS (SELECT 1 FROM token_moderation mod WHERE mod.category = $1) AS hidden,
			        EXISTS (SELECT 1 FROM tokens t WHERE t.category = $1)               AS category_exists`,
			[categoryBytes]
		);
		const row = existsRes.rows[0];
		if (!row?.category_exists) error(404, 'token not found');
		if (row.hidden) error(410, 'this token has already been hidden');

		// Optional metadata lookup for the webhook payload. Best-effort —
		// if metadata is missing we still record the report.
		const metaRes = await query<{ name: string | null; symbol: string | null }>(
			`SELECT m.name, m.symbol FROM token_metadata m WHERE m.category = $1`,
			[categoryBytes]
		);
		const meta = metaRes.rows[0] ?? { name: null, symbol: null };

		// Persist. Returning the id so the alert can reference it.
		const trimmedDetails =
			typeof details === 'string' && details.trim().length > 0
				? details.trim()
				: null;
		const trimmedEmail =
			typeof reporterEmail === 'string' && reporterEmail.trim().length > 0
				? reporterEmail.trim()
				: null;

		// `NULLIF(..., 'unknown')::inet`: the clientIp() fallback returns the
		// literal string 'unknown' when none of the three extraction paths
		// yielded anything, and Postgres's INET type rejects that string with
		// a syntax error (which would 500 the report). Coerce the sentinel
		// to NULL so the INSERT succeeds with a null reporter_ip instead.
		const insertRes = await query<{ id: string }>(
			`INSERT INTO token_reports
			    (category, reason, details, reporter_email, reporter_ip)
			 VALUES ($1, $2, $3, $4, NULLIF($5, 'unknown')::inet)
			 RETURNING id`,
			[categoryBytes, reason, trimmedDetails, trimmedEmail, ip]
		);
		const reportId = Number(insertRes.rows[0]?.id);

		// Fire-and-forget alert. The DB insert above is the durable record;
		// alert dispatch failure is logged but doesn't bubble to the user.
		// `void` ensures we don't accidentally await and hold the response.
		void dispatchReportAlert({
			reportId,
			category: category.toLowerCase(),
			tokenName: meta.name,
			tokenSymbol: meta.symbol,
			reason,
			details: trimmedDetails,
			reporterEmail: trimmedEmail
		});

		// 204 No Content — don't confirm the row id or content back to the
		// caller, so the endpoint can't be used as a side-channel oracle.
		return new Response(null, { status: 204 });
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[api/tokens/[category]/report] insert failed:', err);
		error(500, 'could not record report');
	}
};

// Explicit response for non-POST methods so SvelteKit's default 404 isn't
// mistaken for "endpoint not implemented". Keeps the shape predictable for
// anyone poking around with curl.
export const GET: RequestHandler = () => json({ method: 'POST only' }, { status: 405 });
