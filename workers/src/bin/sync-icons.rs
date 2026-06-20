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
//! - `reheal` (one-shot, operator-run) — re-runs the pending pipeline over
//!   icons currently `blocked` for a recoverable reason (`oversize`,
//!   `unsupported_format`). Resets those rows to pending (deleting the
//!   stale block so the content-hash dedupe doesn't short-circuit) and
//!   reprocesses them with the current decoders + size cap + downscaling.
//!   NEVER touches `adult` blocks — those are real content decisions.
//!
//! - `reflag` (one-shot, operator-run) — backfills source-icon provenance
//!   (format + native dimensions) for `review` rows decided before that
//!   tracking existed (`source_format IS NULL`). Reprocesses them in place;
//!   the decision is unchanged. Drives the token page's "icon adjusted"
//!   disclosure. Never touches cleared/blocked operator decisions.
//!
//! Env vars:
//! - DATABASE_URL                       — Postgres connection
//! - GOOGLE_VISION_API_KEY              — required for `pending` mode unless ICON_VISION_DISABLED=1 (rescan doesn't call Vision)
//! - ICON_VISION_DISABLED               — `1` to skip Vision; new icons land in `state='review'` for manual review (default unset)
//! - ICON_MODE                          — `pending` (default) | `rescan` | `reheal` | `reflag`
//! - ICON_REHEAL_REASONS                — comma list for `reheal` mode (default `oversize,unsupported_format`; `adult` is rejected)
//! - ICON_TICK_BATCH                    — max URLs per pending tick (default 200)
//! - ICON_RESCAN_BATCH                  — max URLs per rescan tick (default 500)
//! - ICON_NSFW_BLOCK_THRESHOLD          — default 0.9 (unused when ICON_VISION_DISABLED=1)
//! - ICON_NSFW_REVIEW_THRESHOLD         — default 0.6 (unused when ICON_VISION_DISABLED=1)
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
/// Default `block_reason`s the `reheal` mode reprocesses. `adult` is
/// deliberately absent and is rejected even if an operator passes it.
const DEFAULT_REHEAL_REASONS: &str = "oversize,unsupported_format";
/// The ONLY reasons `reheal` will ever act on. A hard allowlist so a typo
/// (or `adult`) can never re-serve content that was blocked on its pixels.
const ALLOWED_REHEAL_REASONS: &[&str] = &["oversize", "unsupported_format"];
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
    Reheal,
    Reflag,
}

