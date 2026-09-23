// /briefing/feed.xml — RSS 2.0 feed for Stork Sightings, the canonical open
// format for a blog. Built from the issue manifest; each item links to the
// dated permalink under /briefing/archive/<slug>.

import { join } from 'node:path';
import type { RequestHandler } from './$types';
import { readIndex } from '$lib/server/briefing/manifest';

const BRIEFINGS_DIR = 'briefings';
const MAX_ITEMS = 50;

function esc(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export const GET: RequestHandler = async ({ url }) => {
	const origin = url.origin;
	const issues = (await readIndex(join(process.cwd(), BRIEFINGS_DIR))).slice(0, MAX_ITEMS);

	const lastBuild = issues[0]?.generatedAt
		? new Date(issues[0].generatedAt).toUTCString()
		: new Date(0).toUTCString();

	const items = issues
		.map((i) => {
			const link = `${origin}/briefing/archive/${i.slug}`;
			const pubDate = new Date(i.generatedAt || i.date).toUTCString();
			const description = [i.dek, i.summary].filter(Boolean).join(' — ');
			const categories = (i.tags ?? []).map((t) => `    <category>${esc(t)}</category>`).join('\n');
			return [
				'  <item>',
				`    <title>${esc(i.title)}</title>`,
				`    <link>${esc(link)}</link>`,
				`    <guid isPermaLink="true">${esc(link)}</guid>`,
				`    <pubDate>${pubDate}</pubDate>`,
				description ? `    <description>${esc(description)}</description>` : '',
				categories,
				'  </item>'
			]
				.filter(Boolean)
				.join('\n');
		})
		.join('\n');

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Stork Sightings</title>
  <link>${origin}/briefing</link>
  <atom:link href="${origin}/briefing/feed.xml" rel="self" type="application/rss+xml" />
  <description>The daily newsletter of the Bitcoin Cash CashToken ecosystem — market movers, new tokens, holder shifts, and ecosystem health.</description>
  <language>en</language>
  <lastBuildDate>${lastBuild}</lastBuildDate>
${items}
</channel>
</rss>`;

	return new Response(xml, {
		headers: {
			'content-type': 'application/rss+xml; charset=utf-8',
			'cache-control': 'public, max-age=600'
		}
	});
};
