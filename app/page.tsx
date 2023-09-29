"use client";

import React, { useState, useEffect, useCallback } from "react";
import { queryTotalSupplyFT, queryAuthchainLength } from "./queryChainGraph";
import Headers from "./headers";
import Toast from "./toast";
import Container from "./container";
import tokenIds from "./tokenIds.js";
// import { TokenData } from "./interfaces";
// import TokenDataContext from "./contexts/tokendatacontext";

type TokenData = {
  uris: { [key: string]: any };
  token: {
    decimals: number;
    category: string;
    symbol: string;
  };
  maxSupply: string;
  maxSupplyNum: number;
  reservedSupplyFT: string;
  reservedSupplyFTNum: number;
  circSupplyHumanized: string;
};

const chaingraphUrl = "https://gql.chaingraph.pat.mn/v1/graphql";

export default function Page() {
  const [data, setData] = useState<TokenData[]>([]);
  const [toastMessage, setToastMessage] = useState("");

  const fetchDataForAllTokenIds = useCallback(async () => {
    try {
      const promises = tokenIds.map(fetchDataForTokenId);
      const results = await Promise.allSettled(promises);
      return results
        .filter(
          (result): result is PromiseFulfilledResult<any> =>
            result.status === "fulfilled"
        )
        .map((result) => result.value);
    } catch (error) {
      console.error(`Error fetching data for all token ids: `, error);
      return [];
    }

    async function fetchDataForTokenId(tokenId: string) {
      try {
        const response = await fetch(
          `https://bcmr.paytaca.com/api/tokens/${tokenId}`
        );
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const tokenData = await response.json();

        // Fetch max supply
        if (tokenData && tokenData.token) {
          const maxSupply = await getFTMaxSupply(
            tokenId,
            tokenData.token.decimals
          );
          tokenData.maxSupplyNum = maxSupply;
          tokenData.maxSupply = humanizeMaxSupply(maxSupply);
        }

        // Fetch reserved supply
        if (tokenData && tokenData.token) {
          const totalReservedAmount = await getReservedSupplyFT(
            tokenId,
            tokenData.token.decimals
          );
          tokenData.reservedSupplyFT = humanizeMaxSupply(totalReservedAmount);
          tokenData.reservedSupplyFTNum = totalReservedAmount;
          // if (totalReservedAmount === 0) {
          //   tokenData.reservedSupplyFT = 0;
          // } else {
          //   tokenData.getReservedSupplyFT =
          //     humanizeMaxSupply(totalReservedAmount);
          // }
        }

        tokenData.circSupplyHumanized = humanizeMaxSupply(
          tokenData.maxSupplyNum - tokenData.reservedSupplyFTNum
        );

        return tokenData;
      } catch (error) {
        console.error(`Error fetching data for token id ${tokenId}: `, error);
        return {
          uris: {},
          token: {
            decimals: 0,
            category: "",
            symbol: "",
          },
          maxSupply: "N/A",
        };
      }
    }

    // Get the max supply from chaingraph
    async function getFTMaxSupply(tokenId: string, decimals: number) {
      const responseJson = await queryTotalSupplyFT(tokenId, chaingraphUrl);

      if (
        !responseJson.data ||
        !responseJson.data.transaction ||
        !responseJson.data.transaction[0] ||
        !responseJson.data.transaction[0].outputs
      ) {
        throw new Error("Invalid response structure");
      }

      if (isNaN(decimals) || decimals < 0 || decimals > 100) {
        throw new Error("Invalid decimals value");
      }

      let totalAmount = responseJson.data.transaction[0].outputs.reduce(
        (total: bigint, output: { fungible_token_amount: string }) => {
          if (typeof output.fungible_token_amount !== "string") {
            throw new Error("Invalid token amount");
          }
          let amount = BigInt(output.fungible_token_amount);
          return total + amount;
        },
        BigInt(0)
      );

      // console.log("totalAmount before removal of decimal places: ", totalAmount);

      // Convert to a decimal form
      totalAmount = totalAmount / BigInt(Math.pow(10, decimals));

      // console.log("totalAmount after removal of decimal places: ", totalAmount);

      // convert it back to a number
      totalAmount = totalAmount === "" ? "0" : totalAmount;
      totalAmount = Number(totalAmount);

      return totalAmount;
    }

    async function getReservedSupplyFT(tokenId: string, decimals: number) {
      const responseJson = await queryAuthchainLength(tokenId, chaingraphUrl);

      if (
        !responseJson.data.transaction[0].authchains[0].authhead
          .identity_output[0].fungible_token_amount
      ) {
        let totalReservedAmount = 0;
        // console.log(tokenId + ": " + totalReservedAmount);
        return totalReservedAmount;
      } else {
        if (isNaN(decimals) || decimals < 0 || decimals > 100) {
          throw new Error("Invalid decimals value");
        }

        let totalReservedAmount =
          responseJson.data.transaction?.[0]?.authchains?.[0]?.authhead
            ?.identity_output?.[0]?.fungible_token_amount;

        totalReservedAmount = BigInt(totalReservedAmount);

        // Convert to a decimal form
        totalReservedAmount =
          totalReservedAmount / BigInt(Math.pow(10, decimals));

        // convert it back to a number
        totalReservedAmount =
          totalReservedAmount === "" ? "0" : totalReservedAmount;
        totalReservedAmount = Number(totalReservedAmount);

        // reservedSupplyFT?
        // console.log("totalReservedAmount: ", totalReservedAmount);
        return totalReservedAmount;
      }
    }

    // Create and append the max supply in one cell
    // Humanize the max supply
    function humanizeMaxSupply(num: number): string {
      var units = [
        "",
        "thousand",
        "million",
        "billion",
        "trillion",
        "quadrillion",
        "quintillion",
      ];

      // If number is less than 10000, return it as it is
      if (num < 10000) {
        return num.toString();
      }

      // Make sure the number is positive and get its logarithm
      var magnitude = Math.log10(Math.abs(num));

      // Determine the unit to use
      var unitIndex = Math.min(Math.floor(magnitude / 3), units.length - 1);

      // Get the number in terms of that unit
      var normalizedNum = num / Math.pow(10, unitIndex * 3);

      // If decimal part is zero, return integer part only
      if (normalizedNum % 1 === 0) {
        return normalizedNum.toFixed(0) + " " + units[unitIndex];
      }

      // Round to one decimal place and add the unit
      return normalizedNum.toFixed(1) + " " + units[unitIndex];
    }
  }, []);

  useEffect(() => {
    async function fetchData() {
      const fetchedData = await fetchDataForAllTokenIds();
      setData(fetchedData);
    }

    fetchData();
  }, [fetchDataForAllTokenIds]);

  function showToast(message: string) {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage("");
    }, 3000);
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    showToast("Category copied to clipboard");
  }

  return (
    <main>
      <section>
        <Headers />
        {toastMessage && <Toast message={toastMessage} />}
        <Container data={data} copyText={copyText} />
      </section>
    </main>
  );
}
