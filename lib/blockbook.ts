// @/lib/blockbook.ts
// BlockBook REST client (mainnet-pat cashtokens fork).
// Target: http://127.0.0.1:9130 on the VPS.
//
// Scope is deliberately narrow — only the methods the enrichment worker and
// any UI routes need. Add to this module rather than calling fetch directly
// from callers.

const BLOCKBOOK_URL = process.env.BLOCKBOOK_URL || "http://127.0.0.1:9130";
const MAX_RPS = Number(process.env.BLOCKBOOK_MAX_RPS ?? "10");
const REQUEST_TIMEOUT_MS = 30_000;
const USER_AGENT = "tokenstork/0.1";

// ============================================================================
// Minimal per-process rate limiter. Not fancy — a serialized queue that paces
// requests to MAX_RPS. Good enough for our single-node localhost use case.
// ============================================================================

let lastRequestAt = 0;

async function pace(): Promise<void> {
  if (MAX_RPS <= 0) return;
  const minGapMs = Math.floor(1000 / MAX_RPS);
  const wait = lastRequestAt + minGapMs - Date.now();
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastRequestAt = Date.now();
}

// ============================================================================
// HTTP
// ============================================================================

class BlockbookError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "BlockbookError";
  }
}

async function get<T>(path: string): Promise<T> {
  await pace();
  const url = `${BLOCKBOOK_URL}${path}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: ac.signal,
      });
      if (resp.status >= 500 || resp.status === 429) {
        const backoff = Math.min(1000 * 2 ** attempt, 8000);
        lastErr = new BlockbookError(`HTTP ${resp.status} on ${path}`, resp.status);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      if (!resp.ok) {
        throw new BlockbookError(`HTTP ${resp.status} on ${path}`, resp.status);
      }
      return (await resp.json()) as T;
    } catch (err) {
      lastErr = err;
      // network-level failure; retry with backoff
      const backoff = Math.min(1000 * 2 ** attempt, 8000);
      await new Promise((r) => setTimeout(r, backoff));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new BlockbookError(String(lastErr));
}

// ============================================================================
// Types (partial — only the fields we actually use)
// ============================================================================

export interface BbTokenData {
  category: string;      // hex without 0x or \x prefix
  amount?: string;       // fungible amount, decimal string
  nft?: {
    capability: "none" | "mutable" | "minting";
    commitment: string;  // hex
  };
}

export interface BbUtxo {
  txid: string;
  vout: number;
  value: string;         // sats, decimal string
  height?: number;
  confirmations?: number;
  address?: string;
  tokenData?: BbTokenData;
}

export interface BbAddressBasic {
  address: string;
  balance: string;
  totalReceived?: string;
  totalSent?: string;
  txs: number;
  // When details=tokenBalances or for a category hex, BlockBook returns
  // token-related fields here too. We read them loosely.
  tokens?: Array<{
    category: string;
    balance?: string;
    decimals?: number;
    name?: string;
    symbol?: string;
    nfts?: Array<{ commitment: string; capability: string }>;
  }>;
}

export interface BbNodeInfo {
  blockbook: {
    coin: string;
    host?: string;
    version?: string;
    gitCommit?: string;
    buildTime?: string;
    syncMode?: boolean;
    initialSync?: boolean;
    inSync?: boolean;
    bestHeight?: number;
  };
  backend: {
    chain?: string;
    blocks?: number;
    headers?: number;
    bestBlockHash?: string;
    version?: string;
  };
}

// ============================================================================
// Public API
// ============================================================================

export async function getNodeInfo(): Promise<BbNodeInfo> {
  return get<BbNodeInfo>("/api/v2/");
}

// Returns every currently-unspent UTXO for the given category (using the
// category-as-address trick in the mainnet-pat fork). Each returned UTXO has
// `tokenData` populated.
export async function getUtxosByCategory(categoryHex: string): Promise<BbUtxo[]> {
  return get<BbUtxo[]>(`/api/v2/utxo/${encodeURIComponent(categoryHex)}`);
}

// Address or category overview. For a category hex, BlockBook returns an
// address-shaped response where the transactions list contains every tx that
// touched that category. We mostly use this to pick up BlockBook's parsed
// BCMR metadata (when `details=tokenBalances` or similar is requested).
export async function getAddressBasic(
  addressOrCategory: string,
  details: "basic" | "tokens" | "tokenBalances" = "basic"
): Promise<BbAddressBasic> {
  const q = details === "basic" ? "" : `?details=${details}`;
  return get<BbAddressBasic>(
    `/api/v2/address/${encodeURIComponent(addressOrCategory)}${q}`
  );
}
