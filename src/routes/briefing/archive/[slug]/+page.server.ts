// /briefing/archive/[slug] — serves a specific dated edition.
// Reads from briefings/archive/briefing-{slug}.json

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PageServerLoad } from './$types';
import type { Briefing } from '$lib/server/briefing/types';

export const load: PageServerLoad = async ({ params }) => {
	const slug = params.slug;
	try {
		const raw = await readFile(
			join(process.cwd(), 'briefings', 'archive', `briefing-${slug}.json`),
			'utf-8'
		);
		const briefing: Briefing = JSON.parse(raw);
		return { briefing, slug, found: true as const };
	} catch {
		return { briefing: null, slug, found: false as const };
	}
};
