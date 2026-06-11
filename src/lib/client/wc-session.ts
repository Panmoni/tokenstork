// Shared WalletConnect session for cross-route reuse.
// Login stores the session here; mint reads it so the user
// doesn't need to re-scan a QR on every transaction.
//
// Must be a plain module-level variable (not Svelte state)
// to survive SvelteKit soft navigations.

export const wcSession = {
	client: null as unknown | null,
	session: null as { topic: string } | null,
	cashaddr: null as string | null
};
