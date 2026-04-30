<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import ThemeSwitcher from './ThemeSwitcher.svelte';

	// Nav entries render left-to-right on desktop and top-down in the
	// mobile drawer. Terms and Privacy live at /terms and /privacy and
	// stay in the footer — the header is for primary navigation.
	const navigation = [
		{ name: 'Tokens', href: '/' },
		{ name: 'CRC-20', href: '/crc20' },
		{ name: 'Arbitrage', href: '/arbitrage' },
		{ name: 'Mint', href: '/mint' },
		{ name: 'Blocks', href: '/blocks' },
		{ name: 'Mining', href: '/mining' },
		{ name: 'Stats', href: '/stats' }
	];

	// Logged-in cashaddr (or null) comes through the layout server load
	// via hooks.server.ts. Truncated for the header pill — full cashaddr
	// is in the title attribute for hover.
	const user = $derived(page.data?.user as { cashaddr: string } | null | undefined);
	const truncatedCashaddr = $derived.by(() => {
		if (!user?.cashaddr) return null;
		const a = user.cashaddr;
		// "bitcoincash:qr…ddy" — keep the prefix-stripped suffix readable.
		const stripped = a.startsWith('bitcoincash:') ? a.slice('bitcoincash:'.length) : a;
		if (stripped.length <= 12) return stripped;
		return `${stripped.slice(0, 6)}…${stripped.slice(-4)}`;
	});

	// Count of tokens in the user's watchlist. Comes through the layout's
	// watchlistCategoryHexes; surfaced in the header as a small "(N)"
	// pill next to a Watchlist link when authenticated AND non-empty.
	const watchlistCount = $derived.by(() => {
		const cats = page.data?.watchlistCategoryHexes as string[] | undefined;
		return cats?.length ?? 0;
	});

	async function logout() {
		try {
			await fetch('/api/auth/logout', { method: 'POST' });
		} catch {
			// Even if the server call failed, the cookie is single-use and
			// expires; we can fail gracefully on the client.
		}
		await invalidateAll();
		await goto('/');
	}

	let mobileMenuOpen = $state(false);

	// Account dropdown — shown when authenticated. Holds the cashaddr pill +
	// Sign out so the header stops carrying both inline. Click-outside +
	// Esc both close.
	let userMenuOpen = $state(false);
	let userMenuEl: HTMLDivElement | undefined = $state();

	function onWindowClick(e: MouseEvent) {
		if (!userMenuOpen) return;
		if (userMenuEl && !userMenuEl.contains(e.target as Node)) {
			userMenuOpen = false;
		}
	}
	function onWindowKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') userMenuOpen = false;
	}

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

<svelte:window onclick={onWindowClick} onkeydown={onWindowKeydown} />

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
				{#if user && truncatedCashaddr}
					<div class="flex items-center gap-3">
						{#if watchlistCount > 0}
							<a
								href="/watchlist"
								class="text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white inline-flex items-center gap-1"
								title="Your tracked tokens"
							>
								Watchlist
								<span class="px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 font-semibold">
									{watchlistCount}
								</span>
							</a>
						{/if}
						<div class="relative" bind:this={userMenuEl}>
							<button
								type="button"
								onclick={() => (userMenuOpen = !userMenuOpen)}
								class="p-1.5 rounded-full text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800 transition-colors"
								aria-label="Account menu"
								aria-haspopup="menu"
								aria-expanded={userMenuOpen}
								title={user.cashaddr}
							>
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5" aria-hidden="true">
									<circle cx="12" cy="8" r="4" />
									<path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
								</svg>
							</button>
							{#if userMenuOpen}
								<div
									class="absolute right-0 mt-2 w-56 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg py-1 z-50"
									role="menu"
								>
									<div class="px-3 py-2 border-b border-slate-100 dark:border-slate-800">
										<div class="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">Signed in as</div>
										<div class="font-mono text-xs text-emerald-700 dark:text-emerald-300 mt-1 truncate" title={user.cashaddr}>
											{truncatedCashaddr}
										</div>
									</div>
									<button
										type="button"
										onclick={() => {
											userMenuOpen = false;
											logout();
										}}
										class="w-full text-left px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
										role="menuitem"
									>
										Sign out
									</button>
								</div>
							{/if}
						</div>
					</div>
				{:else}
					<a
						href={`/login${pathname !== '/' ? `?return=${encodeURIComponent(pathname)}` : ''}`}
						class="text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
					>
						Sign in
					</a>
				{/if}
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
				<div class="border-t border-slate-200 dark:border-slate-800 mt-2 pt-2">
					{#if user && truncatedCashaddr}
						<div class="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">
							Signed in as
							<span class="font-mono text-emerald-700 dark:text-emerald-300" title={user.cashaddr}>
								{truncatedCashaddr}
							</span>
						</div>
						<button
							type="button"
							onclick={() => {
								mobileMenuOpen = false;
								logout();
							}}
							class="w-full text-left block px-4 py-3 rounded-lg text-base font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
						>
							Sign out
						</button>
					{:else}
						<a
							href={`/login${pathname !== '/' ? `?return=${encodeURIComponent(pathname)}` : ''}`}
							onclick={() => (mobileMenuOpen = false)}
							class="block px-4 py-3 rounded-lg text-base font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
						>
							Sign in
						</a>
					{/if}
				</div>
			</div>
		</div>
	</nav>
</header>
