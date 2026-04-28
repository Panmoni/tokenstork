<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';

	// Up/down vote control. Three click semantics (matches Reddit / YouTube):
	//   ↑ on none → up
	//   ↑ on up   → none (retract)
	//   ↑ on down → up   (flip)
	// Symmetric for ↓.
	//
	// Auth: page.data.user gates writes; logged-out clicks navigate to
	// /login?return=<path>. The user's current vote is read from
	// page.data.userVoteByCategory (populated by +layout.server.ts).
	// Counts are visible to everyone; only the click action is gated.

	type Vote = 'up' | 'down';
	type VoteState = Vote | null;

	interface Props {
		categoryHex: string;
		upCount: number;
		downCount: number;
		size?: 'sm' | 'md';
	}

	let { categoryHex, upCount, downCount, size = 'sm' }: Props = $props();

	const user = $derived(page.data?.user as { cashaddr: string } | null | undefined);
	const layoutVote = $derived(
		(page.data?.userVoteByCategory as Record<string, Vote> | undefined)?.[categoryHex] ?? null
	);

	// Optimistic state (vote + counts) so the UI flips instantly on click.
	// All three null when we're synced with the layout/server payload.
	let optimisticVote = $state<VoteState | undefined>(undefined);
	let optimisticUp = $state<number | undefined>(undefined);
	let optimisticDown = $state<number | undefined>(undefined);

	const currentVote = $derived(optimisticVote !== undefined ? optimisticVote : layoutVote);
	const displayUp = $derived(optimisticUp ?? upCount);
	const displayDown = $derived(optimisticDown ?? downCount);
	const score = $derived(displayUp - displayDown);

	let busy = $state(false);

	const arrowClass = $derived(size === 'md' ? 'w-5 h-5' : 'w-4 h-4');
	const textClass = $derived(size === 'md' ? 'text-sm' : 'text-xs');

	async function castVote(target: Vote) {
		if (!user) {
			const path = page.url.pathname + page.url.search;
			await goto(`/login?return=${encodeURIComponent(path)}`);
			return;
		}
		if (busy) return;

		// Click on the same direction = retract.
		const next: VoteState = currentVote === target ? null : target;

		// Compute optimistic count delta off the *current* state so a flip
		// (e.g. down → up) moves both counters in one click.
		let dUp = 0;
		let dDown = 0;
		if (currentVote === 'up') dUp -= 1;
		if (currentVote === 'down') dDown -= 1;
		if (next === 'up') dUp += 1;
		if (next === 'down') dDown += 1;

		const prevVote = currentVote;
		const prevUp = displayUp;
		const prevDown = displayDown;

		optimisticVote = next;
		optimisticUp = displayUp + dUp;
		optimisticDown = displayDown + dDown;

		busy = true;
		try {
			const res = await fetch(`/api/tokens/${categoryHex}/vote`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ vote: next })
			});
			if (res.status === 401) {
				// Session expired between page load and click — bounce to login.
				optimisticVote = prevVote;
				optimisticUp = prevUp;
				optimisticDown = prevDown;
				const path = page.url.pathname + page.url.search;
				await goto(`/login?return=${encodeURIComponent(path)}`);
				return;
			}
			if (!res.ok) throw new Error(`${res.status}`);
			const data = (await res.json()) as { vote: VoteState; upCount: number; downCount: number };
			optimisticVote = data.vote;
			optimisticUp = data.upCount;
			optimisticDown = data.downCount;
			// Refresh layout so other VoteButtons / leaderboards stay canonical.
			await invalidateAll();
			optimisticVote = undefined;
			optimisticUp = undefined;
			optimisticDown = undefined;
		} catch (err) {
			optimisticVote = prevVote;
			optimisticUp = prevUp;
			optimisticDown = prevDown;
			console.error('vote failed:', err);
			setTimeout(() => {
				optimisticVote = undefined;
				optimisticUp = undefined;
				optimisticDown = undefined;
			}, 1500);
		} finally {
			busy = false;
		}
	}

	const upActive = $derived(currentVote === 'up');
	const downActive = $derived(currentVote === 'down');
	const scoreColorClass = $derived(
		score > 0
			? 'text-emerald-600 dark:text-emerald-400'
			: score < 0
				? 'text-rose-600 dark:text-rose-400'
				: 'text-slate-500 dark:text-slate-400'
	);
</script>

<span class="inline-flex items-center gap-0.5">
	<button
		type="button"
		onclick={(e) => {
			e.preventDefault();
			e.stopPropagation();
			castVote('up');
		}}
		disabled={busy}
		class="inline-flex items-center justify-center p-0.5 rounded transition-colors {upActive
			? 'text-emerald-500 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-300'
			: 'text-slate-400 hover:text-emerald-500 dark:text-slate-500 dark:hover:text-emerald-400'} disabled:opacity-50"
		aria-label={upActive ? 'Retract upvote' : 'Upvote'}
		aria-pressed={upActive}
		title={user
			? upActive
				? 'You upvoted (click to retract)'
				: 'Click to upvote'
			: 'Sign in to vote'}
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill={upActive ? 'currentColor' : 'none'}
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={arrowClass}
			aria-hidden="true"
		>
			<path d="M12 4l8 9h-5v7h-6v-7H4z" />
		</svg>
	</button>

	<span class="tabular-nums {textClass} {scoreColorClass}" title="Net score: {displayUp} up · {displayDown} down">
		{score}
	</span>

	<button
		type="button"
		onclick={(e) => {
			e.preventDefault();
			e.stopPropagation();
			castVote('down');
		}}
		disabled={busy}
		class="inline-flex items-center justify-center p-0.5 rounded transition-colors {downActive
			? 'text-rose-500 hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-300'
			: 'text-slate-400 hover:text-rose-500 dark:text-slate-500 dark:hover:text-rose-400'} disabled:opacity-50"
		aria-label={downActive ? 'Retract downvote' : 'Downvote'}
		aria-pressed={downActive}
		title={user
			? downActive
				? 'You downvoted (click to retract)'
				: 'Click to downvote'
			: 'Sign in to vote'}
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill={downActive ? 'currentColor' : 'none'}
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={arrowClass}
			aria-hidden="true"
		>
			<path d="M12 20l-8-9h5V4h6v7h5z" />
		</svg>
	</button>
</span>
