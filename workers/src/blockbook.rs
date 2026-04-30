//! BlockBook REST client (mainnet-pat cashtokens fork).
//!
//! Port of `lib/blockbook.ts`. Target is `http://127.0.0.1:9131` on the VPS
//! (the `-public=...` REST port; `9031` is the unit's `-internal=...` port and
//! is not an HTTP REST surface). Scope is deliberately narrow — only the
//! methods enrichment + verify need; grow it here rather than calling reqwest
//! directly from the binaries.
//!
//! Ships a simple per-process rate limiter (min-gap pacing) since we share a
//! local BlockBook between the enricher and possible UI probes. Start at 10
//! req/s and tune against what the box sustains.
//!
//! ## Per-category enrichment quirk
//!
//! The mainnet-pat fork accepts a 32-byte hex category as an "address" via
//! `GetAddrDescFromAddress` (bcashparser.go:113-117), but its address index
//! does NOT surface category-keyed UTXOs at `/api/v2/utxo/<category>` — that
//! endpoint always returns `[]` for category hexes. The fork's HTML token
//! explorer (`/token/<category>`) renders the right data; under the hood it
//! uses `GetAddress` with `details=AccountDetailsTxHistoryLight`. The JSON
//! equivalent is `/api/v2/address/<category>?details=txs`, which DOES return
//! the full tx history for a category. The summary fields (`txs`,
//! `totalReceived`, `balance`) on that response are bogus (always 0) for
//! category lookups, but the `transactions[]` array is populated correctly,
//! and each tx's vouts include `tokenData` + a `spent` flag — enough to
//! reconstruct the live UTXO set on our side. See `walk_category_utxos`.

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
    /// - `BLOCKBOOK_URL` (default `http://127.0.0.1:9131`)
    /// - `BLOCKBOOK_MAX_RPS` (default 10)
    pub fn from_env() -> Result<Self> {
        let base = std::env::var("BLOCKBOOK_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:9131".to_string());
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

    /// `GET /api/v2/address/<addr-or-category>?details=txs&page=N&pageSize=...`
    /// — paginated transaction history. Works for both regular cashaddrs and
    /// 32-byte hex categories (the fork's parser accepts the latter as an
    /// address descriptor).
    ///
    /// **Caveat for category lookups:** the response's top-level summary
    /// fields (`txs`, `balance`, `totalReceived`, `totalSent`) are all `0`
    /// regardless of how many transactions the category has. Trust
    /// `transactions[]`/`totalPages` instead.
    pub async fn get_address_txs(
        &self,
        addr_or_category: &str,
        page: u32,
        page_size: u32,
    ) -> Result<AddressTxsResponse> {
        let encoded = percent_encode(addr_or_category);
        self.get(&format!(
            "/api/v2/address/{}?details=txs&page={}&pageSize={}",
            encoded, page, page_size
        ))
        .await
    }

    /// Walk the tx history of a category and reconstruct its live UTXO set
    /// from token-bearing vouts whose `spent` flag is not `true`.
    ///
    /// Workaround for the mainnet-pat fork's broken `/api/v2/utxo/<category>`
    /// endpoint — see the module docstring for the full story. Each
    /// paginated response gives us one slice of the category's tx history;
    /// across all pages we keep every (txid, vout_n) where `tokenData.category
    /// == our_category` and `spent != Some(true)`. That's the live set.
    ///
    /// For the ~99% of categories with under 1000 historical txs this is
    /// exactly one paginated GET. High-traffic categories (Cauldron LPs,
    /// active stables) span multiple pages.
    pub async fn walk_category_utxos(&self, category_hex: &str) -> Result<Vec<Utxo>> {
        const PAGE_SIZE: u32 = 1000;
        let mut utxos: Vec<Utxo> = Vec::new();
        let mut page: u32 = 1;
        loop {
            let res = self
                .get_address_txs(category_hex, page, PAGE_SIZE)
                .await
                .with_context(|| {
                    format!("address-txs page {} for {}", page, &category_hex[..16])
                })?;
            let txs = res.transactions.unwrap_or_default();
            let total_pages = res.total_pages.unwrap_or(1);
            if txs.is_empty() {
                break;
            }
            for tx in txs {
                let txid = tx.txid;
                for v in tx.vout {
                    let Some(td) = v.token_data else { continue };
                    if !td.category.eq_ignore_ascii_case(category_hex) {
                        continue;
                    }
                    if v.spent == Some(true) {
                        continue;
                    }
                    let address = v
                        .addresses
                        .and_then(|xs| xs.into_iter().next())
                        .map(|a| normalize_address(&a));
                    utxos.push(Utxo {
                        txid: txid.clone(),
                        vout: v.n,
                        address,
                        token_data: Some(td),
                    });
                }
            }
            if page >= total_pages {
                break;
            }
            page += 1;
        }
        Ok(utxos)
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

/// Response shape for `/api/v2/address/<x>?details=txs`. Only the fields the
/// category-walker needs are deserialised; everything else (summary
/// counters that lie for category lookups, balance fields, etc.) is
/// dropped on the floor.
#[derive(Debug, Deserialize, Default)]
pub struct AddressTxsResponse {
    pub transactions: Option<Vec<AddressTx>>,
    #[serde(rename = "totalPages")]
    pub total_pages: Option<u32>,
    #[serde(rename = "itemsOnPage")]
    pub items_on_page: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct AddressTx {
    pub txid: String,
    #[serde(default)]
    pub vout: Vec<AddressTxVout>,
}

#[derive(Debug, Deserialize)]
pub struct AddressTxVout {
    pub n: u32,
    #[serde(default)]
    pub addresses: Option<Vec<String>>,
    /// `Some(true)` when this output has been spent. Absent or `Some(false)`
    /// means it's currently in the live UTXO set.
    #[serde(default)]
    pub spent: Option<bool>,
    #[serde(rename = "tokenData", default)]
    pub token_data: Option<TokenData>,
}

/// Strip a `bitcoincash:` prefix if present, so addresses normalize to bare
/// cashaddr-style (matching what the SvelteKit side expects in the DB).
pub fn normalize_address(raw: &str) -> String {
    raw.strip_prefix("bitcoincash:").unwrap_or(raw).to_string()
}
