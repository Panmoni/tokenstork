//! Cauldron DEX indexer REST client — https://indexer.cauldron.quest.
//!
//! Phase 4d. The `sync-cauldron` worker walks every fungible category in
//! `tokens` once every 4 h and upserts `token_venue_listings` rows for
//! the ones Cauldron currently lists. The UI shows a "Listed on Cauldron"
//! filter + a Price / TVL column driven off this table.
//!
//! Same shape as [`crate::bcmr`]: narrow surface, polite rate-limited
//! client, 404 short-circuits to `Ok(None)`, 5xx / 429 / network retries
//! with exponential backoff.
//!
//! We store RAW values from the venue (sats-per-smallest-token-unit +
//! locked satoshis). USD conversion is the render layer's job — that
//! way a BCH price tick doesn't require rewriting every row.

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
pub enum CauldronError {
	#[error("Cauldron HTTP {status} on {path}")]
	Http { status: StatusCode, path: String },
}

#[derive(Clone)]
pub struct CauldronClient {
	http: Client,
	base_url: String,
	/// Minimum gap between outbound requests, computed from `max_rps`.
	min_gap: Duration,
	/// Shared clock across clones — serialization *is* the mechanism.
	last_request: Arc<Mutex<Instant>>,
}

impl CauldronClient {
	/// Construct from env vars:
	/// - `CAULDRON_URL`     (default `https://indexer.cauldron.quest`)
	/// - `CAULDRON_MAX_RPS` (default 5 — public shared indexer, don't hammer)
	pub fn from_env() -> Result<Self> {
		let base = std::env::var("CAULDRON_URL")
			.unwrap_or_else(|_| "https://indexer.cauldron.quest".to_string());
		let max_rps: u32 = std::env::var("CAULDRON_MAX_RPS")
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

	/// Same serialized-min-gap pattern as `bcmr.rs` / `blockbook.rs`:
	/// holding the lock across the sleep is what forces concurrent
	/// callers to queue behind each other.
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

	/// `GET /cauldron/price/<category>/current` — returns the current
	/// Cauldron spot price (sats per smallest-unit-of-token) when the
	/// token is in a pool, `Ok(None)` on 404, `Err` on hard failures.
	pub async fn get_price_sats(&self, category_hex: &str) -> Result<Option<f64>> {
		let path = format!("/cauldron/price/{}/current", category_hex);
		let resp: Option<PriceResponse> = self.get_json(&path).await?;
		Ok(resp.and_then(|r| r.price))
	}

	/// `GET /cauldron/valuelocked/<category>` — returns the satoshis
	/// locked on the BCH side of the pool. TVL = `satoshis * 2 *
	/// bch_price_usd / 1e8` (double-sided AMM), computed at render time.
	pub async fn get_tvl_satoshis(&self, category_hex: &str) -> Result<Option<i64>> {
		let path = format!("/cauldron/valuelocked/{}", category_hex);
		let resp: Option<TvlResponse> = self.get_json(&path).await?;
		Ok(resp.and_then(|r| r.satoshis))
	}

	// -----------------------------------------------------------------------
	// Global / ecosystem-wide endpoints. Pulled by `sync-cauldron-stats`
	// every 30 min and cached in `cauldron_global_stats` so /stats SSR
	// doesn't pay a network round-trip per page hit.
	// -----------------------------------------------------------------------

	/// `GET /cauldron/valuelocked` — total satoshis locked on the BCH side
	/// across every Cauldron pool. Same `* 2` doubled-sides convention at
	/// render time.
	pub async fn get_global_tvl_satoshis(&self) -> Result<Option<i64>> {
		let resp: Option<TvlResponse> = self.get_json("/cauldron/valuelocked").await?;
		Ok(resp.and_then(|r| r.satoshis))
	}

	/// `GET /cauldron/volume?start=<unix>&end=<unix>` — total swap volume
	/// in sats across the window. Used for 24h / 7d / 30d trailing windows.
	pub async fn get_volume_window_sats(&self, start: u64, end: u64) -> Result<Option<i64>> {
		let path = format!("/cauldron/volume?start={}&end={}", start, end);
		let resp: Option<VolumeResponse> = self.get_json(&path).await?;
		Ok(resp.and_then(|r| r.total_volume_sats))
	}

	/// `GET /cauldron/contract/count` — pool counters: active, ended,
	/// total interactions.
	pub async fn get_contract_count(&self) -> Result<Option<ContractCount>> {
		self.get_json("/cauldron/contract/count").await
	}

	/// `GET /cauldron/user/unique_addresses` — array of `[month, count]`
	/// tuples. Endpoint scans the full chain so it's noticeably slower
	/// than the others; we tolerate that on a 30 min cadence.
	///
	/// Count is `i64` for safety even though realistic counts (thousands
	/// per month) fit i32 easily — protects against a future API change
	/// that returns a combined-since-genesis variant which could exceed
	/// i32::MAX (2.1B), which would otherwise hard-fail deserialization.
	pub async fn get_unique_addresses_by_month(&self) -> Result<Vec<(String, i64)>> {
		let resp: Option<Vec<(String, i64)>> = self
			.get_json("/cauldron/user/unique_addresses")
			.await?;
		Ok(resp.unwrap_or_default())
	}

	/// Shared GET helper: 3× retry on 5xx / 429 / network, 404 → `Ok(None)`.
	async fn get_json<T: for<'de> Deserialize<'de>>(&self, path: &str) -> Result<Option<T>> {
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
					"Cauldron transient status, retrying"
				);
				last_err = Some(
					CauldronError::Http {
						status,
						path: path.to_string(),
					}
					.into(),
				);
				backoff(attempt).await;
				continue;
			}
			if !status.is_success() {
				return Err(CauldronError::Http {
					status,
					path: path.to_string(),
				}
				.into());
			}

