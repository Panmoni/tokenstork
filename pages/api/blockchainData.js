// @/pages/api/blockchainData.js
import { ElectrumCluster, ElectrumTransport } from "electrum-cash";
// import NextCors from "nextjs-cors";

const electrum = new ElectrumCluster("TokenStork.com", "1.5.1", 1, 1);

electrum.addServer("fulcrum.greyh.at");
// electrum.addServer("electroncash.de");
// electrum.addServer("electroncash.dk");
// electrum.addServer("bitcoincash.network");

console.log("Connecting to Electrum servers...");
await electrum.ready();
console.log("Connected to Electrum servers.");

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:5173");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle OPTIONS request
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  try {
    // await NextCors(req, res, {
    //   methods: ["GET"],
    //   origin: (origin, callback) => {
    //     const allowedOrigins = [
    //       "https://tokenstork.com",
    //       "https://drop.tokenstork.com",
    //       "http://localhost:3000",
    //       "http://localhost:5173",
    //     ];

    //     if (!origin || allowedOrigins.indexOf(origin) !== -1) {
    //       callback(null, true);
    //     } else {
    //       callback(new Error("Not allowed by CORS"));
    //     }
    //   },
    //   optionsSuccessStatus: 200,
    // });

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
      scripthash
    );

    // Fetch UTXOs
    const userUtxos = await electrum.request(
      "blockchain.scripthash.listunspent",
      scripthash
    );

    // Return the fetched data
    res.status(200).json({ balance: userBalance, utxos: userUtxos });
  } catch (error) {
    console.error("Error fetching data:", error);
    res.status(500).json({ error: error.message });
  } finally {
    electrum.shutdown();
  }
}
