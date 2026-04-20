// @/lib/bchn.ts
// BCHN JSON-RPC client + ZMQ hashblock subscriber.
// Target (VPS): 127.0.0.1:8332 (RPC) + 127.0.0.1:28332 (ZMQ).

const BCHN_RPC_URL = process.env.BCHN_RPC_URL || "http://127.0.0.1:8332";
const BCHN_RPC_AUTH = process.env.BCHN_RPC_AUTH || "";
const BCHN_ZMQ_URL = process.env.BCHN_ZMQ_URL || "tcp://127.0.0.1:28332";
const REQUEST_TIMEOUT_MS = 60_000;

// ============================================================================
// JSON-RPC
// ============================================================================

interface RpcResponse<T> {
  result?: T;
  error?: { code: number; message: string } | null;
  id: number | string;
}

class BchnRpcError extends Error {
  constructor(message: string, public readonly code?: number) {
    super(message);
    this.name = "BchnRpcError";
  }
}

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  if (!BCHN_RPC_AUTH) {
    throw new BchnRpcError("BCHN_RPC_AUTH is not set");
  }

  const body = JSON.stringify({
    jsonrpc: "1.0",
    id: Date.now(),
    method,
    params,
  });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(BCHN_RPC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(BCHN_RPC_AUTH).toString("base64")}`,
        },
        body,
        signal: ac.signal,
      });

      if (!resp.ok) {
        // 401/403 are not retryable; surface immediately so systemd logs something useful.
        if (resp.status === 401 || resp.status === 403) {
          throw new BchnRpcError(`BCHN HTTP ${resp.status} — check BCHN_RPC_AUTH`);
        }
        // 5xx or other: backoff then retry
        lastErr = new BchnRpcError(`BCHN HTTP ${resp.status} on ${method}`);
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }

      const json = (await resp.json()) as RpcResponse<T>;
      if (json.error) {
        throw new BchnRpcError(`${method}: ${json.error.message}`, json.error.code);
      }
      if (json.result === undefined) {
        throw new BchnRpcError(`${method}: empty result`);
      }
      return json.result;
    } catch (err) {
      // Don't retry auth errors or RPC-level errors; surface them.
      if (err instanceof BchnRpcError && err.message.includes("check BCHN_RPC_AUTH")) {
        throw err;
      }
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new BchnRpcError(String(lastErr));
}

// ============================================================================
// Types for the verbose getblock response (`verbosity = 2`)
// ============================================================================

export interface BchnTokenData {
  category: string;      // hex
  amount?: string;       // fungible amount (decimal string)
  nft?: {
    capability: "none" | "mutable" | "minting";
    commitment: string;  // hex
  };
}

export interface BchnVout {
  value: number;         // BCH
  n: number;
  scriptPubKey: {
    hex: string;
    asm?: string;
    type?: string;
    addresses?: string[];
  };
  tokenData?: BchnTokenData;
}

export interface BchnVin {
  txid?: string;
  vout?: number;
  coinbase?: string;
  scriptSig?: { asm: string; hex: string };
  sequence: number;
}

export interface BchnTx {
  txid: string;
  hash: string;
  size: number;
  version: number;
  locktime: number;
  vin: BchnVin[];
  vout: BchnVout[];
}

export interface BchnBlock {
  hash: string;
  confirmations: number;
  size: number;
  height: number;
  version: number;
  merkleroot: string;
  tx: BchnTx[];
  time: number;          // Unix seconds
  mediantime: number;
  nonce: number;
  bits: string;
  difficulty: number;
  previousblockhash?: string;
  nextblockhash?: string;
}

export interface BchnBlockchainInfo {
  chain: string;
  blocks: number;
  headers: number;
  bestblockhash: string;
  difficulty: number;
  verificationprogress: number;
  pruned?: boolean;
  pruneheight?: number;
  size_on_disk: number;
}

// ============================================================================
// Public RPC methods
// ============================================================================

export async function getBlockchainInfo(): Promise<BchnBlockchainInfo> {
  return rpc<BchnBlockchainInfo>("getblockchaininfo");
}

export async function getBlockCount(): Promise<number> {
  return rpc<number>("getblockcount");
}

export async function getBlockHash(height: number): Promise<string> {
  return rpc<string>("getblockhash", [height]);
}

// Verbose block including full transaction data with `tokenData`.
export async function getBlock(hash: string): Promise<BchnBlock> {
  return rpc<BchnBlock>("getblock", [hash, 2]);
}

export async function getBlockByHeight(height: number): Promise<BchnBlock> {
  const hash = await getBlockHash(height);
  return getBlock(hash);
}

// scantxoutset — used by the Phase 5 verifier for cross-checking BlockBook.
// Pass `"start"` to begin a scan, `"abort"` to cancel an in-progress one.
export async function scanTxOutSetByCategory(
  categoryHex: string
): Promise<{
  unspents: Array<{
    txid: string;
    vout: number;
    amount: number;
    height: number;
    tokenData?: BchnTokenData;
  }>;
  total_amount: number;
}> {
  return rpc("scantxoutset", ["start", [{ desc: `tok(${categoryHex})` }]]);
}

// ============================================================================
// ZMQ hashblock subscription
// ============================================================================

// Yields a new block hash (hex string) every time BCHN finds or receives a block.
// Caller is expected to consume with `for await`. Exits on process interrupt or
// when the subscriber is closed.
//
// zmqpubhashblock must be enabled in bitcoin.conf:
//   zmqpubhashblock=tcp://127.0.0.1:28332
export async function* subscribeHashBlock(): AsyncGenerator<string, void, void> {
  // Dynamic import so non-ZMQ code paths (UI, Next.js server build) don't
  // need zeromq's native bindings.
  const { Subscriber } = await import("zeromq");
  const sock = new Subscriber();
  sock.connect(BCHN_ZMQ_URL);
  sock.subscribe("hashblock");
  try {
    for await (const [topic, payload] of sock) {
      const t = topic?.toString();
      if (t !== "hashblock" || !payload) continue;
      yield Buffer.from(payload).toString("hex");
    }
  } finally {
    sock.close();
  }
}
