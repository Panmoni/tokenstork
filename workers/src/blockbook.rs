//! BlockBook REST client (mainnet-pat cashtokens fork).
//!
//! Port of `lib/blockbook.ts`. Target is `http://127.0.0.1:9130` on the VPS.
//! Scope is deliberately narrow — only the methods enrichment + verify need;
//! grow it here rather than calling reqwest directly from the binaries.
//!
//! Ships a simple per-process rate limiter (min-gap pacing) since we share a
//! local BlockBook between the enricher and possible UI probes. Start at 10
//! req/s and tune against what the box sustains.

use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use reqwest::{Client, StatusCode};
use serde::Deserialize;
use tokio::sync::Mutex;
use tracing::warn;

use crate::bchn::NftCapability;

const USER_AGENT: &str = "tokenstork-workers/0.1";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const RETRY_ATTEMPTS: usize = 3;

#[derive(Debug, thiserror::Error)]
pub enum BlockbookError {
    #[error("BlockBook HTTP {status} on {path}")]
    Http { status: StatusCode, path: String },
}

#[derive(Clone)]
pub struct BlockbookClient {
    http: Client,
    base_url: String,
    /// Minimum gap between outbound requests, computed from `max_rps`.
    min_gap: Duration,
    /// Shared clock across cloned clients.
    last_request: Arc<Mutex<Instant>>,
}

impl BlockbookClient {
    /// Construct from env vars:
    /// - `BLOCKBOOK_URL` (default `http://127.0.0.1:9130`)
    /// - `BLOCKBOOK_MAX_RPS` (default 10)
    pub fn from_env() -> Result<Self> {
        let base = std::env::var("BLOCKBOOK_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:9130".to_string());
        let max_rps: u32 = std::env::var("BLOCKBOOK_MAX_RPS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(10);
        Self::new(&base, max_rps)
    }

    pub fn new(base_url: &str, max_rps: u32) -> Result<Self> {
        let http = Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .user_agent(USER_AGENT)
            .build()
            .context("building reqwest client")?;
        let min_gap = if max_rps == 0 {
            Duration::ZERO
        } else {
            Duration::from_millis((1000 / u64::from(max_rps)).max(1))
        };
        Ok(Self {
            http,
            base_url: base_url.trim_end_matches('/').to_string(),
            min_gap,
            last_request: Arc::new(Mutex::new(
                Instant::now()
                    .checked_sub(Duration::from_secs(1))
                    .unwrap_or_else(Instant::now),
            )),
        })
    }

    /// Pace requests so at least `min_gap` elapses between outgoing HTTP
    /// calls.
    ///
    /// Intentionally holds the lock across the `tokio::time::sleep`. If we
    /// released the lock before sleeping, concurrent callers would all see
    /// the same `last` timestamp, compute the same required wait, sleep in
    /// parallel, and then fire simultaneously — defeating the rate limit.
    /// Serialization *is* the mechanism.
    async fn pace(&self) {
        if self.min_gap.is_zero() {
            return;
        }
        let mut last = self.last_request.lock().await;
        let now = Instant::now();
        let elapsed = now.duration_since(*last);
        if elapsed < self.min_gap {
            tokio::time::sleep(self.min_gap - elapsed).await;
        }
        *last = Instant::now();
    }

    /// GET `<base>/<path>` as JSON, with pacing + retry on 5xx / 429 / net.
    async fn get<T: for<'de> Deserialize<'de>>(&self, path: &str) -> Result<T> {
        let url = format!("{}{}", self.base_url, path);
        let mut last_err: Option<anyhow::Error> = None;

        for attempt in 0..RETRY_ATTEMPTS {
            self.pace().await;
            let resp = match self.http.get(&url).send().await {
                Ok(r) => r,
                Err(e) => {
                    last_err = Some(e.into());
                    backoff(attempt).await;
                    continue;
                }
            };

            let status = resp.status();
            if status.as_u16() >= 500 || status == StatusCode::TOO_MANY_REQUESTS {
                warn!(
                    path,
                    %status,
                    attempt = attempt + 1,
                    "BlockBook transient status, retrying"
                );
                last_err = Some(
                    BlockbookError::Http {
                        status,
                        path: path.to_string(),
                    }
                    .into(),
                );
                backoff(attempt).await;
                continue;
            }
            if !status.is_success() {
                return Err(BlockbookError::Http {
                    status,
                    path: path.to_string(),
                }
                .into());
            }

            let body = resp.json::<T>().await.context("parsing BlockBook JSON")?;
            return Ok(body);
        }
        Err(last_err.unwrap_or_else(|| anyhow::anyhow!("BlockBook retries exhausted")))
    }

    /// `GET /api/v2/` — node + sync status.
    pub async fn get_node_info(&self) -> Result<NodeInfo> {
        self.get("/api/v2/").await
    }

    /// `GET /api/v2/utxo/<category>` — every currently-unspent output for the
    /// category (mainnet-pat fork uses category-as-address). Each UTXO comes
    /// back with `tokenData` populated.
    pub async fn get_utxos_by_category(&self, category_hex: &str) -> Result<Vec<Utxo>> {
        // Category hex is [0-9a-f]{64}; nothing to percent-encode, but we pass
        // through the library anyway so any format drift surfaces as an
        // error instead of silently routing to a wrong path.
        let encoded = percent_encode(category_hex);
        self.get(&format!("/api/v2/utxo/{}", encoded)).await
    }
}

async fn backoff(attempt: usize) {
    let ms = (1000u64 << attempt).min(8000);
    tokio::time::sleep(Duration::from_millis(ms)).await;
}

fn percent_encode(s: &str) -> String {
    use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
    utf8_percent_encode(s, NON_ALPHANUMERIC).to_string()
}

// ---------------------------------------------------------------------------
// Wire types — only what enrich + verify read.
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct NodeInfo {
    pub blockbook: NodeInfoBlockbook,
    #[serde(default)]
    pub backend: Option<NodeInfoBackend>,
}

#[derive(Debug, Deserialize)]
pub struct NodeInfoBlockbook {
    #[serde(rename = "inSync")]
    pub in_sync: Option<bool>,
    #[serde(rename = "bestHeight")]
    pub best_height: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct NodeInfoBackend {
    pub blocks: Option<u64>,
    pub chain: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Utxo {
    pub txid: String,
    pub vout: u32,
    #[serde(default)]
    pub address: Option<String>,
    #[serde(rename = "tokenData")]
    pub token_data: Option<TokenData>,
}

#[derive(Debug, Deserialize)]
pub struct TokenData {
    pub category: String,
    /// Fungible amount. BlockBook emits as a decimal string to preserve
    /// precision for NUMERIC(78,0) values.
    pub amount: Option<String>,
    pub nft: Option<Nft>,
}

#[derive(Debug, Deserialize)]
pub struct Nft {
    pub capability: NftCapability,
    pub commitment: String,
}

/// Strip a `bitcoincash:` prefix if present, so addresses normalize to bare
/// cashaddr-style (matching what the SvelteKit side expects in the DB).
pub fn normalize_address(raw: &str) -> String {
    raw.strip_prefix("bitcoincash:").unwrap_or(raw).to_string()
}
