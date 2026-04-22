//! BCHN JSON-RPC client.
//!
//! Mirrors `lib/bchn.ts` in shape so the Rust binaries are a drop-in replacement
//! for the TS prototypes. ZMQ `hashblock` subscription lives separately and
//! lands with `bin/tail.rs` — not here — to avoid pulling in libzmq when only
//! backfill/enrich/verify are being built.
//!
//! Conventions:
//! - One `BchnClient` per binary. Built from `BCHN_RPC_URL` + `BCHN_RPC_AUTH`.
//! - All RPC responses are strongly typed via serde.
//! - Retries: 3 attempts on network / 5xx with linear backoff; 4xx surfaces
//!   immediately so systemd logs something actionable.
//! - Timeout: 60 s per call (long enough for `getblock` on big blocks).

use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::{debug, warn};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const RETRY_ATTEMPTS: usize = 3;

/// Error codes we surface explicitly; everything else bubbles as `anyhow::Error`.
#[derive(Debug, thiserror::Error)]
pub enum BchnError {
    #[error("BCHN HTTP {status} on {method}")]
    Http {
        status: StatusCode,
        method: String,
    },
    #[error("BCHN auth rejected (HTTP {status}) — check BCHN_RPC_AUTH")]
    Auth { status: StatusCode },
    #[error("BCHN RPC error {code}: {message}")]
    Rpc { code: i64, message: String },
    #[error("BCHN RPC returned empty result for {0}")]
    EmptyResult(String),
}

/// JSON-RPC 2.0-ish wrapper for bitcoind. BCHN uses `"jsonrpc": "1.0"` but
/// returns the same `{result, error, id}` shape.
#[derive(Debug, Deserialize)]
struct RpcResponse<T> {
    result: Option<T>,
    error: Option<RpcError>,
    #[allow(dead_code)]
    id: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct RpcError {
    code: i64,
    message: String,
}

#[derive(Debug, Serialize)]
struct RpcRequest<'a> {
    jsonrpc: &'a str,
    id: u64,
    method: &'a str,
    params: Value,
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct BchnClient {
    http: Client,
    url: String,
    auth_header: String,
}

impl BchnClient {
    /// Construct from env vars. Expects:
    /// - `BCHN_RPC_URL` (default `http://127.0.0.1:8332`)
    /// - `BCHN_RPC_AUTH` in `user:password` form (required).
    pub fn from_env() -> Result<Self> {
        let url = std::env::var("BCHN_RPC_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8332".to_string());
        let auth = std::env::var("BCHN_RPC_AUTH")
            .context("BCHN_RPC_AUTH not set (format: user:password)")?;
        Self::new(&url, &auth)
    }

    pub fn new(url: &str, auth_user_pass: &str) -> Result<Self> {
        if auth_user_pass.is_empty() {
            bail!("BCHN auth is empty");
        }
        // BCHN's HTTP server closes idle keep-alive connections faster than
        // reqwest's default 90 s pool timeout. On a 30 s poll cadence (the
        // tail's fallback interval) the first request after idle finds a
        // half-closed socket and errors with "error sending request", then
        // the retry succeeds — spamming WARNs while data flow is fine.
        // Disable pooling: one extra TCP handshake per localhost RPC, which
        // is negligible, vs. silent retries masking the day retries stop
        // working.
        let http = Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .pool_max_idle_per_host(0)
            .build()
            .context("building reqwest client")?;
        let encoded = BASE64.encode(auth_user_pass.as_bytes());
        Ok(Self {
            http,
            url: url.to_string(),
            auth_header: format!("Basic {}", encoded),
        })
    }

    /// Internal RPC dispatch with retry.
    async fn rpc<T: for<'de> Deserialize<'de>>(
        &self,
        method: &str,
        params: Value,
    ) -> Result<T> {
        let req_id: u64 = chrono::Utc::now().timestamp_millis() as u64;
        let body = serde_json::to_vec(&RpcRequest {
            jsonrpc: "1.0",
            id: req_id,
            method,
            params,
        })?;

        let mut last_err: Option<anyhow::Error> = None;

        for attempt in 0..RETRY_ATTEMPTS {
            match self.try_once::<T>(method, &body).await {
                Ok(value) => return Ok(value),
                Err(e) => {
                    // Don't retry auth failures — surface immediately.
                    if let Some(BchnError::Auth { .. }) = e.downcast_ref::<BchnError>() {
                        return Err(e);
                    }
                    // Don't retry well-formed RPC errors — the node rejected the call.
                    if let Some(BchnError::Rpc { .. }) = e.downcast_ref::<BchnError>() {
                        return Err(e);
                    }
                    warn!(
                        attempt = attempt + 1,
                        method,
                        error = %e,
                        "BCHN RPC transient error, retrying"
                    );
                    last_err = Some(e);
                    tokio::time::sleep(Duration::from_millis(1000 * (attempt as u64 + 1))).await;
                }
            }
        }
        Err(last_err.unwrap_or_else(|| anyhow!("BCHN RPC failed without a captured error")))
    }

