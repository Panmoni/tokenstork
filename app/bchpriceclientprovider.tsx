"use client";

import React, {
  createContext,
  useContext,
  ReactNode,
  useState,
  useEffect,
} from "react";

interface BCHPriceContextProps {
  bchPrice: number | null;
  setBchPrice: React.Dispatch<React.SetStateAction<number | null>>;
}

const BCHPriceContext = createContext<BCHPriceContextProps | undefined>(
  undefined
);

export const useBCHPrice = () => {
  const context = useContext(BCHPriceContext);
  if (!context) {
    throw new Error("useBCHPrice must be used within a BCHPriceProvider");
  }
  return context;
};

export const BCHPriceProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [bchPrice, setBchPrice] = useState<number | null>(null);

  useEffect(() => {
    // Fetch BCH price from CoinGecko
    const fetchBCHPrice = async () => {
      try {
        const response = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd"
        );
        const data = await response.json();
        setBchPrice(data["bitcoin-cash"].usd);
      } catch (error) {
        console.error("Error fetching BCH price:", error);
      }
    };

    fetchBCHPrice();
  }, []);

  return (
    <BCHPriceContext.Provider value={{ bchPrice, setBchPrice }}>
      {children}
    </BCHPriceContext.Provider>
  );
};
