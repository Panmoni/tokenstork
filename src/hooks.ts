// Universal hooks (run on both server and client).
//
// `reroute` de-localizes the incoming URL so SvelteKit's router resolves a
// locale-prefixed path (e.g. `/es/mint`) to the underlying route tree
// (`/mint`). The locale itself is detected separately by Paraglide
// (paraglideMiddleware in hooks.server.ts + the compiled runtime), driven by
// the URL prefix. English is the base locale and carries NO prefix, so its
// URLs pass through unchanged.

import type { Reroute } from '@sveltejs/kit';
import { deLocalizeUrl } from '$lib/paraglide/runtime';

export const reroute: Reroute = (request) => {
	return deLocalizeUrl(request.url).pathname;
};
