// Low-liquidity market-cap gate. Issue #8: tokens with negligible TVL
// produce price-derived market caps that pollute rankings (a few dust
// sats × a large circulating supply = a nonsense "cap"). We suppress
// the MCap display whenever a token's Cauldron TVL is below the average
// TVL of the top half of currently listed tokens.
//
// The threshold is recomputed on every load — this is a single aggregate
// over token_venue_listings (a few hundred rows at most) and costs
// nothing meaningful next to the lateral joins already in the directory
// query.

import { query } from './db';

// Average TVL (in satoshis) of the top half of Cauldron-listed tokens
// whose TVL is > 0, excluding moderated categories. Returns 0 when
// nothing is listed — in that case no gate applies (marketCapUSD still
// clears the `>= 0` check) and the cosmetic impact is nil because there
// is no ranking to pollute.
export async function computeMcapTvlThresholdSats(): Promise<number> {
	const res = await query<{ avg_tvl: string | null }>(
		`WITH listed AS (
			SELECT vl.tvl_satoshis
			  FROM token_venue_listings vl
			 WHERE vl.venue = 'cauldron'
			   AND vl.tvl_satoshis > 0
			   AND NOT EXISTS (
			     SELECT 1 FROM token_moderation mod WHERE mod.category = vl.category
			   )
		),
		ranked AS (
			SELECT tvl_satoshis,
			       NTILE(2) OVER (ORDER BY tvl_satoshis DESC) AS bucket
			  FROM listed
		)
		SELECT COALESCE(AVG(tvl_satoshis), 0)::text AS avg_tvl
		  FROM ranked
		 WHERE bucket = 1`
	);
	const raw = res.rows[0]?.avg_tvl;
	if (raw == null) return 0;
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? n : 0;
}
