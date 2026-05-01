<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';

	// A star button that toggles a category in the user's wallet-tied
	// watchlist. Renders an outline star when not watching, a filled
	// emerald star when watching.
	//
	// Auth state comes from page.data.user (populated by hooks.server.ts +
	// the layout server load). When unauthenticated, the click navigates
	// to /login?return=<current path> so the user comes back here after
	// signing in.

	interface Props {
		categoryHex: string;
		size?: 'sm' | 'md';
	}

	let { categoryHex, size = 'sm' }: Props = $props();

	const user = $derived(page.data?.user as { cashaddr: string } | null | undefined);
	const watchlist = $derived((page.data?.watchlistCategoryHexes as string[] | undefined) ?? []);

	// Local override so the UI flips immediately on click without waiting
	// for invalidateAll() to round-trip the layout load. Falls back to the
	// canonical layout state when null.
	let optimisticState: boolean | null = $state(null);
	const watching = $derived(
		optimisticState !== null ? optimisticState : watchlist.includes(categoryHex)
	);

	let busy = $state(false);

	const sizeClass = $derived(size === 'md' ? 'w-5 h-5' : 'w-4 h-4');

	async function onClick(e: Event) {
		e.preventDefault();
		e.stopPropagation();

		if (!user) {
			// Stash the current path so we land back here after auth.
			const path = page.url.pathname + page.url.search;
			await goto(`/login?return=${encodeURIComponent(path)}`);
			return;
		}

		if (busy) return;
		busy = true;
		const next = !watching;
		optimisticState = next;
		try {
			const res = await fetch('/api/watchlist/toggle', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ category: categoryHex })
			});
			// 401 means the session expired between page load and click —
			// the layout-rendered logged-in state was stale. Redirect to
			// /login with a return-URL so the user lands back here, then
			// they can click the star again.
			if (res.status === 401) {
				optimisticState = null;
				const path = page.url.pathname + page.url.search;
				await goto(`/login?return=${encodeURIComponent(path)}`);
				return;
			}
			if (!res.ok) throw new Error(`${res.status}`);
			const data = (await res.json()) as { inWatchlist: boolean };
			optimisticState = data.inWatchlist;
			// Refresh the layout's watchlist set so other pages + the
			// header pill stay consistent.
			await invalidateAll();
			optimisticState = null; // canonical state has caught up
		} catch (err) {
			// Roll back the optimistic flip.
			optimisticState = !next;
			console.error('watchlist toggle failed:', err);
			setTimeout(() => (optimisticState = null), 1500);
		} finally {
			busy = false;
		}
	}
</script>

<button
	type="button"
	onclick={onClick}
	disabled={busy}
	class="inline-flex items-center justify-center p-1 rounded transition-colors {watching
		? 'text-emerald-500 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-300'
		: 'text-slate-400 hover:text-amber-500 dark:text-zinc-400 dark:hover:text-amber-400'} disabled:opacity-50"
	aria-label={watching ? 'Remove from watchlist' : 'Add to watchlist'}
	aria-pressed={watching}
	title={user
		? watching
			? 'In your watchlist (click to remove)'
			: 'Click to add to your watchlist'
		: 'Sign in to track tokens'}
>
	{#if watching}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="currentColor"
			class={sizeClass}
			aria-hidden="true"
		>
			<path
				d="M12 2.5l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.42l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95L12 2.5z"
			/>
		</svg>
	{:else}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linejoin="round"
			class={sizeClass}
			aria-hidden="true"
		>
			<path
				d="M12 2.5l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.42l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95L12 2.5z"
			/>
		</svg>
	{/if}
</button>
