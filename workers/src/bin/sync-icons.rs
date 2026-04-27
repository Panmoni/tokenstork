//! sync-icons — periodic icon-pipeline tick on a 15-min systemd timer.
//!
//! Same per-URL pipeline as `sync-icons-backfill` (factored into
//! [`workers::sync_icons::process_url`] so the two binaries can't drift
//! on default-deny rules) but with a smaller batch size and no
//! progress-meter logging — every tick processes whatever's pending.
//!
//! Pending = `icon_url_scan` rows where `content_hash IS NULL` (never
//! successfully scanned) OR `fetch_error IS NOT NULL` (transient retry
//! after IPFS gateway timeout, Vision API hiccup, etc.).
//!
//! Most ticks process zero rows because new BCMR icons enter the queue
//! only on `sync-bcmr` discoveries (4h cadence). When new tokens land,
//! they flip from placeholder to real WebP within at most one tick of
//! BCMR discovery — i.e., ~4h 15m worst case.
//!
//! Env vars:
//! - DATABASE_URL                       — Postgres connection
//! - GOOGLE_VISION_API_KEY              — required; missing → bail
//! - ICON_TICK_BATCH                    — max URLs per tick (default 200)
//! - ICON_NSFW_BLOCK_THRESHOLD          — default 0.9
//! - ICON_NSFW_REVIEW_THRESHOLD         — default 0.6
//! - ICON_OUTPUT_DIR                    — default /var/lib/tokenstork/icons
//! - RUST_LOG                           — default info
//!
//! Plan reference: docs/icon-safety-plan.md (Phase A step 5 + step 7).

use std::path::PathBuf;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow};
use tokio::time::sleep;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

use workers::env::parse_or_default;
use workers::pg::{
    self, find_pending_icon_urls, mark_icons_run, pool_from_env, try_acquire_icons_lock,
};
use workers::sync_icons::{Outcome, process_url};

const DEFAULT_OUTPUT_DIR: &str = "/var/lib/tokenstork/icons";
const DEFAULT_BLOCK_THRESHOLD: f32 = 0.9;
const DEFAULT_REVIEW_THRESHOLD: f32 = 0.6;
const DEFAULT_BATCH: usize = 200;
const PER_REQUEST_DELAY: Duration = Duration::from_millis(35);

#[derive(Default, Debug)]
struct TickSummary {
    scanned: usize,
    cleared: usize,
    blocked_adult: usize,
    review: usize,
    blocked_oversize: usize,
    blocked_unsupported: usize,
    fetch_failed: usize,
    deduped: usize,
    vision_errors: usize,
    transcode_errors: usize,
    write_errors: usize,
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let api_key =
        std::env::var("GOOGLE_VISION_API_KEY").context("GOOGLE_VISION_API_KEY not set")?;
    let block_threshold: f32 =
        parse_or_default("ICON_NSFW_BLOCK_THRESHOLD", DEFAULT_BLOCK_THRESHOLD);
    let review_threshold: f32 =
        parse_or_default("ICON_NSFW_REVIEW_THRESHOLD", DEFAULT_REVIEW_THRESHOLD);
    let batch: usize = parse_or_default("ICON_TICK_BATCH", DEFAULT_BATCH);
    let output_dir = std::env::var("ICON_OUTPUT_DIR").unwrap_or_else(|_| DEFAULT_OUTPUT_DIR.into());
    let output_dir = PathBuf::from(output_dir);

    if block_threshold <= review_threshold {
        return Err(anyhow!(
            "ICON_NSFW_BLOCK_THRESHOLD ({}) must be > ICON_NSFW_REVIEW_THRESHOLD ({})",
            block_threshold, review_threshold,
        ));
    }

    if !output_dir.exists() {
        std::fs::create_dir_all(&output_dir)
            .with_context(|| format!("creating ICON_OUTPUT_DIR={}", output_dir.display()))?;
    }

    let pool = pool_from_env().await?;

    // Advisory lock so a slow tick can't be lapped by the next timer
    // fire (or by an operator-invoked bootstrap running concurrently).
    if !try_acquire_icons_lock(&pool).await? {
        info!("another sync-icons run is in flight (advisory lock held); skipping this tick");
        pg::shutdown(pool).await;
        return Ok(());
    }

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(2))
        .build()?;

    let pending = find_pending_icon_urls(&pool, batch as i64).await?;

    if pending.is_empty() {
        // Healthy idle path — most ticks land here. Touch the
        // heartbeat so operator dashboards can detect whether the
        // timer is firing at all, and exit cleanly. No log noise.
        mark_icons_run(&pool).await?;
        pg::shutdown(pool).await;
        return Ok(());
    }

    info!(n = pending.len(), batch, "sync-icons tick — processing pending queue");

    let started = Instant::now();
    let mut summary = TickSummary::default();

    for uri in &pending {
        match process_url(
            &pool,
            &http,
            &api_key,
            &output_dir,
            uri,
            block_threshold,
            review_threshold,
        )
        .await
        {
            Ok(outcome) => match outcome {
                Outcome::Cleared => summary.cleared += 1,
                Outcome::BlockedAdult => summary.blocked_adult += 1,
                Outcome::Review => summary.review += 1,
                Outcome::BlockedOversize => summary.blocked_oversize += 1,
                Outcome::BlockedUnsupported => summary.blocked_unsupported += 1,
                Outcome::Deduped => summary.deduped += 1,
                Outcome::FetchFailed => summary.fetch_failed += 1,
                Outcome::VisionError => summary.vision_errors += 1,
                Outcome::TranscodeError => summary.transcode_errors += 1,
                Outcome::WriteError => summary.write_errors += 1,
            },
            Err(e) => {
                warn!(uri = %uri, error = %e, "row failed unexpectedly; continuing");
            }
        }
        summary.scanned += 1;
        sleep(PER_REQUEST_DELAY).await;
    }

    mark_icons_run(&pool).await?;

    let elapsed = started.elapsed().as_secs_f64();
    info!(
        ?summary,
        elapsed_s = format!("{:.1}", elapsed),
        "sync-icons tick complete"
    );

    pg::shutdown(pool).await;
    Ok(())
}
