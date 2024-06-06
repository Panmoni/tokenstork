// @/app/providers/bchpriceclientprovider.tsx
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
    const fetchBCHPrice = async () => {
      try {
        const response = await fetch("/api/bchPrice");
        const data = await response.json();
        if (data.error) {
          throw Error(data.error);
        }
        if (data.USD === undefined) {
          console.log("internal bch price API response:", data);
          throw Error("BCH price not set")
        }
        setBchPrice(data.USD);
      } catch (error) {
        console.error("Error fetching BCH price from internal API:", error);
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
