// hellobar.tsx
"use client";
import React, { useState, useEffect } from "react";
import tokenIds from "./tokenIds";
import { useBCHPrice } from "./bchpriceclientprovider";

const HelloBar: React.FC = () => {
  const { bchPrice } = useBCHPrice();
  const [fearGreedIndex, setFearGreedIndex] = useState<number | null>(null);

  useEffect(() => {
    // Fetch Fear and Greed index
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
    <div id="hello-bar">
      <p>
        FTs tracked: <span id="ftCount">{tokenIds.length}</span> | BCH Price:
        <span id="bch-price"> ${bchPrice ? bchPrice.toFixed(2) : "..."}</span> |
        CNN Fear & Greed:
        <span id="fear-greed"> {fearGreedIndex || "..."}</span>
      </p>
    </div>
  );
};

export default HelloBar;
