//! load-watchdog — system load guard that alerts when the box is pegged.
//!
//! Reads /proc/loadavg every tick (fired by load-watchdog.timer), compares
//! the 1-min load average against a configured threshold, and POSTs a
//! structured alert to REPORT_WEBHOOK_URL when the threshold is crossed.
//!
//! A cooldown file prevents re-alerting on every tick while the box stays
//! overloaded. The timer interval (~2 min) is the sampling cadence; the
//! cooldown prevents spam during sustained incidents.
//!
//! Design rationale: the 2026-06-13 BlockBook swap-thrash incident ran for
//! hours at load 14 / 50% iowait before discovery via `top`. This watchdog
//! surfaces the condition in minutes so the operator can intervene (disable
//! the offending timer, check journalctl, or reboot) instead of finding out
//! from user reports.
//!
//! Env vars:
//! - REPORT_WEBHOOK_URL             — webhook URL (Discord / ntfy / TG bot / …)
//! - REPORT_WEBHOOK_SECRET          — optional HMAC-SHA256 secret
//! - LOAD_THRESHOLD                 — 1-min loadavg ceiling (default: 8)
//! - COOLDOWN_SECS                  — min seconds between alerts (default: 300)
//! - STATE_DIR                      — writable dir for cooldown file
//!                                    (default: /var/lib/tokenstork)
//! - RUST_LOG                       — default info
//!
//! The cooldown file is `$STATE_DIR/load-watchdog.state`. It contains one
//! line: the Unix timestamp of the last alert. If the file is missing or
//! unparseable, the watchdog alerts unconditionally (first-run / recovery).

use std::fs;
use std::io::Read;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::Sha256;
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

use workers::env::parse_or_default;

type HmacSha256 = Hmac<Sha256>;

const DEFAULT_THRESHOLD: f64 = 8.0;
const DEFAULT_SWAP_ALERT_GB: f64 = 2.0;
const DEFAULT_COOLDOWN_SECS: u64 = 300;
const DEFAULT_STATE_DIR: &str = "/var/lib/tokenstork";
const WEBHOOK_TIMEOUT_S: u64 = 10;

