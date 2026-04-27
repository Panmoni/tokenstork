//! tail-watchdog — operational liveness check on `sync-tail`.
//!
//! Reads `sync_state.last_tail_run_at` and compares it to `now()`. Exits
//! cleanly if the heartbeat is fresh; exits non-zero (with a WARN line
//! in the journal) if the heartbeat is stale or missing entirely.
//!
//! Designed to be fired by `tail-watchdog.timer` every 1 minute. The
//! systemd-driven `Result=` field flips to `failed` on a stale tick,
//! so operator dashboards can detect the condition with a one-liner:
//!
//!   systemctl is-failed tail-watchdog.service
//!
//! And `journalctl -u tail-watchdog.service` shows the structured
//! WARN with the staleness value.
//!
//! Why a separate binary instead of letting `sync-tail` self-report:
//! sync-tail is the thing we're checking on. If it's wedged, asking it
//! to tell us would be circular. This binary's sole job is to be
//! independently fire-able and read the column from the outside.
//!
//! Env vars:
//! - DATABASE_URL                      — Postgres connection
//! - TAIL_STALE_THRESHOLD_SECS         — staleness ceiling, default 300 (5 min)
//! - RUST_LOG                          — default info
//!
//! Plan reference: docs/cashtoken-index-plan.md item #6 (operational
//! hardening). Pairs with the tail's existing
//! `Type=notify + WatchdogSec=120s` systemd-level watchdog — that
//! catches in-process hangs; this catches the case where the process
//! is alive-and-looping-but-not-making-progress, e.g., stuck in a
//! reqwest retry loop or wedged on a Postgres connection.

use std::process::ExitCode;
use std::time::Duration;

use anyhow::{Context, Result};
use chrono::Utc;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

use workers::env::parse_or_default;
use workers::pg::{self, load_last_tail_run_at, pool_from_env};

const DEFAULT_THRESHOLD_SECS: u64 = 300; // 5 min

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

#[tokio::main]
async fn main() -> Result<ExitCode> {
    init_tracing();

    let threshold_secs: u64 = parse_or_default("TAIL_STALE_THRESHOLD_SECS", DEFAULT_THRESHOLD_SECS);
    let threshold = Duration::from_secs(threshold_secs);

    let pool = pool_from_env().await.context("connecting to Postgres")?;
    let last = load_last_tail_run_at(&pool).await?;
    pg::shutdown(pool).await;

    let now = Utc::now();

    let staleness = match last {
        Some(ts) => {
            let delta = now.signed_duration_since(ts);
            if delta.num_seconds() < 0 {
                // Clock skew between this process and the column write
                // — could happen if NTP just adjusted. Treat as fresh.
                Duration::ZERO
            } else {
                Duration::from_secs(delta.num_seconds() as u64)
            }
        }
        None => {
            warn!("sync_state.last_tail_run_at is NULL — has sync-tail ever run?");
            return Ok(ExitCode::from(2));
        }
    };

    if staleness > threshold {
        warn!(
            staleness_secs = staleness.as_secs(),
            threshold_secs = threshold.as_secs(),
            "tail heartbeat stale — sync-tail may be wedged; check `systemctl status sync-tail` + recent journalctl"
        );
        return Ok(ExitCode::from(1));
    }

    // Fresh heartbeat → silent OK. Avoids journal noise on every
    // healthy minute. systemd marks the unit as `success`.
    info!(staleness_secs = staleness.as_secs(), "tail heartbeat fresh");
    Ok(ExitCode::SUCCESS)
}
