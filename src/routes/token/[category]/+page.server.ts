// Per-token detail page. Joins tokens + metadata + state from Postgres,
// then fetches live Cauldron price + TVL and the top-10 holders in
// parallel. BCH price is fetched server-side so market-cap + TVL USD
// don't wait on a client-side /api/bchPrice round-trip.

import { error } from '@sveltejs/kit';
import { query, hexFromBytes, bytesFromHex } from '$lib/server/db';
import { fetchBcmr, fetchCauldron } from '$lib/server/external';
import type { PageServerLoad } from './$types';
import type { TokenType } from '$lib/types';

const HEX_REGEX = /^[0-9a-fA-F]{64}$/;

interface TokenRow {
	category: Buffer;
	token_type: TokenType;
	genesis_block: number;
	first_seen_at: Date;
	name: string | null;
	symbol: string | null;
	decimals: number | null;
	description: string | null;
	icon_uri: string | null;
	current_supply: string | null;
	live_utxo_count: number | null;
	live_nft_count: number | null;
	holder_count: number | null;
	has_active_minting: boolean | null;
	is_fully_burned: boolean | null;
	verified_at: Date | null;
	is_moderated: boolean;
}

interface HolderRow {
	address: string;
	balance: string;
	nft_count: number;
}

interface TapswapOfferRow {
	id: Buffer;
	has_amount: string | null;
	has_commitment: Buffer | null;
	has_capability: 'none' | 'mutable' | 'minting' | null;
	has_sats: string;
	want_sats: string;
	want_category: Buffer | null;
	want_amount: string | null;
	want_commitment: Buffer | null;
	want_capability: 'none' | 'mutable' | 'minting' | null;
	maker_pkh: Buffer;
	listed_block: number;
	listed_at: Date;
}

async function fetchBchPrice(fetch: typeof globalThis.fetch): Promise<number> {
	try {
		const res = await fetch('/api/bchPrice', {
			signal: AbortSignal.timeout(4000)
		});
		const data = await res.json();
		return typeof data?.USD === 'number' ? data.USD : 0;
	} catch {
		return 0;
	}
}

