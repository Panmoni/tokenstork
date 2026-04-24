// shadcn-svelte conventional helper: merge classNames with Tailwind-aware
// dedupe. Exists here (not at `src/lib/cn.ts`) because shadcn-svelte's
// CLI + registry look for `$lib/utils` when adding new components.

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}
