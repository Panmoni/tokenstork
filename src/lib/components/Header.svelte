<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ThemeSwitcher from './ThemeSwitcher.svelte';

	// Nav entries render left-to-right on desktop and top-down in the
	// mobile drawer. Terms/Privacy live under the /tos page as anchors
	// and stay in the footer — the header is for primary navigation.
	const navigation = [
		{ name: 'Tokens', href: '/' },
		{ name: 'Arbitrage', href: '/arbitrage' },
		{ name: 'Stats', href: '/stats' },
		{ name: 'Learn', href: '/learn' }
	];

	let mobileMenuOpen = $state(false);

	const pathname = $derived(page.url.pathname);

	// Header search — only surfaces on non-home pages. The home page
	// already has its own full-width, debounced, live-filtering search
	// box at the top of TokenGrid, and duplicating that here would
	// compete with it for focus + URL state. On other pages the
	// visitor has no search surface, so a compact "jump to the
	// directory filtered by X" input makes sense.
	//
	// Behavior: local input state, submit on <form> to /?search=<val>.
	// No debounce; the input isn't live-filtering anything on this
	// page, it's a navigation shortcut.
	const showSearch = $derived(pathname !== '/');
	let headerSearch = $state('');

	function submitHeaderSearch(e: Event) {
		e.preventDefault();
		const q = headerSearch.trim();
		if (q) {
			goto(`/?search=${encodeURIComponent(q)}`);
			headerSearch = '';
			mobileMenuOpen = false;
		}
	}
</script>

<header class="sticky top-0 z-50 backdrop-blur-xl bg-white/80 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800">
	<nav class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="flex h-16 items-center justify-between">
			<div class="flex-shrink-0">
				<a href="/" class="flex items-center">
					<img src="/logo-simple-bch.png" alt="TokenStork" class="h-10 w-auto" />
				</a>
			</div>

			<div class="hidden md:flex md:items-center md:space-x-6 lg:space-x-8">
				{#each navigation as item (item.name)}
					{@const active = pathname === item.href}
					<a
						href={item.href}
						class="relative text-sm font-medium transition-colors duration-200 {active
							? 'text-violet-600 dark:text-violet-400'
							: 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'}"
					>
						{item.name}
						{#if active}
							<span class="absolute -bottom-[1.625rem] left-0 right-0 h-0.5 bg-gradient-to-r from-violet-600 to-indigo-500 rounded-full"></span>
						{/if}
					</a>
				{/each}
			</div>

			<div class="hidden md:flex md:items-center md:gap-3">
				{#if showSearch}
					<!--
						Hidden until `lg` (1024px+) because at md (768-1023px)
						the logo + 6-item nav + 224px search + ThemeSwitcher
						overflows the container. Mobile drawer still carries
						the search below that breakpoint.
					-->
					<form onsubmit={submitHeaderSearch} class="relative hidden lg:block">
						<input
							type="search"
							placeholder="Search tokens…"
							bind:value={headerSearch}
							maxlength="128"
							class="w-56 pl-9 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
							aria-label="Search tokens"
						/>
						<svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
						</svg>
					</form>
				{/if}
				<ThemeSwitcher />
			</div>

			<div class="flex md:hidden items-center gap-2">
				<ThemeSwitcher />
				<button
					onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
					class="p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800"
					aria-label="Toggle menu"
				>
					{#if mobileMenuOpen}
						<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-6 w-6">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
						</svg>
					{:else}
						<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-6 w-6">
							<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
						</svg>
					{/if}
				</button>
			</div>
		</div>

		<div class="md:hidden overflow-hidden transition-all duration-300 {mobileMenuOpen ? 'max-h-[32rem] opacity-100' : 'max-h-0 opacity-0'}">
			<div class="py-4 space-y-1 border-t border-slate-200 dark:border-slate-800">
				{#if showSearch}
					<form onsubmit={submitHeaderSearch} class="relative mb-2 px-2">
						<input
							type="search"
							placeholder="Search tokens…"
							bind:value={headerSearch}
							maxlength="128"
							class="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
							aria-label="Search tokens"
						/>
						<svg class="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
						</svg>
					</form>
				{/if}
				{#each navigation as item (item.name)}
					{@const active = pathname === item.href}
					<a
						href={item.href}
						onclick={() => (mobileMenuOpen = false)}
						class="block px-4 py-3 rounded-lg text-base font-medium transition-colors duration-200 {active
							? 'bg-violet-50 text-violet-600 dark:bg-violet-900/20 dark:text-violet-400'
							: 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'}"
					>
						{item.name}
					</a>
				{/each}
			</div>
		</div>
	</nav>
</header>
