import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const url = "https://fear-and-greed-index.p.rapidapi.com/v1/fgi";

    const apiKey = process.env.FEAR_AND_GREED_API_KEY;
    if (!apiKey) {
      res.status(200).json({ fgi: { now: { value: null } } });
      return;
    }

    const options = {
      method: "GET",
      headers: {
        "X-RapidAPI-Key": process.env.FEAR_AND_GREED_API_KEY,
        "X-RapidAPI-Host": "fear-and-greed-index.p.rapidapi.com",
      } as Record<string, string>,
    };
    const response = await fetch(url, options);
    const data = await response.json();

    if (data.error) {
      res.status(200).json({ fgi: { now: { value: null } } });
      return;
    }

    res.status(200).json(data);
  } catch (error) {
    res.status(200).json({ fgi: { now: { value: null } } });
  }
}
