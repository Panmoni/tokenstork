// app/utils/getTokenData.ts

import {
  queryTotalSupplyFT,
  queryAuthchainLength,
  getCirculatingTokens,
} from "@/app/utils/queryChainGraph";
import { satoshisToBCH } from "@/app/utils/presentationUtils";
import { TokenData } from "@/app/interfaces";

async function validateDecimals(decimals: any): Promise<number> {
  if (decimals === undefined || decimals === null) {
    return 0;
  }
  if (isNaN(decimals) || decimals < 0 || decimals > 8) {
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

const CAULDRON_INDEXER = "https://indexer.cauldron.quest/cauldron";

export async function getTokenData(
  tokenCategory: string,
  fixedPrice: number
): Promise<TokenData[]> {
  const bcmrServer = "https://bcmr.paytaca.com/api/tokens/";
  const chaingraphServer = "https://gql.chaingraph.panmoni.com/api/v1/graphql";

  try {
    const bcmrResponse = await fetch(bcmrServer + tokenCategory);
    const bcmrData = await bcmrResponse.json();

    const tokenDecimals = await validateDecimals(bcmrData.token.decimals);

    const cauldronPriceResponse = await fetch(
      `${CAULDRON_INDEXER}/price/${tokenCategory}/current`
    );
    const cauldronPriceData = await cauldronPriceResponse.json();

    const cauldronLiquidityResponse = await fetch(
      `${CAULDRON_INDEXER}/valuelocked/${tokenCategory}`
    );
    const cauldronLiquidityData = await cauldronLiquidityResponse.json();

    // Wrapping queryTotalSupplyFT in try-catch
    let maxSupplyBigInt = BigInt(0);
    try {
      const maxSupplyData = await queryTotalSupplyFT(tokenCategory, chaingraphServer);
      if (
        maxSupplyData.data &&
        maxSupplyData.data.transaction &&
        maxSupplyData.data.transaction[0] &&
        maxSupplyData.data.transaction[0].outputs
      ) {
        maxSupplyData.data.transaction[0].outputs.forEach((output: any) => {
          maxSupplyBigInt += BigInt(output.fungible_token_amount);
        });
      }
    } catch (error) {
      console.error("Error fetching max supply:", error);
    }

    // Wrapping getCirculatingTokens in try-catch
    try {
      const new_supply = await getCirculatingTokens(tokenCategory);
      maxSupplyBigInt = BigInt(new_supply);
    } catch (error) {
      console.error("Error fetching circulating supply:", error);
    }

    const tokenTotalSupplyString = convertToDecimalString(maxSupplyBigInt, tokenDecimals);

    // Wrapping queryAuthchainLength in try-catch
    let tokenTotalReservedAmountBigInt = BigInt(0);
    try {
      const tokenReservedSupplyData = await queryAuthchainLength(
        tokenCategory,
        chaingraphServer
      );
      if (
        tokenReservedSupplyData.data &&
        tokenReservedSupplyData.data.transaction[0] &&
        tokenReservedSupplyData.data.transaction[0].authchains[0].authhead.identity_output[0]
          .fungible_token_amount
      ) {
        tokenTotalReservedAmountBigInt = BigInt(
          tokenReservedSupplyData.data.transaction[0].authchains[0].authhead.identity_output[0]
            .fungible_token_amount
        );
      }
    } catch (error) {
      console.error("Error fetching reserved supply:", error);
    }

    // Price and market cap calculations
    const tokenUSDPrice = cauldronPriceData?.price
      ? satoshisToBCH(cauldronPriceData.price * Math.pow(10, tokenDecimals)) * fixedPrice
      : 0;

    const tokenCirculatingSupplyBigInt = maxSupplyBigInt - tokenTotalReservedAmountBigInt;
    const tokenCirculatingSupplyString = convertToDecimalString(
      tokenCirculatingSupplyBigInt,
      tokenDecimals
    );

    const tokenCirculatingSupplyNumber = Number(tokenCirculatingSupplyString);

    // Market cap fallback to "Not Available" if any issues with circulating supply or price
    const tokenMarketCap = tokenUSDPrice > 0 && tokenCirculatingSupplyNumber > 0
      ? tokenCirculatingSupplyNumber * tokenUSDPrice
      : "Not Available";

    var totalValueLockedRaw = cauldronLiquidityData?.satoshis
      ? satoshisToBCH(cauldronLiquidityData.satoshis) * fixedPrice
      : 0;

    const totalValueLocked = totalValueLockedRaw * 2;

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
      circulatingSupplyBigInt: tokenCirculatingSupplyBigInt,
      maxSupplyBigInt: maxSupplyBigInt,
      marketCapBigInt: BigInt(Math.round(tokenMarketCap as number)),
      category: tokenCategory,
    };

    return [tokenData];
  } catch (error) {
    console.error("Error fetching data:", error);
    throw error;
  }
}


// REF: raw data sources
// bcmrData
// cauldronPriceData
// cauldronLiquidityData
// tokenTotalSupply
// tokenTotalReservedAmount

// TODO: figure out what type output should be.
// TODO: funnel price and bcmr data into a db, and then pull it from there for the website. This might make the cauldronapi.panmoni.com redundant, tho guru are using it, so maybe create api.panmoni.com or something and host the data there from the db? Or even just put the API inside this same app.
// TODO: implement comprehensive error handling in getTokenData
// Consider what should happen if an API fails. Should the function continue with partial data, return null, or throw an error?
// After each API call, validate the response structure to ensure the data exists. OR perhaps this is unnecessary if I'm going to implement the database.
// 3. **Type Safety for JSON Responses**: Ensure the types for the API JSON responses are properly defined. Currently, the script assumes that the JSON response will match the expected structure. You should define interfaces for these responses to ensure type safety.
// 4. **TypeScript Types**: Use TypeScript interfaces or types to enforce the structure of the data you're expecting from each API.
// 5. **Data Validation After JSON Parsing**: There should be checks after parsing the JSON to ensure the data contains the expected fields before attempting to access them.
// 6. **Error Handling and Fallbacks**: When an API call fails, consider how this should affect the function's output. For non-critical data, you might provide a default value, whereas for critical data, it might be appropriate to throw an error. This decision should be based on how the data is used downstream.