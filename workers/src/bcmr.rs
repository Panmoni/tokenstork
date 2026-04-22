//! BCMR (Bitcoin Cash Metadata Registry) REST client, aimed at Paytaca's
//! public HTTP indexer at <https://bcmr.paytaca.com>.
//!
//! Phase 4b. Populates `token_metadata` so the directory listing page has
//! names/symbols/icons. Deliberately narrow — `get_token_metadata` is the
//! only method; anything else goes through a separate worker.
//!
//! Treats Paytaca as an unreliable read-only cache:
//! - 5 s timeout per request, 5 req/s pacing (serialized min-gap limiter).
//! - 3× retry on 5xx / 429 / network with 1-8 s exponential backoff.
//! - Returns `Ok(None)` on 404 so the caller can record "seen, missing" in
//!   `token_metadata` (via `bcmr_source='paytaca-missing'`) and stop
//!   re-querying every run until the weekly refresh.

use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use reqwest::{Client, StatusCode};
use serde::Deserialize;
use tokio::sync::Mutex;
use tracing::warn;

const USER_AGENT: &str = "tokenstork-workers/0.1";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const RETRY_ATTEMPTS: usize = 3;

#[derive(Debug, thiserror::Error)]
pub enum BcmrError {
    #[error("BCMR HTTP {status} on {path}")]
    Http { status: StatusCode, path: String },
}

#[derive(Clone)]
pub struct BcmrClient {
    http: Client,
    base_url: String,
    /// Minimum gap between outbound requests, computed from `max_rps`.
    min_gap: Duration,
    /// Shared clock across clones — serialization *is* the mechanism.
    last_request: Arc<Mutex<Instant>>,
}