impl Mode {
    fn from_env() -> Self {
        match std::env::var("ICON_MODE").as_deref() {
            Ok("rescan") => Mode::Rescan,
            Ok("reheal") => Mode::Reheal,
            Ok("reflag") => Mode::Reflag,
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
        Mode::Reheal => run_reheal(&pool, &http).await?,
        Mode::Reflag => run_reflag(&pool, &http).await?,
    }

    mark_icons_run(&pool).await?;
    pg::shutdown(pool).await;
    Ok(())
}

/// Shared config for the URL-processing modes (`pending`, `reheal`).
struct PendingConfig {
    api_key: Option<String>,
    block_threshold: f32,
    review_threshold: f32,
    batch: usize,
    output_dir: PathBuf,
}

/// Load + validate the pipeline config from the environment. Shared so the
/// pending tick and the reheal one-shot can never drift on thresholds,
/// Vision-disable semantics, or the output dir.
fn load_pending_config() -> Result<PendingConfig> {
    let vision_disabled = matches!(std::env::var("ICON_VISION_DISABLED").as_deref(), Ok("1"));
    let api_key = if vision_disabled {
        info!("ICON_VISION_DISABLED=1 — skipping Vision; new icons will land in state='review'");
        None
    } else {
        Some(std::env::var("GOOGLE_VISION_API_KEY").context("GOOGLE_VISION_API_KEY not set")?)
    };
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
    Ok(PendingConfig {
        api_key,
        block_threshold,
        review_threshold,
        batch,
        output_dir,
    })
}

/// Run a list of URIs through the per-URL pipeline, honoring the per-tick
/// wallclock budget. Shared by `run_pending` and `run_reheal`.
async fn drain(
    pool: &pg::PgPool,
    http: &reqwest::Client,
    uris: &[String],
    cfg: &PendingConfig,
) -> TickSummary {
    let deadline = Instant::now() + TICK_DEADLINE;
    let mut summary = TickSummary::default();

    for uri in uris {
        if Instant::now() >= deadline {
            warn!(
                processed = summary.scanned,
                of = uris.len(),
                "wallclock budget exhausted; deferring remainder to next run"
            );
            break;
        }
        match process_url(
            pool,
            http,
            cfg.api_key.as_deref(),
            &cfg.output_dir,
            uri,
            cfg.block_threshold,
            cfg.review_threshold,
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
    summary
}

async fn run_pending(pool: &pg::PgPool, http: &reqwest::Client) -> Result<()> {
    let cfg = load_pending_config()?;
    let pending = find_pending_icon_urls(pool, cfg.batch as i64).await?;

    if pending.is_empty() {
        // Healthy idle path — most ticks land here. Caller touches
        // the heartbeat after we return, so operator dashboards still
        // see the timer firing. No log noise on idle.
        return Ok(());
    }

    info!(n = pending.len(), batch = cfg.batch, "sync-icons tick — processing pending queue");

    let started = Instant::now();
    let summary = drain(pool, http, &pending, &cfg).await;
    let elapsed = started.elapsed().as_secs_f64();
    info!(
        ?summary,
        elapsed_s = format!("{:.1}", elapsed),
        "sync-icons (pending) tick complete"
    );
    Ok(())
}

/// `reheal` mode — re-run the pipeline over icons blocked for a recoverable
/// reason (`oversize`, `unsupported_format`). One-shot, operator-triggered.
async fn run_reheal(pool: &pg::PgPool, http: &reqwest::Client) -> Result<()> {
    let cfg = load_pending_config()?;

    // Parse + validate reasons against the hard allowlist. `adult` (and any
    // typo) is dropped with a warning — it must never be re-served.
    let raw =
        std::env::var("ICON_REHEAL_REASONS").unwrap_or_else(|_| DEFAULT_REHEAL_REASONS.into());
    let mut reasons: Vec<String> = Vec::new();
    for r in raw.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        if ALLOWED_REHEAL_REASONS.contains(&r) {
            if !reasons.iter().any(|x| x == r) {
                reasons.push(r.to_string());
            }
        } else {
            warn!(
                reason = %r,
                "ignoring non-rehealable reason (only oversize/unsupported_format allowed; adult is never rehealed)"
            );
        }
    }
    if reasons.is_empty() {
        return Err(anyhow!(
            "no valid reheal reasons (allowed: oversize, unsupported_format)"
        ));
    }

    // Snapshot the URLs BEFORE severing the links, then reset the rows so
    // the pipeline treats them as fresh pending work.
    let uris = pg::select_blocked_uris_for_reheal(pool, &reasons).await?;
    if uris.is_empty() {
        info!(?reasons, "reheal: no blocked icons match — nothing to do");
        return Ok(());
    }
    let (urls_reset, rows_deleted) = pg::reset_blocked_for_reheal(pool, &reasons).await?;
    info!(
        ?reasons,
        uris = uris.len(),
        urls_reset,
        rows_deleted,
        "reheal: reset blocked rows to pending; reprocessing now"
    );

    let started = Instant::now();
    let summary = drain(pool, http, &uris, &cfg).await;
    let elapsed = started.elapsed().as_secs_f64();
    info!(
        ?summary,
        elapsed_s = format!("{:.1}", elapsed),
        "sync-icons (reheal) complete"
    );
    Ok(())
}

/// `reflag` mode — backfill source-icon provenance for `review` rows that
/// predate adjustment tracking (`source_format IS NULL`). Reprocesses them
/// in place so they re-land in `review` with their format + dimensions
/// recorded (Vision is disabled in review mode, so the decision doesn't
/// change). One-shot, operator-triggered; never touches cleared/blocked
/// operator decisions.
async fn run_reflag(pool: &pg::PgPool, http: &reqwest::Client) -> Result<()> {
    let cfg = load_pending_config()?;

    let uris = pg::select_review_uris_for_reflag(pool).await?;
    if uris.is_empty() {
        info!("reflag: no review rows missing provenance — nothing to do");
        return Ok(());
    }
    let (urls_reset, rows_deleted) = pg::reset_review_for_reflag(pool).await?;
    info!(
        uris = uris.len(),
        urls_reset,
        rows_deleted,
        "reflag: reset provenance-less review rows to pending; reprocessing now"
    );

    let started = Instant::now();
    let summary = drain(pool, http, &uris, &cfg).await;
    let elapsed = started.elapsed().as_secs_f64();
    info!(
        ?summary,
        elapsed_s = format!("{:.1}", elapsed),
        "sync-icons (reflag) complete"
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
