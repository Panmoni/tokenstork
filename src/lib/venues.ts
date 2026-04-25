// Single source of truth for the venue identifiers the UI renders. Kept
// small on purpose — if we need more metadata later (per-venue URL
// templates, colour tokens, etc.) it lands here, not scattered across
// TokenGrid / detail page / stats.
//
// `kind` distinguishes pool-liquidity (amm) from peer-to-peer marketplace
// (p2p). The directory's Price/TVL columns are meaningful only for amm
// venues; p2p venues surface via badges + the detail-page listings card.
//
// `badge` + `badgeClass` are descriptive metadata used by tooling /
// future refactors. **The current TokenGrid render hardcodes its own
// badge markup** (logo image with title text) per venue rather than
// reading these — a refactor to pull them from VENUES would dedupe
// nicely but isn't blocking. If you change `badge` here, also update the
// `<img src=".../logo.png">` reference in TokenGrid + the detail page +
// stats page directly.

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
	},
	{
		id: 'fex',
		label: 'Fex',
		kind: 'amm',
		filterParam: 'fex',
		badge: 'F',
		badgeClass: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
	}
] as const;

export type VenueId = (typeof VENUES)[number]['id'];
export type VenueKind = (typeof VENUES)[number]['kind'];
