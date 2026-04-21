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
}

interface HolderRow {
	address: string;
	balance: string;
	nft_count: number;
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
			s.verified_at
		   FROM tokens t
		   LEFT JOIN token_metadata m ON m.category = t.category
		   LEFT JOIN token_state s    ON s.category = t.category
		  WHERE t.category = $1`,
		[categoryBytes]
	);

	if (tokenRes.rows.length === 0) {
		error(404, 'token not found');
	}

	const row = tokenRes.rows[0];

	const [holdersRes, bchPriceUSD, bcmr] = await Promise.all([
		query<HolderRow>(
			`SELECT address, balance::text AS balance, nft_count
			   FROM token_holders
			  WHERE category = $1
			  ORDER BY balance DESC, address ASC
			  LIMIT 10`,
			[categoryBytes]
		),
		fetchBchPrice(fetch),
		fetchBcmr(category)
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
		holders: holdersRes.rows.map((h) => ({
			address: h.address,
			balance: h.balance,
			nftCount: h.nft_count
		})),
		priceUSD: cauldron.priceUSD,
		tvlUSD: cauldron.tvlUSD,
		bchPriceUSD
	};
};
