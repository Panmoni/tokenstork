// scripts/reindex-briefings.ts — make the Stork Sightings archive consistent
// without regenerating a briefing: backfill any missing per-issue format files
// from each snapshot's JSON, then rebuild the blog manifest (briefings/index.json).
// Useful after a deploy (so the archive list has titles/tags and every download
// link resolves before the next cron run) or after manually editing snapshots.
//
//   tsx scripts/reindex-briefings.ts            # uses briefings/
//   BRIEFING_OUTPUT_DIR=/path tsx scripts/reindex-briefings.ts

import { rebuildIndex } from '../src/lib/server/briefing/manifest.js';
import { backfillArchiveFormats } from '../src/lib/server/briefing/render/index.js';

async function main() {
	const dir = process.env.BRIEFING_OUTPUT_DIR ?? 'briefings';
	const backfilled = await backfillArchiveFormats(dir);
	process.stderr.write(`[reindex] backfilled ${backfilled} missing format file(s)\n`);
	const issues = await rebuildIndex(dir);
	process.stderr.write(`[reindex] wrote ${dir}/index.json — ${issues.length} issue(s)\n`);
	for (const i of issues) {
		process.stderr.write(`  ${i.date}  ${i.title}  [${(i.tags ?? []).join(', ')}]\n`);
	}
}

main().catch((err) => {
	console.error('FATAL:', err);
	process.exit(1);
});
