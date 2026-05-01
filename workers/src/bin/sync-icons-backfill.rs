//! sync-icons-backfill — one-shot bootstrap for the icon safety pipeline.
//!
//! Walks every distinct `token_metadata.icon_uri` once, runs the full
//! fetch → hash → dedupe → decode → NSFW gate → transcode pipeline per
//! URL via [`workers::sync_icons::process_url`], and writes:
//!   - `icon_moderation(content_hash, state, ...)` — one row per unique
//!     content hash (a single hash can back many BCMR URIs)
//!   - `icon_url_scan(icon_uri, content_hash)` — link
//!   - `/var/lib/tokenstork/icons/<hex_hash>.webp` — cleared bytes only
//!
//! Cloudflare's CSAM Scanning Tool is implicit — it scans bytes that
//! transit the CF edge when we serve the WebP. We do NOT call out to it
//! from this binary. The cascade is operator-driven on a CF alert; see
//! docs/icon-safety-plan.md §6.
//!
//! Env vars:
//! - DATABASE_URL                       — Postgres connection
//! - GOOGLE_VISION_API_KEY              — required unless ICON_VISION_DISABLED=1
//! - ICON_VISION_DISABLED               — `1` to skip Vision; new icons land in `state='review'` for manual review (default unset)
//! - ICON_BOOTSTRAP_LIMIT               — cap rows scanned per run (0 = unlimited; default 0)
//! - ICON_NSFW_BLOCK_THRESHOLD          — default 0.9 (unused when ICON_VISION_DISABLED=1)
//! - ICON_NSFW_REVIEW_THRESHOLD         — default 0.6 (unused when ICON_VISION_DISABLED=1)
//! - ICON_OUTPUT_DIR                    — default /var/lib/tokenstork/icons
//! - RUST_LOG                           — default info
//!
//! Plan reference: docs/icon-safety-plan.md (Phase A step 7 + Phase B step 10).

use std::path::PathBuf;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow};
use tokio::time::sleep;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

use workers::env::parse_or_default;
use workers::pg::{
    self, find_pending_icon_urls, mark_icons_run, pool_from_env,
    seed_icon_url_scan_from_metadata, try_acquire_icons_lock,
};
use workers::safe_http::safe_client_builder;
use workers::sync_icons::{Outcome, process_url};

const DEFAULT_OUTPUT_DIR: &str = "/var/lib/tokenstork/icons";
const DEFAULT_BLOCK_THRESHOLD: f32 = 0.9;
const DEFAULT_REVIEW_THRESHOLD: f32 = 0.6;
/// Polite delay between Vision API calls. ~30 req/s is well under the
/// default 1,800 req/min ceiling and is friendly to IPFS gateways too.
const PER_REQUEST_DELAY: Duration = Duration::from_millis(35);

#[derive(Default, Debug)]
struct Summary {
    seeded: u64,
    scanned: usize,
    cleared: usize,
    blocked_adult: usize,
    review: usize,
    blocked_oversize: usize,
    blocked_unsupported: usize,
    fetch_failed: usize,
    deduped: usize,
    vision_errors: usize,
    /// Encode-side transcode failure — almost always a transient `image`
    /// crate bug. URL stays `pending` for retry.
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
    let limit: usize = parse_or_default("ICON_BOOTSTRAP_LIMIT", 0);
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

    // Advisory lock — refuse to run if another sync-icons process is
    // already in flight on this DB. Without this, two concurrent runs
    // both pick up the same pending URLs and both pay Vision $0.0015 per
    // duplicate scan; the upsert itself is atomic so end-state is
    // consistent, but the duplicate spend is wasteful.
    if !try_acquire_icons_lock(&pool).await? {
        warn!("another sync-icons run is in flight (advisory lock held); exiting cleanly");
        pg::shutdown(pool).await;
        return Ok(());
    }

    // SSRF defense layered: safe_client_builder installs the SafeResolver
    // (drops every DNS answer in private/loopback/link-local space, re-
    // validating per redirect hop), disables connection-pool keep-alive,
    // and caps redirects at 2 hops. An issuer-controlled BCMR icon can
    // neither bounce us through 10 redirect-following hops nor connect
    // to internal network targets via a hostile DNS answer.
    let http = safe_client_builder("tokenstork-workers/0.1", Duration::from_secs(30), 2).build()?;

    info!(
        block_threshold,
        review_threshold,
        limit = if limit == 0 { "unlimited".into() } else { limit.to_string() },
        output_dir = %output_dir.display(),
        "sync-icons-backfill starting"
    );

    // Step 1: seed `icon_url_scan` from existing metadata. Idempotent.
    let mut summary = Summary {
        seeded: seed_icon_url_scan_from_metadata(&pool).await?,
        ..Summary::default()
    };
    info!(seeded = summary.seeded, "seeded icon_url_scan from token_metadata");

    // Step 2: pull the pending queue. With `limit=0` we ask for a generous
    // batch ceiling; with a finite limit we ask for exactly that many.
    let batch_size: i64 = if limit == 0 { 50_000 } else { limit as i64 };
    let pending = find_pending_icon_urls(&pool, batch_size).await?;
    info!(n = pending.len(), "pulled pending queue");

    // Step 3: process row-by-row. The per-row failure path always continues
    // — the queue is recoverable on a future run.
    let started = Instant::now();
    let to_scan = if limit == 0 {
        pending.as_slice()
    } else {
        &pending[..pending.len().min(limit)]
    };

    for (i, uri) in to_scan.iter().enumerate() {
        if i > 0 && i % 25 == 0 {
            info!(
                progress = i,
                of = to_scan.len(),
                elapsed_s = format!("{:.1}", started.elapsed().as_secs_f64()),
                "..."
            );
        }

        match process_url(
            &pool,
            &http,
            api_key.as_deref(),
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
        "sync-icons-backfill complete"
    );

    pg::shutdown(pool).await;
    Ok(())
}
