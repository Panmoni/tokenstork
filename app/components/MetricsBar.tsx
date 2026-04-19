"use client";

import { useBCHPrice } from "@/app/providers/bchpriceclientprovider";
import tokenIds from "@/app/utils/tokenIds";

export default function MetricsBar() {
  const { bchPrice } = useBCHPrice();

  return (
    <div className="bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 border-b border-slate-200 dark:border-slate-700">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-3">
        {/* Desktop: Horizontal layout */}
        <div className="hidden md:flex items-center justify-between">
          <div className="flex items-center gap-8">
            {/* Tokens tracked */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Tracked
              </span>
              <span className="px-3 py-1 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 font-semibold text-sm">
                {tokenIds.length}
              </span>
            </div>

            {/* BCH Price */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                BCH
              </span>
              {bchPrice ? (
                <span className="font-mono text-slate-900 dark:text-white font-semibold">
                  ${bchPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              ) : (
                <span className="inline-block w-16 h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
              )}
            </div>
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400">
            Updates every 5 min
          </div>
        </div>

        {/* Mobile: Grid layout */}
        <div className="md:hidden grid grid-cols-2 gap-3 py-2">
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-slate-800 shadow-sm">
            <span className="text-xs text-slate-500 dark:text-slate-400">Tokens</span>
            <span className="font-semibold text-violet-600 dark:text-violet-400">{tokenIds.length}</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-slate-800 shadow-sm">
            <span className="text-xs text-slate-500 dark:text-slate-400">BCH</span>
            {bchPrice ? (
              <span className="font-mono font-semibold">${bchPrice.toFixed(2)}</span>
            ) : (
              <span className="w-12 h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}