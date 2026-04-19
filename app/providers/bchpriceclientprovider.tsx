// @/app/providers/bchpriceclientprovider.tsx
"use client";

import { useState, useEffect, useCallback, createContext, useContext } from "react";

interface BCHPriceContextProps {
  bchPrice: number | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

const BCHPriceContext = createContext<BCHPriceContextProps | null>(null);

async function fetchBCHPrice(): Promise<number> {
  const response = await fetch("/api/bchPrice");
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error);
  }
  if (data.USD === undefined) {
    throw new Error("BCH price not available");
  }
  return data.USD;
}

export function useBCHPrice() {
  const context = useContext(BCHPriceContext);

  if (context) {
    return context;
  }

  // Fallback for SSR without context
  const [bchPrice, setBchPrice] = useState<number | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    fetchBCHPrice()
      .then(setBchPrice)
      .catch((e) => setError(e instanceof Error ? e : new Error("Unknown error")));
  }, []);

  return {
    bchPrice,
    isLoading: false,
    error,
    refetch: () => {
      fetchBCHPrice()
        .then(setBchPrice)
        .catch((e) => setError(e instanceof Error ? e : new Error("Unknown error")));
    },
  };
}

export function BCHPriceProvider({ children }: { children: React.ReactNode }) {
  const [bchPrice, setBchPrice] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchPrice = useCallback(async () => {
    setIsLoading(true);
    try {
      const price = await fetchBCHPrice();
      setBchPrice(price);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error("Unknown error"));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrice();
    // Refetch every 5 minutes
    const interval = setInterval(fetchPrice, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchPrice]);

  const value: BCHPriceContextProps = {
    bchPrice,
    isLoading,
    error,
    refetch: fetchPrice,
  };

  return (
    <BCHPriceContext.Provider value={value}>
      {children}
    </BCHPriceContext.Provider>
  );
}