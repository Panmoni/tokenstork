// /briefing — serves today's Stork Sightings briefing.
// Reads from the persistent briefings/ directory (at repo root).
// If no briefing exists yet, renders an empty state.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PageServerLoad } from './$types';
import type { Briefing } from '$lib/server/briefing/types';

const BRIEFINGS_DIR = 'briefings';

export const load: PageServerLoad = async () => {
	try {
		const raw = await readFile(join(process.cwd(), BRIEFINGS_DIR, 'briefing.json'), 'utf-8');
		const briefing: Briefing = JSON.parse(raw);
		return { briefing, hasBriefing: true as const };
	} catch {
		return { briefing: null, hasBriefing: false as const };
	}
};
