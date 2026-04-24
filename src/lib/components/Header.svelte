<script lang="ts">
	import { page } from '$app/state';
	import ThemeSwitcher from './ThemeSwitcher.svelte';

	// Nav entries render left-to-right on desktop and top-down in the
	// mobile drawer. Terms/Privacy live under the /tos page as anchors
	// and stay in the footer — the header is for primary navigation.
	const navigation = [
		{ name: 'Tokens', href: '/' },
		{ name: 'Stats', href: '/stats' },
		{ name: 'Learn', href: '/learn' },
		{ name: 'Roadmap', href: '/roadmap' },
		{ name: 'About', href: '/about' }
	];

	let mobileMenuOpen = $state(false);

	const pathname = $derived(page.url.pathname);
</script>

<header class="sticky top-0 z-50 backdrop-blur-xl bg-white/80 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800">
	<nav class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="flex h-16 items-center justify-between">
			<div class="flex-shrink-0">
				<a href="/" class="flex items-center">
					<img src="/logo-simple-bch.png" alt="TokenStork" class="h-10 w-auto" />
				</a>
			</div>

			<div class="hidden md:flex md:items-center md:space-x-8">
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

			<div class="hidden md:flex md:items-center md:gap-4">
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

		<div class="md:hidden overflow-hidden transition-all duration-300 {mobileMenuOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}">
			<div class="py-4 space-y-1 border-t border-slate-200 dark:border-slate-800">
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
