// BCMR (Bitcoin Cash Metadata Registry) JSON generator.
//
// Spec: https://github.com/bitjson/chip-bcmr
//
// We generate a minimal-but-spec-compliant BCMR file that can be:
//   (a) Self-hosted on any HTTPS endpoint the user controls
//   (b) Pinned to IPFS and registered via `ipfs://<cid>` URI
//   (c) Submitted as a PR to Paytaca's public registry
//
// v1 only emits option (a) directly — the file is a JSON download. The
// other paths layer on top of the same generator (just different
// destinations for the same bytes).

import type { TokenType, NftCapability } from './genesis';

export interface BcmrInput {
	categoryHex: string; // 64-char hex
	tokenType: TokenType;
	name: string;
	ticker: string;
	decimals: number;
	description?: string;
	/** Web URL to the published icon (HTTPS), or `ipfs://<cid>`, or
	 *  empty if no icon. v1 leaves this empty by default — operator can
	 *  add an icon URI to the JSON post-download if desired. */
	iconUri?: string;
	/** Identity-publication timestamp. Defaults to "now" — should match
	 *  the genesis-tx broadcast wall-clock so wallets know when this
	 *  identity was first announced. */
	publishedAtIso?: string;
	/** ISO timestamp of the genesis transaction (informational; some
	 *  clients render it as the "first activity" date). */
	genesisAtIso?: string;
	/** NFT-specific fields. Only relevant for NFT and FT+NFT. */
	nftCommitmentHex?: string;
	nftCapability?: NftCapability;
}

/**
 * Emit a BCMR JSON object. The shape conforms to the latest published
 * BCMR schema (CHIP-BCMR v2). Wallets validate against this, so don't
 * loosen the type without checking the spec first.
 */
export function generateBcmr(input: BcmrInput): Record<string, unknown> {
	const publishedAt = input.publishedAtIso ?? new Date().toISOString();
	const genesisAt = input.genesisAtIso ?? publishedAt;

	const token: Record<string, unknown> = {
		category: input.categoryHex.toLowerCase(),
		symbol: input.ticker,
		decimals: input.decimals
	};
	if (input.tokenType === 'NFT' || input.tokenType === 'FT+NFT') {
		token.nfts = {
			description: 'Per-token NFT entries are operator-managed; add specific commitment-keyed entries here as you mint individual NFTs.',
			parse: {
				bytecode: '',
				types: {}
			}
		};
		// Surface the genesis-NFT's capability + commitment so explorers
		// can show it directly without consulting on-chain data.
		if (input.nftCapability || input.nftCommitmentHex) {
			(token.nfts as Record<string, unknown>).genesis = {
				capability: input.nftCapability ?? 'none',
				commitment: input.nftCommitmentHex ?? ''
			};
		}
	}

	const identity: Record<string, unknown> = {
		name: input.name,
		description: input.description ?? '',
		token,
		uris: input.iconUri
			? {
					icon: input.iconUri
				}
			: {}
	};

	const identitySnapshot: Record<string, unknown> = {
		[publishedAt]: identity
	};

	return {
		$schema: 'https://cashtokens.org/schemas/bcmr-v2.schema.json',
		version: { major: 0, minor: 1, patch: 0 },
		latestRevision: publishedAt,
		registryIdentity: {
			name: input.name,
			description: `BCMR self-publication for ${input.ticker} (${input.categoryHex.slice(0, 8)}…), genesis ${genesisAt}.`
		},
		identities: {
			[input.categoryHex.toLowerCase()]: identitySnapshot
		}
	};
}

/** Convenience: pretty-printed JSON suitable for the download blob. */
export function generateBcmrJson(input: BcmrInput): string {
	return JSON.stringify(generateBcmr(input), null, 2);
}
