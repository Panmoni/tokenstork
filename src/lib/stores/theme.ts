// Class-based light/dark theme with localStorage persistence.
// Replaces next-themes. The toggle sets `dark` on <html> for Tailwind
// (darkMode: 'class') and `data-theme` for any non-Tailwind consumers.

import { get, writable } from 'svelte/store';
import { browser } from '$app/environment';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'tokenstork-theme';

function getInitial(): Theme {
	if (!browser) return 'light';
	const stored = localStorage.getItem(STORAGE_KEY);
	if (stored === 'light' || stored === 'dark') return stored;
	return window.matchMedia('(prefers-color-scheme: dark)').matches
		? 'dark'
		: 'light';
}

function apply(theme: Theme) {
	if (!browser) return;
	const root = document.documentElement;
	root.classList.toggle('dark', theme === 'dark');
	root.setAttribute('data-theme', theme);
}

function createThemeStore() {
	const { subscribe, set } = writable<Theme>('light');

	function init() {
		if (!browser) return;
		const t = getInitial();
		set(t);
		apply(t);
	}

	function setTheme(t: Theme) {
		set(t);
		apply(t);
		if (browser) localStorage.setItem(STORAGE_KEY, t);
	}

	function toggle() {
		setTheme(get({ subscribe }) === 'dark' ? 'light' : 'dark');
	}

	return { subscribe, init, setTheme, toggle };
}

export const theme = createThemeStore();
