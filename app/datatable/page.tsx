import React, { useState, useEffect } from "react";
import Image from "next/image";

// utils
import tokenIds from "@/app/utils/tokenIds.js";
import {
  satoshisToBCH,
  humanizeBigNumber,
} from "@/app/utils/presentationUtils";
import {
  queryTotalSupplyFT,
  queryAuthchainLength,
} from "@/app/utils/queryChainGraph";
import { useBCHPrice } from "@/app/providers/bchpriceclientprovider";

// components
import Toast from "@/app/components/Toast";
import TinyLoader from "@/app/components/TinyLoader";

// raw data sources
// bcmrData
// cauldronPriceData
// cauldronLiquidityData
// tokenTotalSupply
// tokenTotalReservedAmount

type tokenData = {
  icon: string,
  name: string,
  description: string,
  symbol: string,
  price:  number,
  circulatingSupply: number, 
  maxSupply: number,
  marketCap: number,
  tvl: number,
  category: string,
};

// TODO: implement comprehensive error handling
// TODO: implement skeleton load

export default function DataTable() {
  const [data, setData] = useState<tokenData[]>([]);
  const [toastMessage, setToastMessage] = useState("");

  // copy functions
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

  // TODO: should this be a more full-fledged function and its own file?

  const fetchData = async () => {

    // variables
    const tokenCategory = "d9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea";
    const bcmrServer = "https://bcmr.paytaca.com/api/tokens/";
    const cauldronServer = "https://cauldronapi.panmoni.com";
    const chaingraphServer = "https://gql.chaingraph.pat.mn/v1/graphql";

    const { bchPrice } = useBCHPrice();

    try {
      const bcmrAPI = await fetch(
        bcmrServer + tokenCategory
      );
      const bcmrData = await bcmrAPI.json();

      const tokenDecimals = bcmrData.token.decimals;

      const cauldronPriceAPI = await fetch(
        cauldronServer + "/token_price?category=" + tokenCategory + "&decimals=" + tokenDecimals
      );
      const cauldronPriceData = await cauldronPriceAPI.json();

      const cauldronLiquidityAPI = await fetch(
        cauldronServer + "/token_liquidity?category=" + tokenCategory
      );
      const cauldronLiquidityData = await cauldronLiquidityAPI.json();

      // Get the max supply from chaingraph
      const maxSupplyData = await queryTotalSupplyFT(tokenCategory, chaingraphServer);

        if (
          !maxSupplyData.data ||
          !maxSupplyData.data.transaction ||
          !maxSupplyData.data.transaction[0] ||
          !maxSupplyData.data.transaction[0].outputs
        ) {
          throw new Error("Invalid response structure");
        }

        // TODO: what if there simply is no decimals value?

        if (isNaN(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 100) {
          throw new Error("Invalid decimals value");
        }

        let tokenTotalSupply = maxSupplyData.data.transaction[0].outputs.reduce(
          (total: bigint, output: { fungible_token_amount: string }) => {
            if (typeof output.fungible_token_amount !== "string") {
              throw new Error("Invalid token amount");
            }
            let amount = BigInt(output.fungible_token_amount);
            return total + amount;
          },
          BigInt(0)
        );

        // Convert to a decimal form
        tokenTotalSupply = tokenTotalSupply / BigInt(Math.pow(10, tokenDecimals));

        // convert it back to a number
        tokenTotalSupply = tokenTotalSupply === "" ? "0" : tokenTotalSupply;
        tokenTotalSupply = Number(tokenTotalSupply);

      const tokenReservedSupplyData = await queryAuthchainLength(tokenCategory, chaingraphServer);

        if (
          !tokenReservedSupplyData.data.transaction[0].authchains[0].authhead
            .identity_output[0].fungible_token_amount
        ) {
          let tokenTotalReservedAmount = 0;
          return tokenTotalReservedAmount;
        } else {
          if (isNaN(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 100) {
            throw new Error("Invalid decimals value");
          }

          let tokenTotalReservedAmount =
          tokenReservedSupplyData.data.transaction?.[0]?.authchains?.[0]?.authhead
              ?.identity_output?.[0]?.fungible_token_amount;

          tokenTotalReservedAmount = BigInt(tokenTotalReservedAmount);

          // Convert to a decimal form
          tokenTotalReservedAmount =
          tokenTotalReservedAmount / BigInt(Math.pow(10, decimals));

          // convert it back to a number
          tokenTotalReservedAmount =
          tokenTotalReservedAmount === "" ? "0" : tokenTotalReservedAmount;
          tokenTotalReservedAmount = Number(tokenTotalReservedAmount);
        }

      let tokenUSDPrice = ((cauldronPriceData.result.buy +cauldronPriceData.result.sell)/2) * bchPrice.toFixed(2);

      let tokenCirculatingSupply = tokenTotalSupply - tokenTotalReservedAmount;

      let tokenMarketCap = tokenCirculatingSupply * tokenUSDPrice;

      let totalValueLocked = satoshisToBCH(cauldronLiquidityData.result.bch) * bchPrice.toFixed(2);

      // Combine data from all APIs into a single object for ease of use
      const tokenData = {
        icon: bcmrData.uris.icon,
        name: bcmrData.name,
        description: bcmrData.token.description,
        symbol: bcmrData.token.symbol,
        price:  tokenUSDPrice,
        circulatingSupply: tokenCirculatingSupply, 
        maxSupply: tokenTotalSupply,
        marketCap: tokenMarketCap,
        tvl: totalValueLocked,
        category: tokenCategory,
      };

      setData(tokenData);
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Table Headers
  // "Name": icon, name, description, symbol
  // "Price": v
  // "Circulating Supply": circulatingSupply
  // "Max Supply": maxSupply
  // "Market Cap": marketCap
  // "TVL": tvl
  // "Category": category

  // use tokenIds recursively

  // itemRow still has a lot of important stuff
  

  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Symbol</th>
          <th>Price</th>
        </tr>
      </thead>
      <tbody>
        {data ? (
          <tr>
            <td>{data.name}</td>
            <td>{data.symbol}</td>
            <td>{data.price}</td>
          </tr>
        ) : (
          <tr>
            <td colSpan={7}><TinyLoader /></td>
          </tr>
        )}
      </tbody>
      {toastMessage && <Toast message={toastMessage} />}
    </table>
  );
};

// TODO: use humanizeBigNumber in the presentation stage