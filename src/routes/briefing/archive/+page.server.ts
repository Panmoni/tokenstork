// /briefing/archive — lists all dated editions from the archive directory.

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { PageServerLoad } from './$types';

const BRIEFINGS_DIR = 'briefings';

interface ArchiveEntry {
	slug: string;
	date: string;
	time: string;
}

export const load: PageServerLoad = async () => {
	const entries: ArchiveEntry[] = [];

	try {
		const archiveDir = join(process.cwd(), BRIEFINGS_DIR, 'archive');
		const files = await readdir(archiveDir);

		for (const f of files) {
			const match = f.match(/^briefing-(\d{4}-\d{2}-\d{2})-(\d{4})\.json$/);
			if (match) {
				entries.push({
					slug: `${match[1]}-${match[2]}`,
					date: match[1],
					time: `${match[2].slice(0, 2)}:${match[2].slice(2)}`
				});
			}
		}
	} catch {
		// No archive yet — return empty list
	}

	entries.sort((a, b) => b.slug.localeCompare(a.slug));

	return { entries };
};
