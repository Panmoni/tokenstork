// Stork Sightings — LLM client. Any OpenAI-compatible /chat/completions
// endpoint. Provider-agnostic. Non-fatal: every call has a timeout and
// falls back gracefully on failure. Records token usage for cost tracking.

import type { BriefingConfig } from './types.js';

interface LlmResponse {
	text: string;
	usage: { promptTokens: number; completionTokens: number };
}

interface LlmError {
	error: string;
	usage: { promptTokens: number; completionTokens: number };
}

export type LlmResult = LlmResponse | LlmError;

function isError(r: LlmResult): r is LlmError {
	return 'error' in r && typeof r.error === 'string';
}

const STORK_VOICE = [
	'You are the voice of Stork Sightings, a daily BCH token ecosystem briefing.',
	'Tone: terse, just the facts, punchy. Occasional dry puns welcome.',
	'Incisive, direct, unabashed, blunt. No fluff. No hype.',
	'Think: a gruff birdwatcher who has seen too many memecoins.',
	'You NEVER invent numbers. If the data does not contain a number, do not make one up.',
	'You NEVER invent token names, categories, or any fact not present in the input data.',
	'When the data is silent, say so briefly. "Quiet day" is better than fabrication.',
	'Write like you\'re briefing someone who holds BCH and wants to know what actually matters.',
	'Do not use the word "exciting." Do not use the phrase "in the world of."',
	'Do not start sentences with "Today we saw" — just say what happened.',
].join('\n');

export async function llmChat(
	systemPrompt: string,
	userPrompt: string,
	config: BriefingConfig,
	model?: string
): Promise<LlmResult> {
	const m = model ?? config.llm.model;
	const url = `${config.llm.baseUrl}/chat/completions`;

	try {
		const resp = await fetch(url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${config.llm.apiKey}`
			},
			body: JSON.stringify({
				model: m,
				messages: [
					{ role: 'system', content: `${systemPrompt}\n\n${STORK_VOICE}` },
					{ role: 'user', content: userPrompt }
				],
				temperature: 0.7,
				max_tokens: 2048
			}),
			signal: AbortSignal.timeout(30_000)
		});

		if (!resp.ok) {
			const body = await resp.text().catch(() => '');
			return { error: `HTTP ${resp.status}: ${body.slice(0, 200)}`, usage: { promptTokens: 0, completionTokens: 0 } };
		}

		const data = (await resp.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
			usage?: { prompt_tokens?: number; completion_tokens?: number };
		};

		const text = data.choices?.[0]?.message?.content ?? '';
		const usage = {
			promptTokens: data.usage?.prompt_tokens ?? 0,
			completionTokens: data.usage?.completion_tokens ?? 0
		};

		return { text, usage };
	} catch (err) {
		return { error: String(err), usage: { promptTokens: 0, completionTokens: 0 } };
	}
}

// ---- Anti-hallucination: validate LLM output against input data ----
export function validateNumbers(text: string, knownNumbers: number[]): string[] {
	const found: string[] = [];
	const numRegex = /\b\d+(?:\.\d+)?%?\b/g;
	const words = text.toLowerCase();

	for (const match of text.matchAll(numRegex)) {
		const n = parseFloat(match[0]);
		if (!isNaN(n) && !knownNumbers.some((k) => Math.abs(k - n) < 0.01)) {
			// Check if this number appears in context of percentages that match
			const pctMatch = match[0].endsWith('%');
			if (pctMatch && knownNumbers.some((k) => Math.abs(k - n) < 0.02)) continue;
			found.push(match[0]);
		}
	}
	return found;
}

export function validateTokenNames(text: string, knownNames: Set<string>): string[] {
	const found: string[] = [];
	// Match potential token names (capitalized words, alphanumeric with dots/dashes)
	const nameRegex = /\b[A-Z][A-Za-z0-9.]+(?:\s+[A-Z][A-Za-z0-9.]+)*\b/g;
	for (const match of text.matchAll(nameRegex)) {
		const name = match[0];
		if (name.length < 3) continue;
		if (['The', 'This', 'That', 'What', 'When', 'Where', 'Which', 'There', 'Today', 'Yesterday'].includes(name)) continue;
		if (!knownNames.has(name) && !knownNames.has(name.toLowerCase())) {
			// Only flag if it looks like a proper name (starts with uppercase, not a common word)
			if (/^[A-Z]/.test(name) && name.length > 4) {
				found.push(name);
			}
		}
	}
	return found;
}

// Accumulator for token usage across all LLM calls in a run.
let totalPromptTokens = 0;
let totalCompletionTokens = 0;
let llmCallsMade = 0;
let llmCallsFailed = 0;

export function resetLlmStats(): void {
	totalPromptTokens = 0;
	totalCompletionTokens = 0;
	llmCallsMade = 0;
	llmCallsFailed = 0;
}

export function getLlmStats() {
	return {
		callsMade: llmCallsMade,
		callsFailed: llmCallsFailed,
		totalTokens: totalPromptTokens + totalCompletionTokens
	};
}

export async function llmCall(
	systemPrompt: string,
	userPrompt: string,
	config: BriefingConfig,
	model?: string
): Promise<{ text: string; ok: boolean }> {
	llmCallsMade++;
	const res = await llmChat(systemPrompt, userPrompt, config, model);
	if (isError(res)) {
		llmCallsFailed++;
		return { text: '', ok: false };
	}
	totalPromptTokens += res.usage.promptTokens;
	totalCompletionTokens += res.usage.completionTokens;
	return { text: res.text, ok: true };
}
