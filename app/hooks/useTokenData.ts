// @/app/hooks/useTokenData.ts
"use client";

import { useState, useEffect } from "react";
import { getTokenData } from "@/app/utils/getTokenData";
import { useBCHPrice } from "@/app/providers/bchpriceclientprovider";
import { TokenData } from "@/app/interfaces";

const EXPIRE_TIME = 86400000; // 24 hours

interface TokenListItem {
  id: string;
  name: string | null;
  symbol: string | null;
}

export function useTokenData() {
  const { bchPrice } = useBCHPrice();
  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (bchPrice === null) return;

    const fetchTokenData = async () => {
      setIsLoading(true);
      try {
        const now = Date.now();
        const expiry = localStorage.getItem("token_data_cache") || "";

        if (!expiry || parseInt(expiry) - now < 0) {
          localStorage.clear();
          localStorage.setItem("token_data_cache", String(now + EXPIRE_TIME));
        }

        // Fetch token list from DB API (falls back to empty if DB not set up)
        let tokenIds: string[] = [];
        try {
          const tokensRes = await fetch("/api/tokens", {
            cache: "no-cache",
          });
          if (tokensRes.ok) {
            const data = await tokensRes.json();
            tokenIds = data.tokens.map((t: TokenListItem) => t.id);
          }
        } catch (e) {
          console.warn("Could not fetch tokens from DB, using fallback");
        }

        // Fallback: if DB returns empty, try static tokenIds (for initial dev)
        if (tokenIds.length === 0) {
          const { default: fallbackIds } = await import("@/app/utils/tokenIds");
          tokenIds = fallbackIds;
        }

        const results = await Promise.all(
          tokenIds.map(async (category) => {
            try {
              return await getTokenData(category, parseFloat(bchPrice.toFixed(2)));
            } catch {
              return null;
            }
          })
        );

        const allTokenData = results.flat().filter((d): d is TokenData => d !== null);
        setTokens(allTokenData);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    };

    fetchTokenData();
  }, [bchPrice]);

  return { tokens, isLoading, error };
}