export const load: PageServerLoad = async ({ params, fetch }) => {
	const category = params.category.toLowerCase();
	if (!HEX_REGEX.test(category)) {
		error(400, 'invalid category (expected 64 hex chars)');
	}

	const categoryBytes = bytesFromHex(category);

	// One query instead of two: LEFT JOIN token_moderation and return an
	// `is_moderated` boolean alongside the row. Saves a round-trip on
	// every detail-page render. 404 for missing category, 410 for hidden.
	const tokenRes = await query<TokenRow>(
		`SELECT
			t.category,
			t.token_type,
			t.genesis_block,
			t.first_seen_at,
			m.name,
			m.symbol,
			m.decimals,
			m.description,
			m.icon_uri,
			s.current_supply::text AS current_supply,
			s.live_utxo_count,
			s.live_nft_count,
			s.holder_count,
			s.has_active_minting,
			s.is_fully_burned,
			s.verified_at,
			(mod.category IS NOT NULL) AS is_moderated
		   FROM tokens t
		   LEFT JOIN token_metadata  m   ON m.category  = t.category
		   LEFT JOIN token_state     s   ON s.category  = t.category
		   LEFT JOIN token_moderation mod ON mod.category = t.category
		  WHERE t.category = $1`,
		[categoryBytes]
	);

	if (tokenRes.rows.length === 0) {
		error(404, 'token not found');
	}
	if (tokenRes.rows[0].is_moderated) {
		// 410 Gone so search engines drop the URL (versus 404 "never
		// existed"). Reason / note are operator-private — user-visible
		// message is intentionally terse.
		error(410, 'This token has been hidden from the tokenstork directory.');
	}

	const row = tokenRes.rows[0];

	const [holdersRes, bchPriceUSD, bcmr, tapswapRes] = await Promise.all([
		query<HolderRow>(
			`SELECT address, balance::text AS balance, nft_count
			   FROM token_holders
			  WHERE category = $1
			  ORDER BY balance DESC, address ASC
			  LIMIT 10`,
			[categoryBytes]
		),
		fetchBchPrice(fetch),
		fetchBcmr(category),
		// Open Tapswap offers with this category on the "has" side
		// (someone selling this token). Sorted by want_sats ASC so the
		// cheapest asks render first. Limit 20 — detail page doesn't need
		// a full paginated listing browser; Tapswap's own UI does that.
		//
		// Moderation: the tokenRes query above already throws 410 before
		// this fires for hidden categories, so the NOT EXISTS clause is
		// belt-and-braces. Keeping the guard inside the SQL means a future
		// refactor that parallelises the moderation probe with this fetch
		// won't leak.
		query<TapswapOfferRow>(
			`SELECT id,
			        has_amount::text    AS has_amount,
			        has_commitment,
			        has_capability,
			        has_sats::text      AS has_sats,
			        want_sats::text     AS want_sats,
			        want_category,
			        want_amount::text   AS want_amount,
			        want_commitment,
			        want_capability,
			        maker_pkh,
			        listed_block,
			        listed_at
			   FROM tapswap_offers
			  WHERE has_category = $1
			    AND status = 'open'
			    AND NOT EXISTS (
			      SELECT 1 FROM token_moderation mod WHERE mod.category = $1
			    )
			  ORDER BY want_sats ASC
			  LIMIT 20`,
			[categoryBytes]
		)
	]);

	const decimals = row.decimals ?? bcmr?.decimals ?? 0;
	const cauldron = await fetchCauldron(category, decimals, bchPriceUSD);

	return {
		token: {
			id: hexFromBytes(row.category)!,
			tokenType: row.token_type,
			genesisBlock: row.genesis_block,
			firstSeenAt: Math.floor(row.first_seen_at.getTime() / 1000),
			name: row.name ?? bcmr?.name ?? null,
			symbol: row.symbol ?? bcmr?.symbol ?? null,
			decimals,
			description: row.description ?? bcmr?.description ?? null,
			icon: row.icon_uri ?? bcmr?.iconUri ?? null,
			currentSupply: row.current_supply,
			liveUtxoCount: row.live_utxo_count,
			liveNftCount: row.live_nft_count,
			holderCount: row.holder_count,
			hasActiveMinting: row.has_active_minting ?? false,
			isFullyBurned: row.is_fully_burned ?? false,
			isVerifiedOnchain: row.verified_at !== null
		},
		// Full BCMR dump — surfaced in a dedicated card on the detail page
		// so users can see every metadata field the registry publishes
		// (links, NFT types, extensions, tags, status, splitId). Null
		// when Paytaca has nothing for this category, which means no
		// BCMR card renders on the page.
		bcmr: bcmr
			? {
				status: bcmr.status,
				splitId: bcmr.splitId,
				uris: bcmr.uris,
				tags: bcmr.tags,
				extensions: bcmr.extensions,
				nftTypes: bcmr.nftTypes,
				nftsDescription: bcmr.nftsDescription
			}
			: null,
		holders: holdersRes.rows.map((h) => ({
			address: h.address,
			balance: h.balance,
			nftCount: h.nft_count
		})),
		tapswapOffers: tapswapRes.rows.map((o) => ({
			id: hexFromBytes(o.id)!,
			hasAmount: o.has_amount,
			hasCommitment: o.has_commitment ? hexFromBytes(o.has_commitment) : null,
			hasCapability: o.has_capability,
			hasSats: o.has_sats,
			wantSats: o.want_sats,
			wantCategory: o.want_category ? hexFromBytes(o.want_category) : null,
			wantAmount: o.want_amount,
			wantCommitment: o.want_commitment ? hexFromBytes(o.want_commitment) : null,
			wantCapability: o.want_capability,
			makerPkhHex: hexFromBytes(o.maker_pkh)!,
			listedBlock: o.listed_block,
			listedAt: Math.floor(o.listed_at.getTime() / 1000)
		})),
		priceUSD: cauldron.priceUSD,
		tvlUSD: cauldron.tvlUSD,
		bchPriceUSD
	};
};
