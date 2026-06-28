// /briefing/dl/[name] — serves generated briefing files (json, txt, md,
// substack html, svg) from the persistent briefings/ directory. Both the
// current edition and dated archive snapshots are servable through here.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const BRIEFINGS_DIR = 'briefings';

const CONTENT_TYPES: Record<string, string> = {
	'.json': 'application/json; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.md': 'text/markdown; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.svg': 'image/svg+xml; charset=utf-8'
};

// Whitelist of allowed file-name shapes. Either a current-edition file
// (briefing.json, briefing.substack.html, social.json, …) or a dated
// archive snapshot (briefing-2026-06-27-1100.json, …).
function isAllowed(name: string): boolean {
	if (name.includes('/') || name.includes('\\') || name.includes('..')) return false;
	return (
		/^briefing(\.substack)?\.(json|txt|md|html|svg)$/.test(name) ||
		/^social\.json$/.test(name) ||
		/^briefing-\d{4}-\d{2}-\d{2}-\d{4}(\.substack)?\.(json|txt|md|html|svg)$/.test(name)
	);
}

function extOf(name: string): string {
	const i = name.lastIndexOf('.');
	return i === -1 ? '' : name.slice(i);
}

export const GET: RequestHandler = async ({ params }) => {
	const name = params.name;
	if (!isAllowed(name)) throw error(404, 'Not found');

	const isArchive = name.startsWith('briefing-');
	const path = isArchive
		? join(process.cwd(), BRIEFINGS_DIR, 'archive', name)
		: join(process.cwd(), BRIEFINGS_DIR, name);

	let body: string;
	try {
		body = await readFile(path, 'utf-8');
	} catch {
		throw error(404, 'Not found');
	}

	return new Response(body, {
		headers: {
			'content-type': CONTENT_TYPES[extOf(name)] ?? 'application/octet-stream',
			'cache-control': 'public, max-age=300'
		}
	});
};
