// app/utils/getTokenData.ts

import {
  queryTotalSupplyFT,
  queryAuthchainLength,
} from "@/app/utils/queryChainGraph";
import { satoshisToBCH } from "@/app/utils/presentationUtils";

import { TokenData } from "@/app/interfaces";

// REF: raw data sources
// bcmrData
// cauldronPriceData
// cauldronLiquidityData
// tokenTotalSupply
// tokenTotalReservedAmount

// TODO: figure out what type output should be.

async function validateDecimals(decimals: any): Promise<number> {
  if (isNaN(decimals) || decimals < 0 || decimals > 100) {
    throw new Error("Invalid decimals value");
  }
  return decimals;
}

function convertToDecimalString(amount: bigint, decimals: number): string {
  const divisor = BigInt("1" + "0".repeat(decimals));
  const integerPart = amount / divisor;
  const remainder = amount % divisor;
  let result = integerPart.toString();
  if (decimals > 0) {
    const remainderStr = remainder.toString().padStart(decimals, "0");
    result += "." + remainderStr.slice(0, decimals);
  }
  return result;
}

export async function getTokenData(
  tokenCategory: string,
  fixedPrice: number
): Promise<TokenData[]> {
  const bcmrServer = "https://bcmr.paytaca.com/api/tokens/";
  const cauldronServer = "https://cauldronapi.panmoni.com";
  const chaingraphServer = "https://gql.chaingraph.pat.mn/v1/graphql";

  try {
    const bcmrResponse = await fetch(bcmrServer + tokenCategory);
    const bcmrData = await bcmrResponse.json();

    const tokenDecimals = await validateDecimals(bcmrData.token.decimals);

    const cauldronPriceResponse = await fetch(
      `${cauldronServer}/token_price?category=${tokenCategory}&decimals=${tokenDecimals}`
    );

    const cauldronPriceData = await cauldronPriceResponse.json();

    const cauldronLiquidityResponse = await fetch(
      `${cauldronServer}/token_liquidity?category=${tokenCategory}`
    );
    const cauldronLiquidityData = await cauldronLiquidityResponse.json();

    const maxSupplyData = await queryTotalSupplyFT(
      tokenCategory,
      chaingraphServer
    );

    if (
      !maxSupplyData.data ||
      !maxSupplyData.data.transaction ||
      !maxSupplyData.data.transaction[0] ||
      !maxSupplyData.data.transaction[0].outputs
    ) {
      throw new Error("Invalid response structure");
    }

    let totalSupplyBigInt = BigInt(0);
    maxSupplyData.data.transaction[0].outputs.forEach((output: any) => {
      totalSupplyBigInt += BigInt(output.fungible_token_amount);
    });
    const tokenTotalSupplyString = convertToDecimalString(
      totalSupplyBigInt,
      tokenDecimals
    );

    const tokenReservedSupplyData = await queryAuthchainLength(
      tokenCategory,
      chaingraphServer
    );

    let tokenTotalReservedAmountBigInt = BigInt(0);

    if (
      tokenReservedSupplyData.data.transaction[0].authchains[0].authhead
        .identity_output[0].fungible_token_amount
    ) {
      tokenTotalReservedAmountBigInt = BigInt(
        tokenReservedSupplyData.data.transaction[0].authchains[0].authhead
          .identity_output[0].fungible_token_amount
      );
    }

    const tokenUSDPrice = cauldronPriceData?.result
      ? satoshisToBCH(
          (cauldronPriceData.result.buy + cauldronPriceData.result.sell) / 2
        ) * fixedPrice
      : 0;

    const tokenCirculatingSupplyBigInt =
      totalSupplyBigInt - tokenTotalReservedAmountBigInt;
    const tokenCirculatingSupplyString = convertToDecimalString(
      tokenCirculatingSupplyBigInt,
      tokenDecimals
    );

    const tokenCirculatingSupplyNumber = Number(tokenCirculatingSupplyString);

    const tokenMarketCap = tokenCirculatingSupplyNumber * tokenUSDPrice;

    const totalValueLocked =
      satoshisToBCH(cauldronLiquidityData.result.bch) * fixedPrice;

    const tokenDescription = bcmrData.description || "No description available";

    const tokenData: TokenData = {
      icon: bcmrData.uris.icon,
      name: bcmrData.name,
      description: tokenDescription,
      symbol: bcmrData.token.symbol,
      price: tokenUSDPrice,
      circulatingSupply: tokenCirculatingSupplyString,
      maxSupply: tokenTotalSupplyString,
      marketCap: tokenMarketCap.toString(),
      tvl: totalValueLocked,
      category: tokenCategory,
    };

    return [tokenData];
  } catch (error) {
    console.error("Error fetching data:", error);
    throw error;
  }
}