			let body: T = resp.json().await.context("parsing Cauldron JSON")?;
			return Ok(Some(body));
		}

		Err(last_err.unwrap_or_else(|| anyhow::anyhow!("Cauldron retries exhausted")))
	}
}

async fn backoff(attempt: usize) {
	let ms = (1000u64 << attempt).min(8000);
	tokio::time::sleep(Duration::from_millis(ms)).await;
}

// ---------------------------------------------------------------------------
// Wire shapes — only the fields we read. Both endpoints return the one
// value we care about; everything else is ignored.
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct PriceResponse {
	#[serde(default)]
	price: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct TvlResponse {
	#[serde(default)]
	satoshis: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct VolumeResponse {
	#[serde(default)]
	total_volume_sats: Option<i64>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ContractCount {
	#[serde(default)]
	pub active: i32,
	#[serde(default)]
	pub ended: i32,
	#[serde(default)]
	pub interactions: i64,
}

#[cfg(test)]
mod tests {
	use super::*;
	use serde_json::json;

	#[test]
	fn price_response_parses_typical() {
		let raw = json!({ "price": 0.000123 });
		let r: PriceResponse = serde_json::from_value(raw).unwrap();
		assert_eq!(r.price, Some(0.000123));
	}

	#[test]
	fn price_response_parses_missing() {
		let raw = json!({});
		let r: PriceResponse = serde_json::from_value(raw).unwrap();
		assert_eq!(r.price, None);
	}

	#[test]
	fn tvl_response_parses_typical() {
		let raw = json!({ "satoshis": 1_200_000_000i64 });
		let r: TvlResponse = serde_json::from_value(raw).unwrap();
		assert_eq!(r.satoshis, Some(1_200_000_000));
	}

	#[test]
	fn tvl_response_parses_missing() {
		let raw = json!({});
		let r: TvlResponse = serde_json::from_value(raw).unwrap();
		assert_eq!(r.satoshis, None);
	}
}
