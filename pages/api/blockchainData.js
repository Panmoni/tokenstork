// @/pages/api/blockchainData.js
import { ElectrumCluster, ElectrumTransport } from "electrum-cash";
import NextCors from "nextjs-cors";

export default async function handler(req, res) {
  await NextCors(req, res, {
    methods: ["GET", "OPTIONS"],
    origin: "*",
    allowedHeaders: [
      "Content-Type",
      "Cache-Control",
      "Pragma",
      "Expires",
      "Accept",
    ],
  });

  const electrum = new ElectrumCluster("TokenStork.com", "1.5.1", 1, 1);

  electrum.addServer("fulcrum.jettscythe.xyz");
  electrum.addServer("fulcrum.greyh.at");
  electrum.addServer("electroncash.de");
  electrum.addServer("electroncash.dk");
  electrum.addServer("bch.loping.net");

  console.log("Connecting to Electrum servers...");
  await electrum.ready();
  console.log("Connected to Electrum servers.");

  try {
    // Extract BCH address from request
    const userAddress = req.query.address;
    if (!userAddress) {
      throw new Error("Address not provided");
    }
    console.log("user address:", userAddress);

    const scripthash = await electrum.request(
      "blockchain.address.get_scripthash",
      userAddress
    );
    console.log("scripthash:", scripthash);

    // Fetch balance
    const userBalance = await electrum.request(
      "blockchain.scripthash.get_balance",
      scripthash,
      "exclude_tokens"
    );
    console.log("userBalance:", userBalance);

    // Fetch UTXOs
    const userUtxos = await electrum.request(
      "blockchain.scripthash.listunspent",
      scripthash
    );
    console.log("userUtxos:", userUtxos);

    // Return the fetched data
    res.status(200).json({ balance: userBalance, utxos: userUtxos });
  } catch (error) {
    // Enhanced error logging
    console.error("Error occurred in /api/blockchainData endpoint:");
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);

    // Send a detailed error message to the client, only if it's safe to expose it
    // You might want to send a generic message in production for security reasons
    res.status(500).json({
      error: "An error occurred while processing your request.",
      // details: error.message, // Consider removing this line in production
    });
  } finally {
    electrum.shutdown();
  }
}
