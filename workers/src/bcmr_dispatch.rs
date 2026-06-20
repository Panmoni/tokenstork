//! BCMR-watchdog event delivery channels (M3).
//!
//! The drainer (`bin/bcmr-events-drain.rs`) builds a structured JSON payload per
//! change event and hands it to a channel for transport. Today the only live
//! channel is the **operator webhook**: one env-configured endpoint that
//! receives every event (point it at Telegram / Discord / ntfy / a forwarder),
//! mirroring `src/lib/server/reportAlert.ts` (HMAC-signed, fire-and-forget,
//! journald-durable). Per-holder Telegram/email are stubbed below for a later
//! increment so they drop into the channel registry without reworking the
//! pipeline.
//!
//! Unlike the walker's outbound fetches, the webhook URL is **operator-trusted**
//! (not attacker-controlled), so this deliberately uses a plain HTTP client —
//! NOT the SSRF-restricted `safe_http` one — so an operator can legitimately
//! point the webhook at a localhost/private forwarder (e.g. a local ntfy), the
//! same posture as `reportAlert.ts`.

use std::time::Duration;

use anyhow::{Context, Result, bail};
use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

const WEBHOOK_TIMEOUT_S: u64 = 5;

/// A configured operator webhook sink.
pub struct OperatorWebhook {
    url: String,
    secret: Option<String>,
    client: reqwest::Client,
}

impl OperatorWebhook {
    /// Build from env. Returns `Ok(None)` when `BCMR_WEBHOOK_URL` is unset — the
    /// drainer then leaves events queued (and logs) rather than failing, so a
    /// deployment without a webhook configured is a no-op, not a crash.
    pub fn from_env() -> Result<Option<Self>> {
        let url = match std::env::var("BCMR_WEBHOOK_URL") {
            Ok(u) if !u.trim().is_empty() => u,
            _ => return Ok(None),
        };
        let secret = std::env::var("BCMR_WEBHOOK_SECRET")
            .ok()
            .filter(|s| !s.trim().is_empty());
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(WEBHOOK_TIMEOUT_S))
            .build()
            .context("building bcmr webhook client")?;
        Ok(Some(Self {
            url,
            secret,
            client,
        }))
    }

    /// Deliver one event payload. `Ok(true)` = a 2xx (delivered); `Ok(false)` =
    /// a soft failure to retry later (network error or non-2xx). `Err` is
    /// reserved for an unrecoverable local error (e.g. HMAC key construction).
    pub async fn deliver(&self, payload: &serde_json::Value) -> Result<bool> {
        let body = serde_json::to_vec(payload).context("serialize bcmr event payload")?;

        let mut req = self
            .client
            .post(&self.url)
            .header("content-type", "application/json")
            .header("user-agent", "tokenstork-bcmr-events/1");

        // Optional HMAC so the receiver can verify authenticity. Header name +
        // `sha256=<hex>` shape match reportAlert.ts (GitHub convention).
        if let Some(secret) = &self.secret {
            let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
                .map_err(|e| anyhow::anyhow!("hmac key: {e}"))?;
            mac.update(&body);
            let sig = hex::encode(mac.finalize().into_bytes());
            req = req.header("x-tokenstork-signature", format!("sha256={sig}"));
        }

        match req.body(body).send().await {
            Ok(resp) if resp.status().is_success() => Ok(true),
            Ok(resp) => {
                tracing::warn!(status = resp.status().as_u16(), "bcmr webhook non-2xx");
                Ok(false)
            }
            Err(e) => {
                tracing::warn!(error = %e, "bcmr webhook POST failed");
                Ok(false)
            }
        }
    }
}

// ── Future per-holder channels (not yet wired) ──────────────────────────────
// Stubs that document the extension point. The drainer's channel registry will
// route per-`bcmr_watch` subscription to these once the bot/SMTP infra exists.

/// Per-holder Telegram delivery — not yet implemented.
pub async fn deliver_telegram(_chat_id: &str, _payload: &serde_json::Value) -> Result<bool> {
    bail!("telegram channel not yet implemented")
}

/// Per-holder email delivery — not yet implemented.
pub async fn deliver_email(_address: &str, _payload: &serde_json::Value) -> Result<bool> {
    bail!("email channel not yet implemented")
}
