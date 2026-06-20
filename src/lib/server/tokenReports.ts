// Token-report queue data access — backs the /admin/reports operator
// surface. User-submitted abuse reports land in `token_reports` (see
// src/routes/api/tokens/[category]/report/+server.ts); this module reads
// them back for triage and lets the operator advance a report's status.
//
// Server-side only; gated behind $lib/server/admin at the route layer.
// `reporter_ip` is deliberately never selected here — it exists for
// rate-limit/abuse debugging in psql, never for rendering (schema comment).

import { query, hexFromBytes } from '$lib/server/db';

export const REPORT_STATUSES = ['new', 'reviewed', 'actioned', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export const REPORT_STATUSES_SET: ReadonlySet<string> = new Set(REPORT_STATUSES);

export interface TokenReport {
	id: number;
	categoryHex: string;
	reason: string;
	details: string | null;
	reporterEmail: string | null;
	status: ReportStatus;
	createdAt: number; // epoch seconds
	reviewedAt: number | null; // epoch seconds
	moderatorNote: string | null;
	tokenName: string | null;
	tokenSymbol: string | null;
}

interface DbRow {
	id: string; // BIGSERIAL → string from pg
	category: Buffer;
	reason: string;
	details: string | null;
	reporter_email: string | null;
	status: ReportStatus;
	created_at: Date;
	reviewed_at: Date | null;
	moderator_note: string | null;
	token_name: string | null;
	token_symbol: string | null;
}

function rowToReport(r: DbRow): TokenReport {
	return {
		id: Number(r.id),
		categoryHex: hexFromBytes(r.category)!,
		reason: r.reason,
		details: r.details,
		reporterEmail: r.reporter_email,
		status: r.status,
		createdAt: Math.floor(r.created_at.getTime() / 1000),
		reviewedAt: r.reviewed_at ? Math.floor(r.reviewed_at.getTime() / 1000) : null,
		moderatorNote: r.moderator_note,
		tokenName: r.token_name,
		tokenSymbol: r.token_symbol
	};
}

/** One page of reports, newest first. `status === 'all'` skips the filter. */
export async function listReports(
	status: ReportStatus | 'all',
	limit: number,
	offset: number
): Promise<TokenReport[]> {
	const where = status === 'all' ? '' : 'WHERE r.status = $3';
	const params: unknown[] = [limit, offset];
	if (status !== 'all') params.push(status);
	const res = await query<DbRow>(
		`SELECT r.id, r.category, r.reason, r.details, r.reporter_email, r.status,
		        r.created_at, r.reviewed_at, r.moderator_note,
		        m.name AS token_name, m.symbol AS token_symbol
		   FROM token_reports r
		   LEFT JOIN token_metadata m ON m.category = r.category
		   ${where}
		   ORDER BY r.created_at DESC
		   LIMIT $1 OFFSET $2`,
		params
	);
	return res.rows.map(rowToReport);
}

/** Count per status, for the filter-tab badges. Missing statuses read 0. */
export async function getReportStatusCounts(): Promise<Record<ReportStatus | 'all', number>> {
	const res = await query<{ status: ReportStatus; n: string }>(
		`SELECT status, COUNT(*)::bigint AS n FROM token_reports GROUP BY status`
	);
	const counts: Record<ReportStatus | 'all', number> = {
		new: 0,
		reviewed: 0,
		actioned: 0,
		dismissed: 0,
		all: 0
	};
	for (const row of res.rows) {
		const n = Number(row.n);
		counts[row.status] = n;
		counts.all += n;
	}
	return counts;
}

/**
 * Advance a report's status. Setting anything other than 'new' stamps
 * `reviewed_at = now()`; returning to 'new' clears it. `note` (operator
 * audit trail, never shown to the reporter) is written verbatim or left
 * untouched when null. Returns false if the id doesn't exist.
 */
export async function setReportStatus(
	id: number,
	status: ReportStatus,
	note: string | null
): Promise<boolean> {
	const res = await query(
		`UPDATE token_reports
		    SET status = $2,
		        reviewed_at = CASE WHEN $2 = 'new' THEN NULL ELSE now() END,
		        moderator_note = COALESCE($3, moderator_note)
		  WHERE id = $1`,
		[id, status, note]
	);
	return (res.rowCount ?? 0) > 0;
}
