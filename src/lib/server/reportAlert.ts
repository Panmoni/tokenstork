// Report alert dispatcher — forwards new user-submitted token reports to
// an operator-configured webhook. Server-side only; never imported from
// browser code.
//
// Design: webhook-based rather than direct SMTP. One env var
// (REPORT_WEBHOOK_URL) lets the operator point alerts at Discord / Telegram
// / ntfy.sh / a Zapier email bridge / their own forwarder — no nodemailer
// dep, no SPF/DKIM/deliverability story, no bounces. If SMTP specifically
// is wanted, point the webhook at a webhook-to-email service.
//
// Failure mode: the DB insert is the durable record. If the webhook is
// unset or its POST fails, the report is still in `token_reports` and the
// operator can triage via psql. This module never throws; callers invoke
// it as `void dispatchReportAlert(...)` and move on.

import { env } from '$env/dynamic/private';
import { createHmac } from 'node:crypto';
import { REPORT_REASON_LABELS } from '$lib/moderation';

export interface ReportForAlert {
	reportId: number;
	category: string;
	tokenName: string | null;
	tokenSymbol: string | null;
	reason: string;
	details: string | null;
	reporterEmail: string | null;
}

const WEBHOOK_TIMEOUT_MS = 5000;
const DETAILS_TRUNCATE = 1000;
const SITE_ORIGIN = 'https://tokenstork.com';

export async function dispatchReportAlert(report: ReportForAlert): Promise<void> {
	const structured = {
		event: 'report_received',
		report_id: report.reportId,
		category: report.category,
		category_url: `${SITE_ORIGIN}/token/${report.category}`,
		token_name: report.tokenName,
		token_symbol: report.tokenSymbol,
		reason: report.reason,
		reason_label:
			(REPORT_REASON_LABELS as Record<string, string>)[report.reason] ?? report.reason,
		details: report.details ? report.details.slice(0, DETAILS_TRUNCATE) : null,
		reporter_email: report.reporterEmail,
		site: 'tokenstork'
	};

	// Always log to journald regardless of webhook state — the operator can
	// tail the service log if the webhook is misconfigured or silent.
	console.log(JSON.stringify(structured));

	const webhookUrl = env.REPORT_WEBHOOK_URL;
	if (!webhookUrl) return;

	const body = JSON.stringify(structured);
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		'user-agent': 'tokenstork-report-alert/1'
	};

	// Optional HMAC so the webhook receiver can verify authenticity.
	// Header name follows the GitHub convention.
	const secret = env.REPORT_WEBHOOK_SECRET;
	if (secret) {
		const sig = createHmac('sha256', secret).update(body).digest('hex');
		headers['x-tokenstork-signature'] = `sha256=${sig}`;
	}

	try {
		const res = await fetch(webhookUrl, {
			method: 'POST',
			headers,
			body,
			signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS)
		});
		if (!res.ok) {
			console.error(
				`[reportAlert] webhook responded ${res.status} for report ${report.reportId}`
			);
		}
	} catch (err) {
		console.error(
			`[reportAlert] webhook POST failed for report ${report.reportId}:`,
			err
		);
	}
}
