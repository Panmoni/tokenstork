// Client-safe constants for the icon-moderation review surface. Kept out
// of $lib/server/iconModeration.ts (which pulls in node:fs + private env
// and therefore cannot be imported into a +page.svelte) so both the
// browser UI and the server endpoints share ONE definition of the
// operator-applicable block reasons.

export type IconState = 'pending' | 'cleared' | 'blocked' | 'review';

// Block reasons an operator may apply from /admin/icons. Subset of the
// schema CHECK enum on icon_moderation.block_reason: 'fetch_failed' is
// excluded because the operator is judging a RENDERED image (a fetch
// failure means there were no pixels to judge).
export const OPERATOR_BLOCK_REASONS = [
	'adult',
	'csam',
	'oversize',
	'unsupported_format'
] as const;
export type OperatorBlockReason = (typeof OPERATOR_BLOCK_REASONS)[number];

const OPERATOR_BLOCK_REASON_SET: ReadonlySet<string> = new Set(OPERATOR_BLOCK_REASONS);

export function isOperatorBlockReason(v: string): v is OperatorBlockReason {
	return OPERATOR_BLOCK_REASON_SET.has(v);
}
