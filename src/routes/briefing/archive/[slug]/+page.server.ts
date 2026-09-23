// /briefing/archive/[slug] — a single past edition, blog-post style, with
// prev/next navigation. Reads from briefings/archive/briefing-{slug}.json.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PageServerLoad } from './$types';
import type { Briefing } from '$lib/server/briefing/types';
import { readIndex, neighbours } from '$lib/server/briefing/manifest';

const BRIEFINGS_DIR = 'briefings';

export const load: PageServerLoad = async ({ params }) => {
	const slug = params.slug;
	try {
		const raw = await readFile(
			join(process.cwd(), BRIEFINGS_DIR, 'archive', `briefing-${slug}.json`),
			'utf-8'
		);
		const briefing: Briefing = JSON.parse(raw);
		const issues = await readIndex(join(process.cwd(), BRIEFINGS_DIR));
		const { prev, next } = neighbours(issues, slug);
		return { briefing, slug, found: true as const, prev, next };
	} catch {
		return { briefing: null, slug, found: false as const, prev: null, next: null };
	}
};
