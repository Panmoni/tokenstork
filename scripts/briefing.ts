// scripts/briefing.ts — CLI / cron runner for Stork Sightings.
//
//   tsx scripts/briefing.ts              # generate + deliver (email if configured)
//   tsx scripts/briefing.ts --dry-run    # generate + print to stdout, no delivery
//   tsx scripts/briefing.ts --json       # print the Briefing object as JSON
//   tsx scripts/briefing.ts --out ./briefings  # write all output formats
//
// Mirrors gmsecurity's src/runner.ts pattern. Exit 0 on success, 1 on hard
// failure. Individual query / LLM failures are captured in the briefing stats,
// never crash the run.

import { generateBriefing } from '../src/lib/server/briefing/index.js';
import { loadConfig } from '../src/lib/server/briefing/config.js';
import { deliverBriefing } from '../src/lib/server/briefing/deliver.js';
import type { Briefing } from '../src/lib/server/briefing/types.js';

function arg(flag: string): string | boolean {
	const i = process.argv.indexOf(flag);
	if (i === -1) return false;
	const next = process.argv[i + 1];
	return next && !next.startsWith('--') ? next : true;
}

async function main() {
	const cfg = loadConfig();
	const isDryRun = arg('--dry-run') !== false;
	const jsonOnly = arg('--json') !== false;

	if (typeof arg('--out') === 'string') {
		cfg.outputDir = arg('--out') as string;
	}

	process.stderr.write(`⬢ Stork Sightings — ${new Date().toISOString().slice(0, 16)} UTC\n`);
	process.stderr.write(`  Window: last ${cfg.windowHours}h\n`);
	if (cfg.llm.apiKey) {
		process.stderr.write(`  LLM primary: ${cfg.llm.model}\n`);
		process.stderr.write(`  LLM reviewer: ${cfg.llm.reviewModel}\n`);
	} else {
		process.stderr.write(`  LLM: disabled (no API key)\n`);
	}

	const { briefing } = await generateBriefing(cfg);

	if (jsonOnly) {
		process.stdout.write(JSON.stringify(briefing, null, 2));
		process.stdout.write('\n');
		return;
	}

	if (isDryRun) {
		printDiagnostics(briefing);
		process.stdout.write('\n');
		if (briefing.executiveSummary) {
			process.stdout.write(briefing.executiveSummary);
			process.stdout.write('\n');
		}
		if (briefing.trends.length > 0) {
			process.stdout.write('\nTRENDS:\n');
			for (const t of briefing.trends) process.stdout.write(`  • ${t.text}\n`);
		}
		if (briefing.tokenProfile) {
			process.stdout.write(`\nTOKEN OF THE DAY: ${briefing.tokenProfile.symbol || briefing.tokenProfile.name}\n`);
			process.stdout.write(`  ${briefing.tokenProfile.narrative}\n`);
		}
		return;
	}

	await deliverBriefing(briefing, cfg);
	printDiagnostics(briefing);
}

function printDiagnostics(b: Briefing): void {
	const diags = b.stats.queryDiagnostics;
	process.stderr.write(`\nQUERY DIAGNOSTICS\n`);
	for (const d of diags) {
		const status = d.error ? '✗' : d.rowCount > 0 ? '✓' : '·';
		const ms = String(d.durationMs).padStart(4);
		process.stderr.write(
			d.error
				? `  ${status} ${d.name.padEnd(20)} ${ms}ms  ERROR: ${d.error}\n`
				: `  ${status} ${d.name.padEnd(20)} ${ms}ms  ${d.rowCount} rows\n`
		);
	}
	const ok = diags.filter((d) => !d.error).length;
	process.stderr.write(
		`  ── ${diags.length} queries (${ok} ok / ${diags.length - ok} failed) · ` +
		`${b.stats.signalSetsWithData}/${b.stats.totalSignalSets} signal sets with data\n` +
		`     LLM: ${b.stats.llmCallsMade} calls · ${b.stats.llmTokensUsed} tokens · ` +
		`${b.stats.llmCallsFailed} failed\n`
	);
	if (b.stats.reviewFindings) {
		const r = b.stats.reviewFindings;
		process.stderr.write(`     Review: ${r.factualErrors.length} errors · ${r.missedInsights.length} missed · ${r.toneSuggestions.length} suggestions\n`);
	}
}

main().catch((err) => {
	console.error('FATAL:', err);
	process.exit(1);
});
