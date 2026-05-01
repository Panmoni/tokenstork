//! sync-icons — periodic icon-pipeline tick on a 15-min systemd timer.
//!
//! Two modes, dispatched from `ICON_MODE` env var:
//!
//! - `pending` (default) — same per-URL pipeline as `sync-icons-backfill`
//!   (factored into [`workers::sync_icons::process_url`] so the two
//!   binaries can't drift on default-deny rules). Walks
//!   `icon_url_scan` rows where `content_hash IS NULL` (never
//!   successfully scanned) OR `fetch_error IS NOT NULL` (transient
//!   retry). Most ticks process zero rows because new BCMR icons
//!   enter the queue only on `sync-bcmr` discoveries (4h cadence).
//!
//! - `rescan` (Phase D) — walks the OLDEST already-scanned URLs,
//!   re-fetches + re-hashes, and flips any URL whose bytes drifted
//!   back to pending so the next pending tick re-scans from scratch.
//!   Catches the same-URL-different-bytes attack (a malicious gateway
//!   swapping content under a stable HTTPS URL). At
//!   `ICON_RESCAN_BATCH=500/tick × Sun 03:00 UTC weekly`, a 10k-URL
//!   table fully sweeps in ~5 weeks.
//!
//! Env vars:
//! - DATABASE_URL                       — Postgres connection
//! - GOOGLE_VISION_API_KEY              — required for `pending` mode (rescan doesn't call Vision)
//! - ICON_MODE                          — `pending` (default) | `rescan`
//! - ICON_TICK_BATCH                    — max URLs per pending tick (default 200)
//! - ICON_RESCAN_BATCH                  — max URLs per rescan tick (default 500)
//! - ICON_NSFW_BLOCK_THRESHOLD          — default 0.9
//! - ICON_NSFW_REVIEW_THRESHOLD         — default 0.6
//! - ICON_OUTPUT_DIR                    — default /var/lib/tokenstork/icons
//! - RUST_LOG                           — default info
//!
//! Plan reference: docs/icon-safety-plan.md (Phase A step 5+7, Phase D step 15+17).

use std::path::PathBuf;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow};
use tokio::time::sleep;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

use workers::env::parse_or_default;
use workers::pg::{
    self, find_oldest_scanned_icon_urls, find_pending_icon_urls, mark_icons_run, pool_from_env,
    try_acquire_icons_lock,
};
use workers::safe_http::safe_client_builder;
use workers::sync_icons::{Outcome, RescanOutcome, process_url, rescan_url};

const DEFAULT_OUTPUT_DIR: &str = "/var/lib/tokenstork/icons";
const DEFAULT_BLOCK_THRESHOLD: f32 = 0.9;
const DEFAULT_REVIEW_THRESHOLD: f32 = 0.6;
const DEFAULT_BATCH: usize = 200;
const DEFAULT_RESCAN_BATCH: usize = 500;
const PER_REQUEST_DELAY: Duration = Duration::from_millis(35);
/// Per-tick wallclock budget. A hostile gateway that hangs just under
/// the per-request timeout could otherwise stall a tick for
/// (200 batch × 20 s timeout) ≈ 67 minutes — masking pending-queue
/// growth and starving the next tick. 10 minutes leaves slack for a
/// large healthy batch while bounding the worst-case run.
const TICK_DEADLINE: Duration = Duration::from_secs(600);

#[derive(Debug, Clone, Copy)]
enum Mode {
    Pending,
    Rescan,
}

impl Mode {
    fn from_env() -> Self {
        match std::env::var("ICON_MODE").as_deref() {
            Ok("rescan") => Mode::Rescan,
            // Default to pending for any other value (including unset
            // and the explicit "pending"). Operator typos fail safe.
            _ => Mode::Pending,
        }
    }
}

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

#[derive(Default, Debug)]
struct RescanSummary {
    scanned: usize,
    unchanged: usize,
    drifted: usize,
    fetch_failed: usize,
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