    async fn try_once<T: for<'de> Deserialize<'de>>(
        &self,
        method: &str,
        body: &[u8],
    ) -> Result<T> {
        let resp = self
            .http
            .post(&self.url)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .header(reqwest::header::AUTHORIZATION, &self.auth_header)
            .body(body.to_vec())
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
                return Err(BchnError::Auth { status }.into());
            }
            return Err(BchnError::Http {
                status,
                method: method.to_string(),
            }
            .into());
        }

        let json: RpcResponse<T> = resp.json().await.context("parsing RPC response")?;
        if let Some(err) = json.error {
            return Err(BchnError::Rpc {
                code: err.code,
                message: err.message,
            }
            .into());
        }
        json.result
            .ok_or_else(|| BchnError::EmptyResult(method.to_string()).into())
    }

    // -----------------------------------------------------------------------
    // Typed RPC methods used by the indexer.
    // -----------------------------------------------------------------------

    pub async fn get_blockchain_info(&self) -> Result<BlockchainInfo> {
        debug!("rpc getblockchaininfo");
        self.rpc("getblockchaininfo", Value::Array(vec![])).await
    }

    pub async fn get_block_count(&self) -> Result<u64> {
        self.rpc("getblockcount", Value::Array(vec![])).await
    }

    pub async fn get_block_hash(&self, height: u64) -> Result<String> {
        self.rpc("getblockhash", Value::Array(vec![Value::from(height)]))
            .await
    }

    /// Verbose block (`verbosity=2`) — includes full tx data with `tokenData`.
    pub async fn get_block_verbose(&self, hash: &str) -> Result<Block> {
        self.rpc(
            "getblock",
            Value::Array(vec![Value::String(hash.to_string()), Value::from(2)]),
        )
        .await
    }

    pub async fn get_block_by_height(&self, height: u64) -> Result<Block> {
        let hash = self.get_block_hash(height).await?;
        self.get_block_verbose(&hash).await
    }

    /// `scantxoutset start [{desc: "tok(<category_hex>)"}]` — used by the
    /// verifier to independently enumerate UTXOs for a category straight
    /// from BCHN (bypassing BlockBook).
    ///
    /// Note: this is a *blocking* RPC on BCHN side (can take several minutes
    /// on a mature chain). Use sparingly — we sample ~50 categories weekly.
    pub async fn scan_txoutset_by_category(
        &self,
        category_hex: &str,
    ) -> Result<ScanTxOutSet> {
        let descriptors = serde_json::json!([{ "desc": format!("tok({})", category_hex) }]);
        self.rpc(
            "scantxoutset",
            Value::Array(vec![Value::String("start".into()), descriptors]),
        )
        .await
    }
}

// ---------------------------------------------------------------------------
// ZMQ `hashblock` subscriber.
// ---------------------------------------------------------------------------

/// Async subscriber to BCHN's ZMQ `hashblock` topic.
///
/// BCHN must have `zmqpubhashblock=tcp://127.0.0.1:28332` in `bitcoin.conf`.
/// Each message is three frames: `"hashblock"`, 32 bytes of hash, and a
/// little-endian u32 sequence counter (which we discard).
pub struct HashBlockSubscriber {
    sock: zeromq::SubSocket,
}

impl HashBlockSubscriber {
    /// Connect + subscribe. `url` is typically `tcp://127.0.0.1:28332`.
    pub async fn connect(url: &str) -> Result<Self> {
        use zeromq::Socket;
        let mut sock = zeromq::SubSocket::new();
        sock.connect(url)
            .await
            .with_context(|| format!("ZMQ connect {}", url))?;
        sock.subscribe("hashblock")
            .await
            .context("ZMQ subscribe hashblock")?;
        Ok(Self { sock })
    }

    /// Wait for the next `hashblock` notification and return the block hash
    /// as a lowercase hex string (64 chars). Yields `None` only when the
    /// socket is cleanly closed — a protocol error bubbles as `Err`.
    pub async fn next_hash(&mut self) -> Result<Option<String>> {
        use zeromq::SocketRecv;
        let msg = self.sock.recv().await.context("ZMQ recv")?;
        // Frame 0: topic, Frame 1: 32-byte hash, Frame 2: sequence counter.
        let Some(payload) = msg.iter().nth(1) else {
            return Ok(None);
        };
        Ok(Some(hex::encode(payload.as_ref())))
    }
}

