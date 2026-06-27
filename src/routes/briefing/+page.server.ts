// /briefing — serves today's Stork Sightings briefing.
// Reads from the persistent briefings/ directory (at repo root).
// If no briefing exists yet, renders an empty state.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PageServerLoad } from './$types';

const BRIEFINGS_DIR = 'briefings';

export const load: PageServerLoad = async () => {
	try {
		const html = await readFile(join(process.cwd(), BRIEFINGS_DIR, 'index.html'), 'utf-8');
		return { html, hasBriefing: true };
	} catch {
		return { html: null, hasBriefing: false };
	}
};
