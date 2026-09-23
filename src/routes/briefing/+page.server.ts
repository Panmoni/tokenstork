// /briefing — the Stork Sightings blog: today's edition in full, then the
// archive of past editions (title + date + tags) below it.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PageServerLoad } from './$types';
import type { Briefing } from '$lib/server/briefing/types';
import { readIndex } from '$lib/server/briefing/manifest';

const BRIEFINGS_DIR = 'briefings';

export const load: PageServerLoad = async () => {
	let briefing: Briefing | null = null;

	try {
		const raw = await readFile(join(process.cwd(), BRIEFINGS_DIR, 'briefing.json'), 'utf-8');
		briefing = JSON.parse(raw);
	} catch {
		// No briefing yet
	}

	const issues = await readIndex(join(process.cwd(), BRIEFINGS_DIR));

	// The latest issue is rendered in full at the top, so drop it from the
	// archive list to avoid showing it twice. Match by the snapshot slug derived
	// from generatedAt (YYYY-MM-DD-HHMM).
	const latestSlug = briefing
		? `${briefing.generatedAt.slice(0, 10)}-${briefing.generatedAt.slice(11, 16).replace(':', '')}`
		: '';
	const archiveEntries = issues.filter((i) => i.slug !== latestSlug);

	return { briefing, hasBriefing: briefing !== null, archiveEntries };
};