// ---------------------------------------------------------------------------
// Connect-from-env helper for the ZMQ URL.
// ---------------------------------------------------------------------------

pub fn zmq_url_from_env() -> String {
    std::env::var("BCHN_ZMQ_URL").unwrap_or_else(|_| "tcp://127.0.0.1:28332".to_string())
}

// ---------------------------------------------------------------------------
// Wire types — only the fields the indexer actually reads.
// Unknown fields are ignored (serde default).
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct BlockchainInfo {
    pub chain: String,
    pub blocks: u64,
    pub headers: u64,
    pub bestblockhash: String,
    pub verificationprogress: f64,
    pub initialblockdownload: Option<bool>,
    #[serde(default)]
    pub pruned: bool,
}

#[derive(Debug, Deserialize)]
pub struct Block {
    pub hash: String,
    pub height: u64,
    pub time: i64,
    pub tx: Vec<Tx>,
}

#[derive(Debug, Deserialize)]
pub struct Tx {
    pub txid: String,
    pub vout: Vec<Vout>,
}

#[derive(Debug, Deserialize)]
pub struct Vout {
    #[serde(rename = "tokenData")]
    pub token_data: Option<TokenData>,
}

#[derive(Debug, Deserialize)]
pub struct TokenData {
    pub category: String,
    /// Fungible amount. BCHN emits this as a JSON string in verbose output to
    /// preserve precision beyond 2^53. Absent for pure-NFT outputs.
    pub amount: Option<TokenAmount>,
    pub nft: Option<Nft>,
}

/// Accepts both string and integer forms — BCHN has moved toward string-only
/// for precision but older callers may still see numbers.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum TokenAmount {
    Text(String),
    Number(i64),
}

impl TokenAmount {
    /// Return whether this amount is strictly positive. Used by the backfill
    /// classifier to decide `hasFT`.
    ///
    /// Parses the text form through `num_bigint::BigInt` so that leading
    /// zeros (`"00"`), signs, or other formatting quirks that BCHN might
    /// emit in some future version match the TS reference's
    /// `BigInt(amount) > 0n` semantics. Unparseable strings classify as
    /// non-positive (the same shape as BCHN emitting `"0"`), erring on
    /// the side of not falsely marking an output as FT.
    pub fn is_positive(&self) -> bool {
        match self {
            TokenAmount::Number(n) => *n > 0,
            TokenAmount::Text(s) => s
                .parse::<num_bigint::BigInt>()
                .is_ok_and(|n| n.sign() == num_bigint::Sign::Plus),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct Nft {
    pub capability: NftCapability,
    pub commitment: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NftCapability {
    None,
    Mutable,
    Minting,
}

// ---------------------------------------------------------------------------
// scantxoutset response types. Only the fields the verifier actually reads.
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ScanTxOutSet {
    #[serde(default)]
    pub success: bool,
    pub unspents: Vec<ScanUnspent>,
}

#[derive(Debug, Deserialize)]
pub struct ScanUnspent {
    pub txid: String,
    pub vout: u32,
    pub height: u64,
    #[serde(rename = "tokenData")]
    pub token_data: Option<TokenData>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_amount_is_positive_semantics() {
        // Text variant — matches `BigInt(s) > 0n` from the TS reference.
        assert!(!TokenAmount::Text("0".into()).is_positive());
        assert!(!TokenAmount::Text("00".into()).is_positive());
        assert!(!TokenAmount::Text("".into()).is_positive());
        assert!(!TokenAmount::Text("-5".into()).is_positive());
        assert!(!TokenAmount::Text("   ".into()).is_positive());
        assert!(!TokenAmount::Text("garbage".into()).is_positive());
        assert!(TokenAmount::Text("1".into()).is_positive());
        assert!(TokenAmount::Text("100".into()).is_positive());
        // Larger than i64::MAX — BigInt handles it.
        assert!(
            TokenAmount::Text("100000000000000000000".into()).is_positive()
        );

        // Number variant — straightforward.
        assert!(TokenAmount::Number(1).is_positive());
        assert!(TokenAmount::Number(i64::MAX).is_positive());
        assert!(!TokenAmount::Number(0).is_positive());
        assert!(!TokenAmount::Number(-1).is_positive());
    }
}
