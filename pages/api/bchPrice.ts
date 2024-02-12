// @/pages/api/bchPrice.ts

import type { NextApiRequest, NextApiResponse } from "next";
import NextCors from "nextjs-cors";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
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
      throw new Error("CRYPTO_COMPARE_KEY is not set");
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

    throw new Error("Failed to fetch BCH price from both APIs");
  } catch (error) {
    console.error("Error fetching BCH price from internal API:", error);
    res.status(500).json({ error: "Failed to fetch BCH price from both APIs" });
  }
}
