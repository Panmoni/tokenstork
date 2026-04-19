// @/app/hooks/useTokenData.ts
"use client";

import { useState, useEffect } from "react";
import { getTokenData } from "@/app/utils/getTokenData";
import { useBCHPrice } from "@/app/providers/bchpriceclientprovider";
import { TokenData } from "@/app/interfaces";
import tokenIds from "@/app/utils/tokenIds";

const EXPIRE_TIME = 86400000; // 24 hours

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