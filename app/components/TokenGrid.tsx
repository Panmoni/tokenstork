"use client";

import { useMemo, useState, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronUpIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import { TokenData } from "@/app/interfaces";
import { humanizeBigNumber, formatMarketCap, getIPFSUrl } from "@/app/utils/presentationUtils";
import FormatCategory from "@/app/components/FormatCategory";

type SortColumn = "name" | "price" | "marketCapBigInt" | "tvl";
type SortDirection = "asc" | "desc";

interface TokenGridProps {
  tokens: TokenData[];
  isLoading?: boolean;
}

function SortIcon({ column, sortColumn, direction }: { column: SortColumn; sortColumn: SortColumn; direction: SortDirection }) {
  if (column !== sortColumn) {
    return <span className="text-slate-300 dark:text-slate-600 ml-1">↕</span>;
  }
  return direction === "asc" ? (
    <ChevronUpIcon className="w-4 h-4 inline ml-1" />
  ) : (
    <ChevronDownIcon className="w-4 h-4 inline ml-1" />
  );
}

export default function TokenGrid({ tokens, isLoading }: TokenGridProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const parentRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState(searchParams?.get("search") || "");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const sortColumn = (searchParams?.get("sort") as SortColumn) || "tvl";
  const sortDirection = (searchParams?.get("dir") as SortDirection) || "desc";

  const updateSort = useCallback((column: SortColumn) => {
    const params = new URLSearchParams(searchParams?.toString() || "");
    if (column === sortColumn) {
      params.set("dir", sortDirection === "asc" ? "desc" : "asc");
    } else {
      params.set("sort", column);
      params.set("dir", "desc");
    }
    router.push(`?${params.toString()}`);
  }, [router, searchParams, sortColumn, sortDirection]);

  const filteredAndSortedTokens = useMemo(() => {
    let result = [...tokens];

    // Filter by search
    if (search) {
      const searchLower = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(searchLower) ||
          t.symbol.toLowerCase().includes(searchLower)
      );
    }

    // Filter by category
    if (categoryFilter !== "all") {
      result = result.filter((t) => t.category === categoryFilter);
    }

    // Sort
    result.sort((a, b) => {
      let aVal = a[sortColumn];
      let bVal = b[sortColumn];

      if (typeof aVal === "string") {
        aVal = aVal.toLowerCase();
        bVal = (bVal as string).toLowerCase();
      }

      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [tokens, search, categoryFilter, sortColumn, sortDirection]);

  const rowVirtualizer = useVirtualizer({
    count: filteredAndSortedTokens.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 10,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Search tokens by name or symbol..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all"
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
        >
          <option value="all">All Categories</option>
          <option value="ft">FTs</option>
          <option value="nft">NFTs</option>
        </select>
      </div>

      {/* Table (Desktop) */}
      <div className="hidden md:block overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
        {/* Header */}
        <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          <div className="col-span-3 cursor-pointer hover:text-violet-600 dark:hover:text-violet-400" onClick={() => updateSort("name")}>
            Token <SortIcon column="name" sortColumn={sortColumn} direction={sortDirection} />
          </div>
          <div className="col-span-1">Ticker</div>
          <div className="col-span-2 text-right cursor-pointer hover:text-violet-600 dark:hover:text-violet-400" onClick={() => updateSort("price")}>
            Price <SortIcon column="price" sortColumn={sortColumn} direction={sortDirection} />
          </div>
          <div className="col-span-2 text-right">Supply</div>
          <div className="col-span-2 text-right cursor-pointer hover:text-violet-600 dark:hover:text-violet-400" onClick={() => updateSort("marketCapBigInt")}>
            Market Cap <SortIcon column="marketCapBigInt" sortColumn={sortColumn} direction={sortDirection} />
          </div>
          <div className="col-span-2 text-right cursor-pointer hover:text-violet-600 dark:hover:text-violet-400" onClick={() => updateSort("tvl")}>
            TVL <SortIcon column="tvl" sortColumn={sortColumn} direction={sortDirection} />
          </div>
        </div>

        {/* Virtualized Rows */}
        <div ref={parentRef} className="max-h-[600px] overflow-auto">
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const token = filteredAndSortedTokens[virtualRow.index];
              return (
                <div
                  key={token.name}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className="grid grid-cols-12 gap-2 px-4 py-4 items-center border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors cursor-pointer group">
                    <div className="col-span-3 flex items-center gap-3">
                      <img
                        src={getIPFSUrl(token.icon)}
                        alt={token.name}
                        className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800"
                        loading="lazy"
                      />
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 dark:text-white truncate group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
                          {token.name}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {token.description.slice(0, 40)}...
                        </div>
                      </div>
                    </div>
                    <div className="col-span-1 font-mono text-sm text-slate-600 dark:text-slate-300">
                      {token.symbol}
                    </div>
                    <div className="col-span-2 text-right font-mono">
                      {token.price === 0 ? (
                        <span className="text-slate-400">-</span>
                      ) : token.price >= 1 ? (
                        <span className="text-slate-900 dark:text-white">${token.price.toFixed(2)}</span>
                      ) : (
                        <span className="text-slate-900 dark:text-white">${token.price.toFixed(6)}</span>
                      )}
                    </div>
                    <div className="col-span-2 text-right text-sm text-slate-600 dark:text-slate-300">
                      {humanizeBigNumber(Number(token.circulatingSupply))}
                    </div>
                    <div className="col-span-2 text-right font-mono text-sm text-slate-900 dark:text-white">
                      {formatMarketCap(token.marketCap)}
                    </div>
                    <div className="col-span-2 text-right">
                      {Number(token.tvl) === 0 ? (
                        <span className="text-slate-400">-</span>
                      ) : (
                        <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs font-medium">
                          ${Number(token.tvl).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Cards (Mobile) */}
      <div className="md:hidden grid gap-3">
        {filteredAndSortedTokens.map((token) => (
          <div
            key={token.name}
            className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 hover:shadow-lg hover:border-violet-200 dark:hover:border-violet-800 transition-all cursor-pointer"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <img
                  src={getIPFSUrl(token.icon)}
                  alt={token.name}
                  className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800"
                />
                <div>
                  <div className="font-semibold text-slate-900 dark:text-white">{token.name}</div>
                  <div className="text-sm text-slate-500">{token.symbol}</div>
                </div>
              </div>
              <FormatCategory category={token.category} />
            </div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Price</div>
                <div className="font-mono font-semibold">
                  {token.price === 0 ? "-" : `$${token.price >= 1 ? token.price.toFixed(2) : token.price.toFixed(6)}`}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Market Cap</div>
                <div className="font-mono">{formatMarketCap(token.marketCap)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">TVL</div>
                <div className="font-mono">
                  {Number(token.tvl) === 0 ? "-" : `$${Number(token.tvl).toLocaleString()}`}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredAndSortedTokens.length === 0 && !isLoading && (
        <div className="text-center py-12">
          <div className="text-slate-400 dark:text-slate-500 text-lg mb-2">No tokens found</div>
          <div className="text-slate-500 dark:text-slate-400 text-sm">
            Try adjusting your search or filter criteria
          </div>
        </div>
      )}
    </div>
  );
}