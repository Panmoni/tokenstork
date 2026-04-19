export default function TokenSkeleton() {
  return (
    <div className="space-y-4">
      {/* Header skeleton */}
      <div className="h-8 w-48 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
      <div className="h-4 w-64 bg-slate-100 dark:bg-slate-800/50 rounded animate-pulse mb-8" />

      {/* Search bar skeleton */}
      <div className="flex gap-3 mb-6">
        <div className="h-12 flex-1 bg-slate-200 dark:bg-slate-800 rounded-xl animate-pulse" />
        <div className="h-12 w-32 bg-slate-200 dark:bg-slate-800 rounded-xl animate-pulse" />
      </div>

      {/* Desktop table skeleton */}
      <div className="hidden md:block rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-slate-50 dark:bg-slate-900/50">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-4 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
          ))}
        </div>
        {/* Rows */}
        {[...Array(8)].map((_, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 px-4 py-4 border-b border-slate-100 dark:border-slate-800/50">
            <div className="col-span-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-800 animate-pulse" />
              <div className="space-y-2 flex-1">
                <div className="h-4 w-24 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                <div className="h-3 w-32 bg-slate-100 dark:bg-slate-800/50 rounded animate-pulse" />
              </div>
            </div>
            <div className="col-span-1 h-4 bg-slate-200 dark:bg-slate-800 rounded animate-pulse self-center" />
            <div className="col-span-2 h-4 bg-slate-200 dark:bg-slate-800 rounded animate-pulse self-center ml-auto" />
            <div className="col-span-2 h-4 bg-slate-200 dark:bg-slate-800 rounded animate-pulse self-center ml-auto" />
            <div className="col-span-2 h-4 bg-slate-200 dark:bg-slate-800 rounded animate-pulse self-center ml-auto" />
            <div className="col-span-2 h-6 w-16 bg-slate-200 dark:bg-slate-800 rounded-full animate-pulse self-center ml-auto" />
          </div>
        ))}
      </div>

      {/* Mobile cards skeleton */}
      <div className="md:hidden grid gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-800 animate-pulse" />
                <div>
                  <div className="h-4 w-24 bg-slate-200 dark:bg-slate-800 rounded animate-pulse mb-1" />
                  <div className="h-3 w-16 bg-slate-100 dark:bg-slate-800/50 rounded animate-pulse" />
                </div>
              </div>
              <div className="h-6 w-12 bg-slate-200 dark:bg-slate-800 rounded-full animate-pulse" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[...Array(3)].map((_, j) => (
                <div key={j} className="space-y-1">
                  <div className="h-3 w-12 bg-slate-100 dark:bg-slate-800/50 rounded animate-pulse" />
                  <div className="h-4 w-16 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}