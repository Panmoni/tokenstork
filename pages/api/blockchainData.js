// @/pages/api/blockchainData.js
import { ElectrumCluster } from "electrum-cash";

const VALID_BCH_REGEX = /^[qp]\w{41}$/;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    const userAddress = req.query.address;
    if (!userAddress || typeof userAddress !== "string") {
      res.status(400).json({ error: "Address parameter required" });
      return;
    }

    if (!VALID_BCH_REGEX.test(userAddress)) {
      res.status(400).json({ error: "Invalid BCH address format" });
      return;
    }

    const electrum = new ElectrumCluster("TokenStork.com", "1.5.1", 1, 1);
    electrum.addServer("fulcrum.jettscythe.xyz");
    electrum.addServer("fulcrum.greyh.at");
    electrum.addServer("electroncash.de");
    electrum.addServer("electroncash.dk");
    electrum.addServer("bch.loping.net");

    await electrum.ready();

    const scripthash = await electrum.request(
      "blockchain.address.get_scripthash",
      userAddress
    );

    const userBalance = await electrum.request(
      "blockchain.scripthash.get_balance",
      scripthash,
      "exclude_tokens"
    );

    const userUtxos = await electrum.request(
      "blockchain.scripthash.listunspent",
      scripthash
    );

    electrum.shutdown();
    res.status(200).json({ balance: userBalance, utxos: userUtxos });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch blockchain data" });
  }
}
