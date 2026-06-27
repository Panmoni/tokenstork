// Stork Sightings — new-token classification. LLM primary pass.
// Classifies freshly minted tokens by apparent purpose based on
// name, symbol, and BCMR description. Falls back to 'other' on error.

import type { BriefingConfig, NewTokenItem } from './types.js';
import { llmCall } from './llm.js';

const CLASSIFICATION_TYPES = [
	'fan_token', 'utility', 'memecoin', 'nft_collection',
	'defi', 'gaming', 'governance', 'stablecoin', 'other'
] as const;

export async function classifyNewTokens(
	tokens: NewTokenItem[],
	config: BriefingConfig
): Promise<NewTokenItem[]> {
	if (tokens.length === 0) return tokens;

	const tokenList = tokens.map((t) => ({
		id: t.categoryHex,
		name: t.name ?? '(unnamed)',
		symbol: t.symbol ?? '',
		description: (t.description ?? '').slice(0, 200),
		token_type: t.tokenType
	}));

	const prompt = JSON.stringify(tokenList, null, 2) + `\n\n` +
		`Classify each token by its likely purpose. Use only these categories:\n` +
		CLASSIFICATION_TYPES.join(', ') + `\n` +
		`Respond as JSON array: [{"id": "...", "classification": "..."}]\n` +
		`If you can't tell, use "other". Do not invent classifications not in the list.`;

	const { text, ok } = await llmCall(
		'You classify BCH CashTokens by their apparent purpose based on available metadata.',
		prompt,
		config,
		config.llm.model
	);

	if (!ok || !text.trim()) return tokens;

	try {
		const classifications: Array<{ id: string; classification: string }> = JSON.parse(extractJsonArray(text));
		const map = new Map(classifications.map((c) => [c.id, c.classification]));

		return tokens.map((t) => ({
			...t,
			classification: map.get(t.categoryHex) ?? 'other'
		}));
	} catch {
		return tokens;
	}
}

function extractJsonArray(text: string): string {
	const start = text.indexOf('[');
	const end = text.lastIndexOf(']');
	if (start === -1 || end === -1) return text;
	return text.slice(start, end + 1);
}