impl BcmrClient {
    /// Construct from env vars:
    /// - `BCMR_URL` (default `https://bcmr.paytaca.com`)
    /// - `BCMR_MAX_RPS` (default 5 — Paytaca is a shared service, don't hammer)
    pub fn from_env() -> Result<Self> {
        let base = std::env::var("BCMR_URL")
            .unwrap_or_else(|_| "https://bcmr.paytaca.com".to_string());
        let max_rps: u32 = std::env::var("BCMR_MAX_RPS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(5);
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

    /// Hold the lock across the sleep so concurrent callers serialize through
    /// the min-gap window. Same design as `blockbook.rs#pace`.
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

    /// `GET /api/tokens/<category_hex>` — returns the token's BCMR record
    /// when Paytaca has one, `Ok(None)` on 404, `Err` on other failures.
    pub async fn get_token_metadata(
        &self,
        category_hex: &str,
    ) -> Result<Option<BcmrToken>> {
        let path = format!("/api/tokens/{}", category_hex);
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
            if status == StatusCode::NOT_FOUND {
                return Ok(None);
            }
            if status.as_u16() >= 500 || status == StatusCode::TOO_MANY_REQUESTS {
                warn!(
                    path,
                    %status,
                    attempt = attempt + 1,
                    "BCMR transient status, retrying"
                );
                last_err = Some(
                    BcmrError::Http {
                        status,
                        path: path.clone(),
                    }
                    .into(),
                );
                backoff(attempt).await;
                continue;
            }
            if !status.is_success() {
                return Err(BcmrError::Http {
                    status,
                    path: path.clone(),
                }
                .into());
            }

            let body: BcmrToken =
                resp.json().await.context("parsing BCMR JSON")?;
            return Ok(Some(body));
        }

        Err(last_err.unwrap_or_else(|| anyhow::anyhow!("BCMR retries exhausted")))
    }
}

async fn backoff(attempt: usize) {
    let ms = (1000u64 << attempt).min(8000);
    tokio::time::sleep(Duration::from_millis(ms)).await;
}

// ---------------------------------------------------------------------------
// Wire shape — matches what `src/lib/server/external.ts#fetchBcmr` expects.
// Only the fields we actually read.
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct BcmrToken {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub token: Option<BcmrTokenInner>,
    #[serde(default)]
    pub uris: Option<BcmrUris>,
}

#[derive(Debug, Deserialize)]
pub struct BcmrTokenInner {
    #[serde(default)]
    pub symbol: Option<String>,
    #[serde(default)]
    pub decimals: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct BcmrUris {
    #[serde(default)]
    pub icon: Option<String>,
}

impl BcmrToken {
    /// Flatten the nested Paytaca shape into the column layout the
    /// `token_metadata` table expects.
    ///
    /// `category_hex` is used only as context for any `warn!` emitted during
    /// decimals validation — so an operator correlating a clamped-decimals
    /// warning can identify the offending token.
    pub fn into_flat(self, category_hex: &str) -> BcmrFlat {
        let (symbol, decimals_raw) = match self.token {
            Some(t) => (t.symbol, t.decimals),
            None => (None, None),
        };
        let icon_uri = self.uris.and_then(|u| u.icon);
        BcmrFlat {
            name: self.name,
            symbol,
            decimals: validate_decimals(decimals_raw, category_hex),
            description: self.description,
            icon_uri,
        }
    }
}

#[derive(Debug, Clone)]
pub struct BcmrFlat {
    pub name: Option<String>,
    pub symbol: Option<String>,
    /// Clamped to 0..=8 per CashToken spec. Defaults to 0 when missing or
    /// malformed upstream.
    pub decimals: i16,
    pub description: Option<String>,
    pub icon_uri: Option<String>,
}

/// Coerce whatever Paytaca emitted into a `SMALLINT` that fits the
/// `token_metadata.decimals` column. Clamps to `0` for anything outside the
/// CashToken-spec range `[0..=8]` and emits a `warn!` with the category so
/// the operator can track down the malformed upstream value. A genuinely
/// absent field (e.g., `token: {}` with no `decimals` key) does **not** log —
/// zero is the legitimate default.
fn validate_decimals(raw: Option<serde_json::Value>, category_hex: &str) -> i16 {
    use serde_json::Value;
    let (present, parsed) = match &raw {
        None | Some(Value::Null) => (false, None),
        Some(Value::Number(n)) => (true, n.as_f64()),
        Some(Value::String(s)) => (true, s.parse().ok()),
        _ => (true, None),
    };
    match parsed {
        Some(v) if v.is_finite() && (0.0..=8.0).contains(&v) => v.floor() as i16,
        _ if present => {
            warn!(
                category = category_hex,
                raw = ?raw,
                "BCMR decimals out of range or unparseable; clamping to 0",
            );
            0
        }
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const DUMMY_CAT: &str = "00000000000000000000000000000000000000000000000000000000000000ab";

    #[test]
    fn flatten_typical_bcmr_response() {
        let raw = json!({
            "name": "TestToken",
            "description": "A test token",
            "token": { "symbol": "TST", "decimals": 2 },
            "uris": { "icon": "ipfs://abc/logo.png" }
        });
        let t: BcmrToken = serde_json::from_value(raw).unwrap();
        let f = t.into_flat(DUMMY_CAT);
        assert_eq!(f.name.as_deref(), Some("TestToken"));
        assert_eq!(f.symbol.as_deref(), Some("TST"));
        assert_eq!(f.decimals, 2);
        assert_eq!(f.description.as_deref(), Some("A test token"));
        assert_eq!(f.icon_uri.as_deref(), Some("ipfs://abc/logo.png"));
    }

    #[test]
    fn flatten_missing_token_block() {
        let raw = json!({ "name": "X" });
        let t: BcmrToken = serde_json::from_value(raw).unwrap();
        let f = t.into_flat(DUMMY_CAT);
        assert_eq!(f.name.as_deref(), Some("X"));
        assert_eq!(f.symbol, None);
        assert_eq!(f.decimals, 0);
        assert_eq!(f.icon_uri, None);
    }

    #[test]
    fn decimals_clamping() {
        use serde_json::Value;
        assert_eq!(validate_decimals(Some(Value::from(5)), DUMMY_CAT), 5);
        assert_eq!(validate_decimals(Some(Value::from(8)), DUMMY_CAT), 8);
        // Out of range / negative / unparseable string → clamp to 0 (with warn!).
        assert_eq!(validate_decimals(Some(Value::from(9)), DUMMY_CAT), 0);
        assert_eq!(validate_decimals(Some(Value::from(-1)), DUMMY_CAT), 0);
        assert_eq!(validate_decimals(Some(Value::from("bad")), DUMMY_CAT), 0);
        // Valid string form → parses.
        assert_eq!(validate_decimals(Some(Value::from("3")), DUMMY_CAT), 3);
        // Genuinely absent / null field → silent 0 (no warn, no ambiguity).
        assert_eq!(validate_decimals(None, DUMMY_CAT), 0);
        assert_eq!(validate_decimals(Some(Value::Null), DUMMY_CAT), 0);
    }
}
