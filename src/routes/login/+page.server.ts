// /login — wallet-signature login.
//
// SSR loader exists only to (a) redirect already-logged-in users to the
// home page and (b) surface the user's claimed address for the header.
// All authentication state lives in hooks.server.ts + /api/auth/*.

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) {
		// Already logged in. Bounce to the URL specified in ?return= if it
		// looks like a same-origin path, otherwise to the home page.
		//
		// Defense-in-depth against open-redirect:
		//   - Must start with `/`
		//   - Must NOT start with `//` (protocol-relative → off-site)
		//   - Must NOT start with `/\` (browsers normalize `\` → `/`,
		//     turning `/\evil.com` into `//evil.com` post-redirect — the
		//     classic Chrome/Firefox path-traversal bypass)
		const ret = url.searchParams.get('return');
		const safeReturn =
			ret &&
			ret.startsWith('/') &&
			!ret.startsWith('//') &&
			!ret.startsWith('/\\')
				? ret
				: '/';
		throw redirect(303, safeReturn);
	}
	return {};
};
