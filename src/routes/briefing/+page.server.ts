// /briefing — serves today's Stork Sightings briefing with archive list.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { PageServerLoad } from './$types';
import type { Briefing } from '$lib/server/briefing/types';

const BRIEFINGS_DIR = 'briefings';

export const load: PageServerLoad = async () => {
	let briefing: Briefing | null = null;
	let hasBriefing = false;

	try {
		const raw = await readFile(join(process.cwd(), BRIEFINGS_DIR, 'briefing.json'), 'utf-8');
		briefing = JSON.parse(raw);
		hasBriefing = true;
	} catch {
		// No briefing yet
	}

	const archiveEntries: Array<{ slug: string; date: string; time: string }> = [];
	try {
		const files = await readdir(join(process.cwd(), BRIEFINGS_DIR, 'archive'));
		for (const f of files) {
			const m = f.match(/^briefing-(\d{4}-\d{2}-\d{2})-(\d{4})\.json$/);
			if (m) archiveEntries.push({ slug: `${m[1]}-${m[2]}`, date: m[1], time: `${m[2].slice(0,2)}:${m[2].slice(2)}` });
		}
		archiveEntries.sort((a, b) => b.slug.localeCompare(a.slug));
	} catch { /* no archive yet */ }

	return { briefing, hasBriefing, archiveEntries };
};