fn init_tracing() {
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

#[derive(Serialize)]
struct LoadAlert {
    event: &'static str,
    load_1min: f64,
    load_5min: f64,
    load_15min: f64,
    threshold: f64,
    /// Swap used in GB — included only when swap exceeds the
    /// SWAP_ALERT_GB threshold (default 2.0). null when below.
    #[serde(skip_serializing_if = "Option::is_none")]
    swap_used_gb: Option<f64>,
    host: String,
}

fn read_loadavg() -> Result<(f64, f64, f64)> {
    let mut buf = String::new();
    fs::File::open("/proc/loadavg")
        .context("opening /proc/loadavg")?
        .read_to_string(&mut buf)
        .context("reading /proc/loadavg")?;

    let mut parts = buf.split_whitespace();
    let l1: f64 = parts
        .next()
        .context("missing load1 in /proc/loadavg")?
        .parse()
        .context("parsing load1")?;
    let l5: f64 = parts
        .next()
        .context("missing load5 in /proc/loadavg")?
        .parse()
        .context("parsing load5")?;
    let l15: f64 = parts
        .next()
        .context("missing load15 in /proc/loadavg")?
        .parse()
        .context("parsing load15")?;
    Ok((l1, l5, l15))
}

/// Read swap usage in GB from /proc/meminfo. Returns None if parsing fails.
fn read_swap_gb() -> Option<f64> {
    let raw = fs::read_to_string("/proc/meminfo").ok()?;
    let mut total_kb: Option<u64> = None;
    let mut free_kb: Option<u64> = None;
    for line in raw.lines() {
        if line.starts_with("SwapTotal:") {
            total_kb = line.split_ascii_whitespace().nth(1)?.parse().ok();
        } else if line.starts_with("SwapFree:") {
            free_kb = line.split_ascii_whitespace().nth(1)?.parse().ok();
        }
        if total_kb.is_some() && free_kb.is_some() {
            break;
        }
    }
    let used_kb = total_kb?.checked_sub(free_kb?)?;
    Some(used_kb as f64 / (1024.0 * 1024.0))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn read_last_alert(state_path: &str) -> Option<u64> {
    let raw = fs::read_to_string(state_path).ok()?;
    let ts: u64 = raw.trim().parse().ok()?;
    Some(ts)
}

fn write_last_alert(state_path: &str, ts: u64) {
    if let Err(e) = fs::write(state_path, format!("{ts}\n")) {
        warn!(%state_path, error = %e, "failed to write cooldown state file");
    }
}

fn build_hmac_signature(secret: &str, body: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("HMAC-SHA256 accepts any key length");
    mac.update(body.as_bytes());
    let result = mac.finalize();
    format!("sha256={}", hex::encode(result.into_bytes()))
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let threshold: f64 = parse_or_default("LOAD_THRESHOLD", DEFAULT_THRESHOLD);
    let swap_alert_gb: f64 = parse_or_default("SWAP_ALERT_GB", DEFAULT_SWAP_ALERT_GB);
    let cooldown_secs: u64 = parse_or_default("COOLDOWN_SECS", DEFAULT_COOLDOWN_SECS);
    let state_dir = std::env::var("STATE_DIR").unwrap_or_else(|_| DEFAULT_STATE_DIR.to_string());
    let state_path = format!("{state_dir}/load-watchdog.state");

    // Ensure state directory exists (best-effort — the systemd unit's
    // StateDirectory= directive handles this, but we try here too for
    // operator-ad-hoc runs).
    let _ = fs::create_dir_all(&state_dir);

    let (l1, l5, l15) = read_loadavg().context("reading loadavg")?;
    let swap_gb = read_swap_gb();

    info!(load_1min = l1, load_5min = l5, load_15min = l15, threshold, ?swap_gb, "load check");

    // Alert if EITHER load or swap exceeds its threshold. Swap is a
    // leading indicator — when RocksDB gets pushed past MemoryHigh,
    // swap fills before load spikes. Alerting on swap catches the
    // thrash spiral before it fully develops.
    let load_exceeded = l1 > threshold;
    let swap_exceeded = swap_gb.map_or(false, |s| s > swap_alert_gb);
    if !load_exceeded && !swap_exceeded {
        let _ = fs::remove_file(&state_path);
        return Ok(());
    }
    // Load or swap exceeds threshold — check cooldown.
    let webhook_url = std::env::var("REPORT_WEBHOOK_URL").unwrap_or_default();
    if webhook_url.is_empty() {
        warn!(
            load_1min = l1,
            threshold,
            "load exceeds threshold but REPORT_WEBHOOK_URL is unset — alert suppressed"
        );
        return Ok(());
    }

    let now = now_secs();
    if let Some(last) = read_last_alert(&state_path) {
        if now.saturating_sub(last) < cooldown_secs {
            info!(
                load_1min = l1,
                last_alert_s = now.saturating_sub(last),
                cooldown_secs,
                "load exceeds threshold but within cooldown — alert suppressed"
            );
            return Ok(());
        }
    }

    // Fire alert.
    let host = fs::read_to_string("/proc/sys/kernel/hostname")
        .ok()
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let alert = LoadAlert {
        event: "load_watchdog",
        load_1min: (l1 * 100.0).round() / 100.0,
        load_5min: (l5 * 100.0).round() / 100.0,
        load_15min: (l15 * 100.0).round() / 100.0,
        threshold,
        swap_used_gb: swap_gb.filter(|&s| s > swap_alert_gb).map(|s| (s * 100.0).round() / 100.0),
        host,
    };

    let body = serde_json::to_string(&alert).context("serializing alert")?;

    // Log to journald regardless of webhook state.
    warn!("{}", body);

    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        "application/json".parse().unwrap(),
    );
    headers.insert(
        reqwest::header::USER_AGENT,
        "tokenstork-load-watchdog/1".parse().unwrap(),
    );

    let secret = std::env::var("REPORT_WEBHOOK_SECRET").unwrap_or_default();
    if !secret.is_empty() {
        let sig = build_hmac_signature(&secret, &body);
        headers.insert(
            "x-tokenstork-signature",
            sig.parse().expect("valid header value"),
        );
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(WEBHOOK_TIMEOUT_S))
        .pool_max_idle_per_host(0)
        .build()
        .context("building reqwest client")?;

    match client
        .post(&webhook_url)
        .headers(headers)
        .body(body.clone())
        .send()
        .await
    {
        Ok(resp) => {
            if resp.status().is_success() {
                write_last_alert(&state_path, now);
                info!(status = resp.status().as_u16(), "load alert delivered");
            } else {
                error!(
                    status = resp.status().as_u16(),
                    "webhook responded non-success"
                );
            }
        }
        Err(e) => {
            error!(error = %e, "webhook POST failed");
        }
    }

    Ok(())
}
