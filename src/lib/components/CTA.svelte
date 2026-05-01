<script lang="ts">
	import { Button } from '$lib/components/ui/button';
</script>

<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
	<section
		class="mt-8 rounded-2xl border border-slate-200 dark:border-zinc-800 bg-gradient-to-br from-violet-600 via-indigo-600 to-violet-700 dark:from-violet-700 dark:via-indigo-800 dark:to-violet-900 shadow-lg overflow-hidden relative"
	>
		<div class="absolute inset-0 opacity-20 pointer-events-none" aria-hidden="true">
			<div class="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-white/40 blur-3xl"></div>
			<div class="absolute -bottom-20 -left-20 w-72 h-72 rounded-full bg-white/30 blur-3xl"></div>
		</div>

		<div
			class="relative flex flex-col items-center justify-between gap-6 p-6 md:p-10 lg:flex-row lg:gap-10"
		>
			<div class="flex items-center gap-4 text-center lg:text-left">
				<div
					class="hidden sm:flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15 text-white"
					aria-hidden="true"
				>
					<svg class="w-6 h-6" fill="currentColor" viewBox="0 0 1200 1227" xmlns="http://www.w3.org/2000/svg">
						<path d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.826Z" />
					</svg>
				</div>
				<div class="text-white">
					<h3 class="text-xl md:text-2xl font-semibold leading-snug">
						Follow Panmoni on X for BCH &amp; CashTokens updates
					</h3>
					<p class="mt-1 text-sm text-white/80">
						The team behind TokenStork — product launches, dev notes, and ecosystem signal.
					</p>
				</div>
			</div>

			<Button
				href="https://x.com/Panmonicom"
				size="lg"
				class="bg-white text-slate-900 hover:bg-slate-100 no-underline shadow-md shrink-0"
				target="_blank"
				rel="noopener noreferrer"
			>
				<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 1200 1227" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
					<path d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.826Z" />
				</svg>
				Follow @Panmonicom
			</Button>
		</div>
	</section>
</div>
