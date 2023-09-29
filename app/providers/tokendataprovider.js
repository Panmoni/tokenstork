// providers/TokenDataProvider.js

"use client";

import React, { useState, useEffect } from "react";
import TokenDataContext from "../contexts/tokendatacontext";

const TokenDataProvider = ({ children, tokenId }) => {
  const [tokenData, setTokenData] = useState([]);

  useEffect(() => {
    const fetchDataForTokenId = async (tokenId) => {
      try {
        const response = await fetch(
          `https://bcmr.paytaca.com/api/tokens/${tokenId}`
        );
        if (!response.ok) {
          console.error(`HTTP error! status: ${response.status}`);
          setTokenData([]); // Set default array here
          return;
        }
        const data = await response.json();
        setTokenData(data);
      } catch (error) {
        console.error("Error fetching token details:", error);
        setTokenData([]); // Set default array here
      }
    };

    fetchDataForTokenId(tokenId);
  }, [tokenId]);

  return (
    <TokenDataContext.Provider value={tokenData}>
      {children}
    </TokenDataContext.Provider>
  );
};

export default TokenDataProvider;