    let mode = Mode::from_env();
    let pool = pool_from_env().await?;

    // Advisory lock so a slow tick can't be lapped by the next timer
    // fire (or by a concurrent rescan + pending). Single lock keyspace
    // for both modes — a rescan that runs long blocks the next pending
    // tick and vice versa, which is correct (we don't want them
    // racing on the same row).
    if !try_acquire_icons_lock(&pool).await? {
        info!("another sync-icons run is in flight (advisory lock held); skipping this tick");
        pg::shutdown(pool).await;
        return Ok(());
    }

    // SSRF defense: this client is built via safe_client_builder, which
    //   - installs the SafeResolver (drops every DNS answer in
    //     private/loopback/link-local/etc. space), re-validating per
    //     redirect hop
    //   - disables connection-pool keep-alive so a hostile gateway
    //     can't replay another request on the same TLS session
    //   - caps redirects at 2 hops
    let http = safe_client_builder("tokenstork-workers/0.1", Duration::from_secs(30), 2).build()?;

    match mode {
        Mode::Pending => run_pending(&pool, &http).await?,
        Mode::Rescan => run_rescan(&pool, &http).await?,
    }

    mark_icons_run(&pool).await?;
    pg::shutdown(pool).await;
    Ok(())
}

async fn run_pending(pool: &pg::PgPool, http: &reqwest::Client) -> Result<()> {
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

    let pending = find_pending_icon_urls(pool, batch as i64).await?;

    if pending.is_empty() {
        // Healthy idle path — most ticks land here. Caller touches
        // the heartbeat after we return, so operator dashboards still
        // see the timer firing. No log noise on idle.
        return Ok(());
    }

    info!(n = pending.len(), batch, "sync-icons tick — processing pending queue");

    let started = Instant::now();
    let deadline = started + TICK_DEADLINE;
    let mut summary = TickSummary::default();

    for uri in &pending {
        if Instant::now() >= deadline {
            warn!(
                processed = summary.scanned,
                of = pending.len(),
                "tick wallclock budget exhausted; deferring remainder to next run"
            );
            break;
        }
        match process_url(
            pool,
            http,
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

    let elapsed = started.elapsed().as_secs_f64();
    info!(
        ?summary,
        elapsed_s = format!("{:.1}", elapsed),
        "sync-icons (pending) tick complete"
    );
    Ok(())
}

async fn run_rescan(pool: &pg::PgPool, http: &reqwest::Client) -> Result<()> {
    let batch: usize = parse_or_default("ICON_RESCAN_BATCH", DEFAULT_RESCAN_BATCH);

    let candidates = find_oldest_scanned_icon_urls(pool, batch as i64).await?;
    if candidates.is_empty() {
        return Ok(());
    }

    info!(n = candidates.len(), batch, "sync-icons rescan — re-fetching oldest scanned URLs");

    let started = Instant::now();
    let deadline = started + TICK_DEADLINE;
    let mut summary = RescanSummary::default();

    for (uri, expected) in &candidates {
        if Instant::now() >= deadline {
            warn!(
                processed = summary.scanned,
                of = candidates.len(),
                "rescan wallclock budget exhausted; deferring remainder to next run"
            );
            break;
        }
        match rescan_url(pool, http, uri, expected).await {
            Ok(RescanOutcome::Unchanged) => summary.unchanged += 1,
            Ok(RescanOutcome::Drifted) => summary.drifted += 1,
            Ok(RescanOutcome::FetchFailed) => summary.fetch_failed += 1,
            Err(e) => {
                warn!(uri = %uri, error = %e, "rescan row failed unexpectedly; continuing");
            }
        }
        summary.scanned += 1;
        sleep(PER_REQUEST_DELAY).await;
    }

    let elapsed = started.elapsed().as_secs_f64();
    info!(
        ?summary,
        elapsed_s = format!("{:.1}", elapsed),
        "sync-icons (rescan) tick complete"
    );
    Ok(())
}
