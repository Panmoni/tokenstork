import { ElectrumCluster, ElectrumTransport } from "electrum-cash";

const electrum = new ElectrumCluster("TokenStork.com", "1.5.1", 1, 1);

// electrum.addServer(
//   "fulcrum.greyh.at",
//   ElectrumTransport.WSS.Port,
//   ElectrumTransport.WSS.Scheme
// );

// electrum.addServer("electroncash.de");
// electrum.addServer("electroncash.dk");
// electrum.addServer("bitcoincash.network");
electrum.addServer("fulcrum.greyh.at");

console.log("Connecting to Electrum servers...");
await electrum.ready();
console.log("Connected to Electrum servers.");

export default async function handler(req, res) {
  try {
    // Extract BCH address from request
    const userAddress = req.query.address; // Or req.body.address if using POST
    if (!userAddress) {
      throw new Error("Address not provided");
    }
    console.log("user address:", userAddress);

    // Convert BCH address to script hash
    // const script = Script.fromAddress(userAddress);
    // const scriptHash = script.toScriptHash();

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
