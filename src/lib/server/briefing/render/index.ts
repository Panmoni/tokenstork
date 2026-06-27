// Stork Sightings — render orchestrator. Calls all renderers from
// one Briefing object and writes output files to the output directory.

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Briefing, BriefingConfig } from '../types.js';
import { renderBriefingHtml, renderEmailHtml } from './html.js';
import { renderSubstackMd, renderSubstackHtml } from './markdown.js';
import { renderText } from './text.js';
import { renderSocial } from './social.js';
import { renderOgImageSvg } from './og-image.js';

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
		[join(dir, 'briefing.html')]: renderEmailHtml(briefing),
		[join(dir, 'briefing.md')]: renderSubstackMd(briefing),
		[join(dir, 'briefing.substack.html')]: renderSubstackHtml(briefing),
		[join(dir, 'briefing.substack.md')]: renderSubstackMd(briefing),
		[join(dir, 'briefing.txt')]: renderText(briefing),
		[join(dir, 'social.json')]: JSON.stringify(renderSocial(briefing), null, 2),
		[join(dir, 'briefing.svg')]: renderOgImageSvg(briefing),
		// Dated archive copies — immutable, cache-forever permalinks.
		[join(dir, 'archive', `briefing-${stamp}.html`)]: renderBriefingHtml(briefing),
		[join(dir, 'archive', `briefing-${stamp}.substack.html`)]: renderSubstackHtml(briefing),
		[join(dir, 'archive', `briefing-${stamp}.md`)]: renderSubstackMd(briefing)
	};

	if (briefing.stats.reviewFindings) {
		files[join(dir, '_review.json')] = JSON.stringify(briefing.stats.reviewFindings, null, 2);
	}

	const written: string[] = [];
	for (const [path, content] of Object.entries(files)) {
		await writeFile(path, content);
		written.push(path);
	}

	return { files: written };
}
