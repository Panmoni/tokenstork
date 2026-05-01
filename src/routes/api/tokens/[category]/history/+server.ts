// GET /api/tokens/<category_hex>/history — per-category price + TVL
// history for charting / spreadsheet export. Pulls every row of
// `token_price_history` for the category, sorted oldest-first.
//
// Output: JSON by default (with `points: [{ ts, venue, price_sats,
// tvl_satoshis }]`), or CSV if `?format=csv`. The CSV form is the
// natural pair of the long-horizon chart on /token/<cat>; users
// who want to drop the same series into a spreadsheet hit this URL.

import { error, isHttpError, json } from '@sveltejs/kit';
import { bytesFromHex, query } from '$lib/server/db';
import { NOT_MODERATED_CLAUSE } from '$lib/moderation';
import { clientIp } from '$lib/server/clientIp';
import { csvExportRateLimiter } from '$lib/server/rateLimit';
import type { RequestHandler } from './$types';

const HEX_REGEX = /^[0-9a-fA-F]{64}$/;

interface HistoryRow {
	ts: Date;
	venue: string;
	price_sats: number | null;
	tvl_satoshis: string | null;
}

interface HistoryPoint {
	ts: number; // unix seconds
	venue: string;
	priceSats: number | null;
	tvlSatoshis: string | null;
}

function csvCell(v: unknown): string {
	if (v == null) return '';
	const s = typeof v === 'string' ? v : String(v);
	return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const GET: RequestHandler = async ({
	params,
	url,
	request,
	getClientAddress,
	setHeaders
}) => {
	const category = params.category;
	if (!category || !HEX_REGEX.test(category)) {
		error(400, 'invalid category (expected 64 hex chars)');
	}

	const isCsv = url.searchParams.get('format') === 'csv';
	const venueParam = url.searchParams.get('venue');
	const venue = venueParam === 'cauldron' || venueParam === 'fex' ? venueParam : null;

	// Optional `?from=<unix-seconds>&to=<unix-seconds>` window. Defaults
	// to "all history" so existing scripts aren't broken; smart callers
	// (chart UI, last-N-days export) can scope. Negative / non-numeric
	// inputs silently fall through to no-filter rather than erroring,
	// matching the venue param's permissive posture.
	function parseUnixSec(raw: string | null): Date | null {
		if (!raw) return null;
		const n = Number(raw);
		if (!Number.isFinite(n) || n < 0) return null;
		return new Date(n * 1000);
	}
	const from = parseUnixSec(url.searchParams.get('from'));
	const to = parseUnixSec(url.searchParams.get('to'));

	if (isCsv) {
		const ip = clientIp({ request, getClientAddress });
		const rl = csvExportRateLimiter.consume(ip);
		if (!rl.allowed) {
			const retryAfter = Math.max(1, Math.ceil((rl.retryAfterMs ?? 60_000) / 1000));
			// Manual Response (not error()) so we can attach the
			// Retry-After header per RFC 7231 §6.6.4 — well-behaved
			// clients honour the header, not the message body.
			return new Response(
				JSON.stringify({ error: `rate limit exceeded; retry after ${retryAfter}s` }),
				{
					status: 429,
					headers: {
						'content-type': 'application/json',
						'retry-after': String(retryAfter)
					}
				}
			);
		}
		// Public + 5-min CDN-side cache: history is cookie-independent
		// and the same for every requester at a given ts-range, so the
		// CDN should absorb most repeats. Deliberately omit
		// `vary: Cookie` — including it would make Cloudflare key the
		// cache on every distinct cookie value and undermine the
		// s-maxage benefit.
		setHeaders({
			'cache-control': 'public, max-age=60, s-maxage=300'
		});
	} else {
		setHeaders({ 'cache-control': 'private, max-age=60', vary: 'Cookie' });
	}

	try {
		const categoryBytes = bytesFromHex(category);

		// Existence + moderation guard, mirroring /holders + /nfts. 410 on
		// missing or hidden so the response doesn't leak which case applies.
		const guardRes = await query(
			`SELECT 1
			   FROM tokens t
			  WHERE t.category = $1
			    AND ${NOT_MODERATED_CLAUSE}`,
			[categoryBytes]
		);
		if (guardRes.rows.length === 0) {
			error(410, 'token not available');
		}

		const where = ['category = $1'];
		const values: unknown[] = [categoryBytes];
		if (venue) {
			values.push(venue);
			where.push(`venue = $${values.length}`);
		}
		if (from) {
			values.push(from);
			where.push(`ts >= $${values.length}`);
		}
		if (to) {
			values.push(to);
			where.push(`ts <= $${values.length}`);
		}

		const res = await query<HistoryRow>(
			`SELECT ts, venue, price_sats, tvl_satoshis::text AS tvl_satoshis
			   FROM token_price_history
			  WHERE ${where.join(' AND ')}
			  ORDER BY ts ASC`,
			values
		);

		const points: HistoryPoint[] = res.rows.map((r) => ({
			ts: Math.floor(r.ts.getTime() / 1000),
			venue: r.venue,
			priceSats: r.price_sats,
			tvlSatoshis: r.tvl_satoshis
		}));

		if (isCsv) {
			const header = 'ts,venue,price_sats,tvl_satoshis';
			const rows = points.map((p) =>
				[csvCell(p.ts), csvCell(p.venue), csvCell(p.priceSats), csvCell(p.tvlSatoshis)].join(',')
			);
			const body = '﻿' + [header, ...rows].join('\r\n') + '\r\n';
			const date = new Date().toISOString().slice(0, 10);
			return new Response(body, {
				status: 200,
				headers: {
					'content-type': 'text/csv; charset=utf-8',
					'content-disposition': `attachment; filename="tokenstork-${category.slice(0, 16)}-history-${date}.csv"`
				}
			});
		}

		return json({
			category: category.toLowerCase(),
			points
		});
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[api/tokens/[category]/history] error:', err);
		error(500, 'Failed to fetch token history');
	}
};
