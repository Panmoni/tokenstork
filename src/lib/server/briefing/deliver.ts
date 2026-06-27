// Stork Sightings — delivery. Sends email via Resend API, writes files.
// Reuses RESEND_API_KEY / EMAIL_FROM / EMAIL_TO from environment
// (mirroring gmsecurity's .env values).

import type { Briefing, BriefingConfig } from './types.js';
import { renderEmailHtml } from './render/html.js';
import { renderText } from './render/text.js';
import { renderAll } from './render/index.js';

export async function sendBriefingEmail(
	briefing: Briefing,
	config: BriefingConfig
): Promise<{ delivered: boolean; error?: string }> {
	const apiKey = config.email.resendApiKey;
	if (!apiKey) {
		return { delivered: false, error: 'RESEND_API_KEY not configured' };
	}
	if (!config.email.to) {
		return { delivered: false, error: 'EMAIL_TO not configured' };
	}

	const date = new Date(briefing.generatedAt).toISOString().slice(0, 10);
	const subject = buildSubject(briefing, date);
	const html = renderEmailHtml(briefing);
	const text = renderText(briefing);

	try {
		const resp = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${apiKey}`
			},
			body: JSON.stringify({
				from: config.email.from || 'onboarding@resend.dev',
				to: config.email.to,
				subject,
				html,
				text
			}),
			signal: AbortSignal.timeout(20_000)
		});

		if (!resp.ok) {
			const body = await resp.text().catch(() => '');
			return { delivered: false, error: `Resend HTTP ${resp.status}: ${body.slice(0, 200)}` };
		}

		return { delivered: true };
	} catch (err) {
		return { delivered: false, error: String(err) };
	}
}

function buildSubject(b: Briefing, date: string): string {
	const parts: string[] = [];
	parts.push(`⬢ Stork Sightings — ${date}`);
	if (b.movers.gainers.length > 0) {
		const top = b.movers.gainers[0];
		parts.push(`${top.symbol || top.name} ↑${top.pricePct.toFixed(0)}%`);
	}
	if (b.newTokens.length > 0) {
		parts.push(`${b.newTokens.length} new tokens`);
	}
	return parts.join(' · ');
}

export async function deliverBriefing(
	briefing: Briefing,
	config: BriefingConfig
): Promise<void> {
	// Write all output files
	const renderResult = await renderAll(briefing, config);

	// Send email if configured
	const emailResult = await sendBriefingEmail(briefing, config);
	if (emailResult.delivered) {
		process.stderr.write(`[deliver] email sent\n`);
	} else if (emailResult.error) {
		process.stderr.write(`[deliver] email skipped: ${emailResult.error}\n`);
	}

	process.stderr.write(`[deliver] ${renderResult.files.length} files written to ${config.outputDir}/\n`);
}
