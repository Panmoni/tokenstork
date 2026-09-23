// /briefing/archive — full blog index of every edition, optionally filtered to
// a single tag via ?tag=<tag>.

import { join } from 'node:path';
import type { PageServerLoad } from './$types';
import { readIndex } from '$lib/server/briefing/manifest';

const BRIEFINGS_DIR = 'briefings';

export const load: PageServerLoad = async ({ url }) => {
	const all = await readIndex(join(process.cwd(), BRIEFINGS_DIR));
	const tag = url.searchParams.get('tag');
	const entries = tag ? all.filter((i) => i.tags?.includes(tag)) : all;

	return { entries, tag };
};
