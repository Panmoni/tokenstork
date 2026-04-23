// Shared moderation + report constants. Single source of truth for the
// `reason` enum used by both `token_moderation` and `token_reports`.
//
// The SQL CHECK constraint in db/schema.sql must stay in sync with
// REPORT_REASONS below — schema owns the DB-level invariant, this file
// owns the TS-level invariant, they mirror each other. When adding a
// new reason:
//   1. append to REPORT_REASONS here,
//   2. update the `reason TEXT CHECK (reason IN (...))` list in
//      db/schema.sql for both token_moderation and token_reports,
//   3. add a human-readable label to REPORT_REASON_LABELS,
//   4. run `npm run db:init` against carson.

export const REPORT_REASONS = [
	'spam',
	'phishing',
	'offensive',
	'fraud',
	'illegal',
	'other'
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASONS_SET: ReadonlySet<string> = new Set(REPORT_REASONS);

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
	spam: 'Spam',
	phishing: 'Phishing / scam',
	offensive: 'Offensive content',
	fraud: 'Fraud / misrepresentation',
	illegal: 'Illegal content',
	other: 'Other'
};

// SQL fragment used by every directory / API / stats query to exclude
// moderation-hidden categories. Requires the outer query to alias its
// `tokens` row as `t` (or equivalent). Inlined as a constant rather than
// pasted verbatim in 7 files so adding a column to `token_moderation`
// (e.g. time-limited hides) is one-line governance.
export const NOT_MODERATED_CLAUSE =
	'NOT EXISTS (SELECT 1 FROM token_moderation mod WHERE mod.category = t.category)';
