// See https://svelte.dev/docs/kit/types#app
declare global {
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
