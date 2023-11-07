"use client";
import React, { useState, useEffect } from "react";
import tokenIds from "../utils/tokenIds";
import TinyLoader from "./TinyLoader";
import { useBCHPrice } from "../providers/bchpriceclientprovider";

// TODO: add BCH dominance from CMC or coingecko https://www.coingecko.com/en/api
// TODO: add crypto FGI from alternative.me https://api.alternative.me/fng/, https://alternative.me/crypto/fear-and-greed-index/
// TODO: maybe add BCH as number 0 in the table using these APIs?

const HelloBar: React.FC = () => {
  const { bchPrice } = useBCHPrice();
  const [fearGreedIndex, setFearGreedIndex] = useState<number | null>(null);

  useEffect(() => {
    async function getFGI() {
      try {
        const response = await fetch("/api/fearAndGreed");
        const data = await response.json();
        setFearGreedIndex(data.fgi.now.value);
      } catch (error) {
        console.error(error);
      }
    }
    getFGI();
  }, []);

  return (
    <div className="bg-primary text-white flex items-center">
      <div className="case text-xs tracking-wider text-center px-4 py-3">
        FTs tracked: <span>{tokenIds.length}</span> | BCH Price:&nbsp;
        {bchPrice ? "$" + bchPrice.toFixed(2) : <TinyLoader />} &nbsp;| CNN Fear
        & Greed:&nbsp; {fearGreedIndex || <TinyLoader />}
      </div>
    </div>
  );
};

export default HelloBar;
