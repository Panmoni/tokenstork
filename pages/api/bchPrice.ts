// @/pages/api/bchPrice.ts

import type { NextApiRequest, NextApiResponse } from "next";
import NextCors from "nextjs-cors";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  let errors = [];
  try {
    await NextCors(req, res, {
      methods: ["GET"],
      origin: (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void
      ) => {
        const allowedOrigins = [
          "https://tokenstork.com",
          "http://localhost:3000",
          "http://localhost:5173",
          "https://drop.tokenstork.com",
        ];

        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      },
      optionsSuccessStatus: 200,
    });

    const cryptoCompareUrl =
      "https://min-api.cryptocompare.com/data/price?fsym=BCH&tsyms=USD";

    const apiKey = process.env.CRYPTO_COMPARE_KEY;
    if (!apiKey) {
      errors.push("cryptocompare: CRYPTO_COMPARE_KEY is not set")
    }

    const options = {
      method: "GET",
      headers: {
        Apikey: apiKey,
      } as Record<string, string>,
    };
    const ccResponse = await fetch(cryptoCompareUrl, options);
    const ccData = await ccResponse.json();
    if (ccResponse.ok && ccData.USD) {
      res.status(200).json({ USD: ccData.USD });
      return;
    } else {
      errors.push(`Failed to fetch price from cryptocompare: ${ccResponse.status}`)
    }

    // Fallback: CoinGecko API
    const coingeckoUrl =
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd";
    const cgResponse = await fetch(coingeckoUrl);
    const cgData = await cgResponse.json();

    if (cgResponse.ok && cgData["bitcoin-cash"] && cgData["bitcoin-cash"].usd) {
      res.status(200).json({ USD: cgData["bitcoin-cash"].usd });
      return;
    }

    errors.push(`Failed to fetch price from coingecko: ${cgResponse.status}`)

  } catch (error) {
    errors.push(`Exception in internal API: ${error}`)
  }
  // If we haven't returned yet, finding price failed.
  if (!errors.length) {
    errors.push("Unknown error");
  }
  errors.unshift("Error(s) fetching price in internal API");
  res.status(500).json({ error: errors.join("; ") });
}
