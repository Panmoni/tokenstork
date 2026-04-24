// Single source of truth for the venue identifiers the UI renders. Kept
// small on purpose — if we need more metadata later (per-venue URL
// templates, colour tokens, etc.) it lands here, not scattered across
// TokenGrid / detail page / stats.
//
// `kind` distinguishes pool-liquidity (amm) from peer-to-peer marketplace
// (p2p). The directory's Price/TVL columns are meaningful only for amm
// venues; p2p venues surface via badges + the detail-page listings card.

export const VENUES = [
	{
		id: 'cauldron',
		label: 'Cauldron',
		kind: 'amm',
		filterParam: 'cauldron',
		badge: 'C',
		badgeClass: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
	},
	{
		id: 'tapswap',
		label: 'Tapswap',
		kind: 'p2p',
		filterParam: 'tapswap',
		badge: 'T',
		badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
	}
] as const;

export type VenueId = (typeof VENUES)[number]['id'];
export type VenueKind = (typeof VENUES)[number]['kind'];
