// Stork Sightings — configuration. Everything is overridable via environment
// variables so the module works both locally and on the VPS.
//
// LLM config: uses DEEPINFRA_API_KEY from the environment (set in ~/.zshrc).
// Falls back to BRIEFING_LLM_API_KEY if that's explicitly set.

import type { BriefingConfig } from './types.js';

function env(key: string, fallback: string): string {
	return process.env[key] ?? fallback;
}

function envBool(key: string, fallback: boolean): boolean {
	const v = process.env[key];
	if (v === undefined) return fallback;
	return v === '1' || v === 'true';
}

export function loadConfig(): BriefingConfig {
	const apiKey = process.env.BRIEFING_LLM_API_KEY ?? process.env.DEEPINFRA_API_KEY ?? '';

	return {
		windowHours: Number(env('BRIEFING_WINDOW_HOURS', '24')),
		maxMovers: Number(env('BRIEFING_MAX_MOVERS', '5')),
		maxNewTokens: Number(env('BRIEFING_MAX_NEW_TOKENS', '10')),
		maxWhaleMoves: Number(env('BRIEFING_MAX_WHALE_MOVES', '5')),
		outputDir: env('BRIEFING_OUTPUT_DIR', 'briefings'),
		publicUrl: env('BRIEFING_PUBLIC_URL', 'https://tokenstork.com'),
		substackUrl: env('BRIEFING_SUBSTACK_URL', 'https://tokenstork.substack.com'),
		llm: {
			baseUrl: env('BRIEFING_LLM_BASE_URL', 'https://api.deepinfra.com/v1/openai'),
			apiKey,
			model: env('BRIEFING_LLM_MODEL', 'zai-org/GLM-5.2'),
			reviewModel: env('BRIEFING_LLM_REVIEW_MODEL', 'deepseek-ai/DeepSeek-V4-Pro')
		},
		email: {
			resendApiKey: env('RESEND_API_KEY', ''),
			from: env('EMAIL_FROM', ''),
			to: env('EMAIL_TO', '')
		}
	};
}
