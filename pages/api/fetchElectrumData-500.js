import { ElectrumCluster, ElectrumTransport } from "electrum-cash";

// const { ElectrumCluster, ElectrumTransport } = require("electrum-cash");

export default async (req, res) => {
  const category = req.query.category;
  const decimals = parseInt(req.query.decimals, 10);

  if (!category) {
    return res.status(400).json({ error: "Category is required" });
  }

  if (isNaN(decimals)) {
    return res
      .status(400)
      .json({ error: "Decimals is required and should be a number" });
  }

  function calculateAmount(decimals) {
    return decimals === 0 ? 1 : Math.pow(10, decimals);
  }

  const electrum = new ElectrumCluster("TokenStork.com", "1.4.3", 1, 1);
  electrum.addServer(
    "rostrum.cauldron.quest",
    50004,
    ElectrumTransport.WSS.Scheme
  );

  try {
    await electrum.ready();
  } catch (e) {
    console.error("Failed to connect ", e);
    return res.status(500).json({ error: "Failed to connect to Electrum" });
  }

  const amount = calculateAmount(decimals);

  try {
    const response = await electrum.request(
      "cauldron.contract.token_price",
      2,
      category,
      amount
    );

    // Check if the response contains valid price data
    if (!response || (response.buy === 0 && response.sell === 0)) {
      return res.json({ price: "N/A", liquidity: "N/A" });
    }

    if (
      !response ||
      typeof response.buy !== "number" ||
      typeof response.sell !== "number"
    ) {
      console.error("Invalid response from Electrum.");
      return res.status(500).json({ error: "Failed to fetch price data." });
    }

    const liquidity = await electrum.request(
      "cauldron.contract.token_value_locked",
      2,
      category
    );

    // Shutdown the Electrum cluster
    await electrum.shutdown();

    const price = (response.buy + response.sell) / 2;

    // Send the data as a response
    res.json({ price, liquidity });
  } catch (error) {
    console.error("Error while fetching data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
