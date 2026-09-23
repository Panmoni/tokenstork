// Stork Sightings — render orchestrator. Calls all renderers from
// one Briefing object and writes output files to the output directory.

import { writeFile, mkdir, readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Briefing, BriefingConfig } from '../types.js';
import { renderBriefingHtml, renderEmailHtml } from './html.js';
import { renderSubstackMd, renderSubstackHtml } from './markdown.js';
import { renderText } from './text.js';
import { renderSocial } from './social.js';
import { renderOgImageSvg } from './og-image.js';
import { rebuildIndex } from '../manifest.js';

export interface RenderResults {
	files: string[];
}

export async function renderAll(
	briefing: Briefing,
	config: BriefingConfig
): Promise<RenderResults> {
	const dir = config.outputDir;
	await mkdir(dir, { recursive: true });
	await mkdir(join(dir, 'archive'), { recursive: true });

	const stamp = `${briefing.generatedAt.slice(0, 10)}-${briefing.generatedAt.slice(11, 16).replace(/:/g, '')}`;

	const files: Record<string, string> = {
		[join(dir, 'index.html')]: renderBriefingHtml(briefing),
		[join(dir, 'briefing.json')]: JSON.stringify(briefing, null, 2),
		[join(dir, 'briefing.html')]: renderEmailHtml(briefing),
		[join(dir, 'briefing.md')]: renderSubstackMd(briefing),
		[join(dir, 'briefing.substack.html')]: renderSubstackHtml(briefing),
		[join(dir, 'briefing.substack.md')]: renderSubstackMd(briefing),
		[join(dir, 'briefing.txt')]: renderText(briefing),
		[join(dir, 'social.json')]: JSON.stringify(renderSocial(briefing), null, 2),
		[join(dir, 'briefing.svg')]: renderOgImageSvg(briefing),
		// Dated archive copies — immutable, cache-forever permalinks. The full
		// open-format set is written so every issue's per-format links resolve.
		[join(dir, 'archive', `briefing-${stamp}.json`)]: JSON.stringify(briefing, null, 2),
		[join(dir, 'archive', `briefing-${stamp}.html`)]: renderBriefingHtml(briefing),
		[join(dir, 'archive', `briefing-${stamp}.substack.html`)]: renderSubstackHtml(briefing),
		[join(dir, 'archive', `briefing-${stamp}.md`)]: renderSubstackMd(briefing),
		[join(dir, 'archive', `briefing-${stamp}.txt`)]: renderText(briefing),
		[join(dir, 'archive', `briefing-${stamp}.svg`)]: renderOgImageSvg(briefing)
	};

	if (briefing.stats.reviewFindings) {
		files[join(dir, '_review.json')] = JSON.stringify(briefing.stats.reviewFindings, null, 2);
	}

	const written: string[] = [];
	for (const [path, content] of Object.entries(files)) {
		await writeFile(path, content);
		written.push(path);
	}

	// Rebuild the blog manifest now that the new snapshot is on disk, so the
	// archive listing and RSS feed pick up this issue's title and tags.
	await rebuildIndex(dir);

	return { files: written };
}

// The open formats every archived issue should expose, keyed by file extension,
// each derived purely from the snapshot's Briefing JSON. Used to backfill any
// missing sibling files for snapshots written before a format was added.
const ARCHIVE_FORMATS: Record<string, (b: Briefing) => string> = {
	'md': renderSubstackMd,
	'txt': renderText,
	'html': renderBriefingHtml,
	'substack.html': renderSubstackHtml,
	'svg': renderOgImageSvg
};

// Ensure every briefing-<stamp>.json in the archive has all of its sibling
// format files. Renders any that are missing from the snapshot JSON itself, so
// per-issue download links resolve even for editions archived before a format
// existed. Returns the number of files written. Never deletes anything.
export async function backfillArchiveFormats(dir: string): Promise<number> {
	const archiveDir = join(dir, 'archive');
	let files: string[];
	try {
		files = await readdir(archiveDir);
	} catch {
		return 0;
	}

	let written = 0;
	for (const f of files) {
		const m = f.match(/^(briefing-\d{4}-\d{2}-\d{2}-\d{4})\.json$/);
		if (!m) continue;
		const base = m[1];

		let briefing: Briefing;
		try {
			briefing = JSON.parse(await readFile(join(archiveDir, f), 'utf-8'));
		} catch {
			continue;
		}

		for (const [ext, render] of Object.entries(ARCHIVE_FORMATS)) {
			const target = join(archiveDir, `${base}.${ext}`);
			try {
				await access(target);
				continue; // already present
			} catch {
				// missing — render it from the snapshot
			}
			await writeFile(target, render(briefing));
			written++;
		}
	}

	return written;
}
