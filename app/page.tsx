// app/page.tsx
"use client";

import { Suspense } from "react";
import TokenGrid from "@/app/components/TokenGrid";
import TokenSkeleton from "@/app/components/TokenSkeleton";
import { useTokenData } from "@/app/hooks/useTokenData";
import { useBCHPrice } from "@/app/providers/bchpriceclientprovider";

function TokenPageContent() {
  const { bchPrice, isLoading: priceLoading } = useBCHPrice();
  const { tokens, isLoading: tokensLoading, error } = useTokenData();

  if (priceLoading || tokensLoading) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent">
            BCH CashTokens
          </h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2">
            Discover, track and analyze the growing ecosystem of tokens on Bitcoin Cash
          </p>
        </div>
        <TokenSkeleton />
      </main>
    );
  }

  if (error || !bchPrice) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-12">
          <div className="text-red-500 text-lg mb-2">Unable to load token data</div>
          <div className="text-slate-500 dark:text-slate-400">
            Please check your connection and try again
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent">
          BCH CashTokens
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mt-2">
          Discover, track and analyze the growing ecosystem of tokens on Bitcoin Cash
        </p>
      </div>
      <TokenGrid tokens={tokens} isLoading={false} />
    </main>
  );
}

export default function TokenDataPage() {
  return (
    <Suspense fallback={<div className="max-w-7xl mx-auto px-4 py-8"><TokenSkeleton /></div>}>
      <TokenPageContent />
    </Suspense>
  );
}