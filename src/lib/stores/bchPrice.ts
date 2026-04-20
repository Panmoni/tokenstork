// BCH/USD price store. Mirrors app/providers/bchpriceclientprovider.tsx:
// fetch on mount, refresh every 5 minutes, expose { bchPrice, isLoading,
// error, refetch }.

import { writable, type Readable } from 'svelte/store';
import { browser } from '$app/environment';

export interface BchPriceState {
	bchPrice: number | null;
	isLoading: boolean;
	error: Error | null;
}

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function createBchPriceStore() {
	const state = writable<BchPriceState>({
		bchPrice: null,
		isLoading: true,
		error: null
	});

	let interval: ReturnType<typeof setInterval> | null = null;

	async function fetchPrice() {
		state.update((s) => ({ ...s, isLoading: true }));
		try {
			const res = await fetch('/api/bchPrice');
			const data = await res.json();
			if (data.error) throw new Error(data.error);
			if (data.USD === undefined) throw new Error('BCH price not available');
			state.set({ bchPrice: data.USD, isLoading: false, error: null });
		} catch (e) {
			state.update((s) => ({
				...s,
				isLoading: false,
				error: e instanceof Error ? e : new Error('Unknown error')
			}));
		}
	}

	function start() {
		if (!browser || interval) return;
		fetchPrice();
		interval = setInterval(fetchPrice, REFRESH_INTERVAL_MS);
	}

	function stop() {
		if (interval) {
			clearInterval(interval);
			interval = null;
		}
	}

	return {
		subscribe: state.subscribe,
		start,
		stop,
		refetch: fetchPrice
	} satisfies Readable<BchPriceState> & {
		start: () => void;
		stop: () => void;
		refetch: () => Promise<void>;
	};
}

export const bchPrice = createBchPriceStore();
