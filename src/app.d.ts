// See https://svelte.dev/docs/kit/types#app
declare global {
	const __GIT_COMMIT__: string;

	namespace App {
		// interface Error {}
		interface Locals {
			/** Populated by hooks.server.ts when a valid session cookie
			 *  is present. Loaders + endpoints read this to render
			 *  logged-in state without re-querying the sessions table. */
			user?: {
				cashaddr: string;
			};
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
