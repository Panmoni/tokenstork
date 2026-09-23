// Stork Sightings — issue index ("the blog manifest"). Each daily briefing is
// archived as briefings/archive/briefing-<date>-<time>.json. Reading every one
// of those on each page request to show titles in the archive list would not
// scale, so the render step writes a compact briefings/index.json holding just
// the per-issue metadata the listing and RSS feed need.
//
// readIndex() prefers that manifest but falls back to scanning the archive
// directory in memory (no write) so the listing is always correct even before
// the first cron run after a deploy. rebuildIndex() is the writing path, owned
// by the render pipeline (and the reindex script).

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Briefing } from './types.js';

export interface IssueMeta {
	slug: string; // <date>-<time>, e.g. 2026-06-28-1100 — matches the archive filename
	date: string; // YYYY-MM-DD
	time: string; // HH:MM (UTC)
	generatedAt: string; // ISO timestamp
	title: string;
	dek: string;
	summary: string;
	tags: string[];
}

const INDEX_FILE = 'index.json';
const ARCHIVE_SUBDIR = 'archive';
const ARCHIVE_RE = /^briefing-(\d{4}-\d{2}-\d{2})-(\d{4})\.json$/;

function metaFromBriefing(slug: string, date: string, time: string, b: Briefing): IssueMeta {
	return {
		slug,
		date,
		time,
		generatedAt: b.generatedAt,
		title: b.headline || 'Daily Briefing',
		dek: b.dek || '',
		summary: b.executiveSummary || '',
		tags: Array.isArray(b.tags) ? b.tags : []
	};
}

// Scan the archive directory and build the issue list in memory. Dedupes to one
// entry per calendar day (the latest run of that day wins, matching the "one
// blog post per day" model), sorted newest first. Never writes.
async function scanArchive(dir: string): Promise<IssueMeta[]> {
	const archiveDir = join(dir, ARCHIVE_SUBDIR);
	let files: string[];
	try {
		files = await readdir(archiveDir);
	} catch {
		return [];
	}

	const byDay = new Map<string, IssueMeta>();
	for (const f of files) {
		const m = f.match(ARCHIVE_RE);
		if (!m) continue;
		const date = m[1];
		const time = `${m[2].slice(0, 2)}:${m[2].slice(2)}`;
		const slug = `${date}-${m[2]}`;

		let b: Briefing;
		try {
			b = JSON.parse(await readFile(join(archiveDir, f), 'utf-8'));
		} catch {
			continue; // skip unparseable / partial snapshots
		}

		const meta = metaFromBriefing(slug, date, time, b);
		const existing = byDay.get(date);
		// Keep the later run for the day (compare by slug, which sorts by time).
		if (!existing || slug > existing.slug) byDay.set(date, meta);
	}

	return [...byDay.values()].sort((a, b) => b.slug.localeCompare(a.slug));
}

// Writing path: rebuild the manifest from the archive directory and persist it.
// Called by the render pipeline after the day's snapshot is written.
export async function rebuildIndex(dir: string): Promise<IssueMeta[]> {
	const issues = await scanArchive(dir);
	await writeFile(join(dir, INDEX_FILE), JSON.stringify({ issues }, null, 2));
	return issues;
}

// Reading path: prefer the persisted manifest; fall back to an in-memory scan
// (no write) when it is missing or unreadable. Safe to call from SSR loads.
export async function readIndex(dir: string): Promise<IssueMeta[]> {
	try {
		const raw = await readFile(join(dir, INDEX_FILE), 'utf-8');
		const parsed = JSON.parse(raw);
		if (parsed && Array.isArray(parsed.issues)) return parsed.issues as IssueMeta[];
	} catch {
		// fall through to scan
	}
	return scanArchive(dir);
}

// Find the older/newer neighbours of a slug for prev/next post navigation.
// `next` is the newer issue, `prev` is the older one (blog convention).
export function neighbours(
	issues: IssueMeta[],
	slug: string
): { prev: IssueMeta | null; next: IssueMeta | null } {
	const idx = issues.findIndex((i) => i.slug === slug);
	if (idx === -1) return { prev: null, next: null };
	return {
		next: idx > 0 ? issues[idx - 1] : null,
		prev: idx < issues.length - 1 ? issues[idx + 1] : null
	};
}
