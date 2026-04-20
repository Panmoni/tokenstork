// @/pages/api/blockchainData.js
import { ElectrumCluster } from "electrum-cash";

const VALID_BCH_REGEX = /^[qp]\w{41}$/;

// Token filter options for Electrum Cash protocol (Fulcrum servers)
const TOKEN_FILTERS = {
  INCLUDE_TOKENS: "include_tokens",    // Include token UTXOs alongside regular ones
  TOKENS_ONLY: "tokens_only",           // Return only token-holding UTXOs
  EXCLUDE_TOKENS: "exclude_tokens",     // No token UTXOs (default)
};

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

    const includeTokens = req.query.includeTokens === "true";
    const tokensOnly = req.query.tokensOnly === "true";

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

    // Determine token filter based on query params
    const tokenFilter = tokensOnly
      ? TOKEN_FILTERS.TOKENS_ONLY
      : includeTokens
        ? TOKEN_FILTERS.INCLUDE_TOKENS
        : TOKEN_FILTERS.EXCLUDE_TOKENS;

    const userUtxos = await electrum.request(
      "blockchain.scripthash.listunspent",
      scripthash,
      tokenFilter
    );

    electrum.shutdown();
    res.status(200).json({
      balance: userBalance,
      utxos: userUtxos,
      tokenFilter,
      hasTokenData: includeTokens || tokensOnly,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch blockchain data" });
  }
}

export { TOKEN_FILTERS };
