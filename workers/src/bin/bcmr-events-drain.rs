//! bcmr-events-drain — dispatch undelivered BCMR-watchdog change events to the
//! operator webhook (M3).
//!
//! Reads `bcmr_change_events WHERE delivered_at IS NULL` oldest-first and POSTs
//! each to the env-configured operator webhook (HMAC-signed). On a 2xx the row
//! is marked delivered; on a soft failure its `delivery_attempts` is bumped and
//! it's retried on the next run until the attempt ceiling. The structured event
//! is always journald-logged so an operator can tail it even when the webhook
//! is unset or silent (mirrors `reportAlert.ts`).
//!
//! Why a Rust binary and not a SvelteKit route (watchdog R7): every other sync
//! worker is a Rust bin hitting Postgres directly; a token-guarded public drain
//! route would be needless attack surface.
//!
//! Env vars:
//! - DATABASE_URL              (required)
//! - BCMR_WEBHOOK_URL          operator webhook; if unset, events stay queued
//! - BCMR_WEBHOOK_SECRET       optional HMAC-SHA256 signing secret
//! - BCMR_EVENTS_DRAIN_BATCH   default 50 (events per run)
//! - BCMR_EVENTS_MAX_ATTEMPTS  default 10 (give up on a dead webhook after N)
//! - RUST_LOG                  default info

use anyhow::{Context, Result};
use serde_json::json;
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

use workers::bcmr_dispatch::OperatorWebhook;
use workers::env::parse_or_default;
use workers::pg::{
    self, UndeliveredEvent, bytes_to_hex, mark_bcmr_events_drain_run, mark_event_delivered,
    mark_event_delivery_failed, pick_undelivered_events, pool_from_env,
    try_acquire_bcmr_events_lock,
};

const DEFAULT_BATCH: i32 = 50;
const DEFAULT_MAX_ATTEMPTS: i32 = 10;

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

/// Structured payload for one event — same flat shape philosophy as
/// `reportAlert.ts` so an operator's existing webhook receiver can parse it.
fn build_payload(e: &UndeliveredEvent) -> serde_json::Value {
    let category_hex = bytes_to_hex(&e.category);
    json!({
        "event": "bcmr_change",
        "id": e.id,
        "event_type": e.event_type,
        "severity": e.severity,
        "category": category_hex,
        "category_url": format!("https://tokenstork.com/token/{category_hex}"),
        "authchain_tx": bytes_to_hex(&e.authchain_tx),
        "prev_content_hash": e.prev_content_hash.as_ref().map(|h| bytes_to_hex(h)),
        "new_content_hash": e.new_content_hash.as_ref().map(|h| bytes_to_hex(h)),
        "prev_addr": e.prev_addr,
        "new_addr": e.new_addr,
        "block_height": e.block_height,
        "block_time": e.block_time.map(|t| t.to_rfc3339()),
        "pull_epoch": e.pull_epoch,
        "detail": e.detail,
        "detected_at": e.detected_at.to_rfc3339(),
        "site": "tokenstork"
    })
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let pool = pool_from_env().await.context("connecting to Postgres")?;

    // Run-level mutex: a manual run must not double-deliver alongside the timer.
    if !try_acquire_bcmr_events_lock(&pool).await? {
        info!("another bcmr-events-drain run holds the advisory lock; exiting");
        pg::shutdown(pool).await;
        return Ok(());
    }

    let batch: i32 = parse_or_default("BCMR_EVENTS_DRAIN_BATCH", DEFAULT_BATCH);
    let max_attempts: i32 = parse_or_default("BCMR_EVENTS_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS);

    let webhook = match OperatorWebhook::from_env()? {
        Some(w) => w,
        None => {
            // No sink configured — events persist; this is a no-op, not a crash.
            info!("BCMR_WEBHOOK_URL not set; leaving change events queued");
            mark_bcmr_events_drain_run(&pool).await.ok();
            pg::shutdown(pool).await;
            return Ok(());
        }
    };

    let events = pick_undelivered_events(&pool, max_attempts, batch).await?;
    let picked = events.len();
    let mut delivered = 0usize;
    let mut failed = 0usize;

    for e in &events {
        let payload = build_payload(e);
        // Always journald-log the event (durable even if the webhook is silent).
        info!("{}", payload);
        match webhook.deliver(&payload).await {
            Ok(true) => match mark_event_delivered(&pool, e.id).await {
                Ok(()) => delivered += 1,
                Err(err) => error!(id = e.id, error = %err, "failed to mark event delivered"),
            },
            Ok(false) => {
                failed += 1;
                if let Err(err) = mark_event_delivery_failed(&pool, e.id).await {
                    error!(id = e.id, error = %err, "failed to bump delivery_attempts");
                }
            }
            Err(err) => {
                // Unrecoverable local error (affects every event) — stop the run.
                error!(id = e.id, error = %err, "fatal dispatch error; aborting run");
                break;
            }
        }
    }

    mark_bcmr_events_drain_run(&pool).await?;
    info!(picked, delivered, failed, "bcmr-events-drain run complete");
    pg::shutdown(pool).await;
    Ok(())
}
