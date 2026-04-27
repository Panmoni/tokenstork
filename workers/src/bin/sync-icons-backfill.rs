//! sync-icons-backfill — one-shot bootstrap for the icon safety pipeline.
//!
//! Walks every distinct `token_metadata.icon_uri` once, runs the full
//! fetch → hash → dedupe → NSFW gate → transcode pipeline per URL, and
//! writes:
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
//! - GOOGLE_VISION_API_KEY              — required; missing → bail
//! - ICON_BOOTSTRAP_LIMIT               — cap rows scanned per run (0 = unlimited; default 0)
//! - ICON_NSFW_BLOCK_THRESHOLD          — default 0.9
//! - ICON_NSFW_REVIEW_THRESHOLD         — default 0.6
//! - ICON_OUTPUT_DIR                    — default /var/lib/tokenstork/icons
//! - RUST_LOG                           — default info
//!
//! Plan reference: docs/icon-safety-plan.md (Phase A step 7 + Phase B step 10).

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow};
use tokio::time::sleep;
use tracing::{debug, info, warn};
use tracing_subscriber::EnvFilter;

use workers::env::parse_or_default;
use workers::google_vision::safe_search;
use workers::icons::{
    FetchOutcome, NsfwOutcome, classify_nsfw, decode_image, encode_to_webp, fetch_and_hash,
};
use workers::pg::{
    self, IconModerationWrite, find_icon_moderation_state, find_pending_icon_urls,
    link_url_to_hash, mark_icon_fetch_failed, mark_icons_run, pool_from_env,
    seed_icon_url_scan_from_metadata, try_acquire_icons_lock, upsert_icon_moderation,
};

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

    let api_key =
        std::env::var("GOOGLE_VISION_API_KEY").context("GOOGLE_VISION_API_KEY not set")?;
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

    // SSRF defense: cap redirects to 2 hops so an issuer-controlled BCMR
    // icon can't bounce us through 10 redirect-following hops to internal
    // network targets. The Policy applies to the whole Client; per-request
    // overrides aren't needed.
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(2))
        .build()?;

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

        match process_one(&pool, &http, &api_key, &output_dir, uri, block_threshold, review_threshold)
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

#[derive(Debug)]
enum Outcome {
    Cleared,
    BlockedAdult,
    Review,
    BlockedOversize,
    /// Decoded as a non-image / corrupt bytes / unsupported format. Permanent
    /// `state='blocked' reason='unsupported_format'` — re-trying won't help.
    BlockedUnsupported,
    Deduped,
    FetchFailed,
    VisionError,
    /// Encode-side transcode failure on a SUCCESSFULLY-decoded image. Almost
    /// always a transient `image` crate bug; URL stays pending so a future
    /// library version can retry.
    TranscodeError,
    WriteError,
}

async fn process_one(
    pool: &pg::PgPool,
    http: &reqwest::Client,
    api_key: &str,
    output_dir: &Path,
    uri: &str,
    block_threshold: f32,
    review_threshold: f32,
) -> Result<Outcome> {
    // 1. Fetch + hash.
    let (bytes, hash) = match fetch_and_hash(http, uri).await {
        FetchOutcome::Ok { bytes, sha256 } => (bytes, sha256),
        FetchOutcome::Oversize { observed_bytes } => {
            // Skip the bytes; record the rejection. We don't have a hash —
            // synthesize a stable per-URL placeholder so the cleared/blocked
            // table maintains its content-keyed invariant. We use a SHA-256
            // of the URL itself prefixed with "OVERSIZE:" so collisions
            // with real content are impossible.
            let synthetic = synthetic_hash(uri, "OVERSIZE");
            upsert_icon_moderation(
                pool,
                &IconModerationWrite {
                    content_hash: &synthetic,
                    source_url: uri,
                    state: "blocked",
                    nsfw_score: None,
                    block_reason: Some("oversize"),
                    bytes_size: observed_bytes.min(i32::MAX as usize) as i32,
                },
            )
            .await?;
            link_url_to_hash(pool, uri, &synthetic).await?;
            return Ok(Outcome::BlockedOversize);
        }
        FetchOutcome::NetworkError(err) => {
            mark_icon_fetch_failed(pool, uri, &err).await?;
            return Ok(Outcome::FetchFailed);
        }
    };

    // 2. Dedupe — if this hash has already been decided, just link the URL.
    // Logged at `debug` so a re-run with high dedupe rate doesn't flood the
    // info-level journal — the Summary.deduped counter is the diagnostic.
    if let Some(state) = find_icon_moderation_state(pool, &hash).await? {
        link_url_to_hash(pool, uri, &hash).await?;
        debug!(uri = %uri, prior_state = %state, "dedupe — already decided");
        return Ok(Outcome::Deduped);
    }

    // 3. NSFW gate (Cloudflare CSAM is edge-side; we don't call from here).
    let scores = match safe_search(http, api_key, &bytes).await {
        Ok(s) => s,
        Err(e) => {
            warn!(uri = %uri, error = %e, "vision API error; leaving URL pending for retry");
            return Ok(Outcome::VisionError);
        }
    };
    let score = scores.nsfw_score();
    let outcome = classify_nsfw(score, block_threshold, review_threshold);

    match outcome {
        NsfwOutcome::Block => {
            upsert_icon_moderation(
                pool,
                &IconModerationWrite {
                    content_hash: &hash,
                    source_url: uri,
                    state: "blocked",
                    nsfw_score: Some(score),
                    block_reason: Some("adult"),
                    bytes_size: bytes.len() as i32,
                },
            )
            .await?;
            link_url_to_hash(pool, uri, &hash).await?;
            Ok(Outcome::BlockedAdult)
        }
        NsfwOutcome::Review => {
            upsert_icon_moderation(
                pool,
                &IconModerationWrite {
                    content_hash: &hash,
                    source_url: uri,
                    state: "review",
                    nsfw_score: Some(score),
                    block_reason: None,
                    bytes_size: bytes.len() as i32,
                },
            )
            .await?;
            link_url_to_hash(pool, uri, &hash).await?;
            Ok(Outcome::Review)
        }
        NsfwOutcome::Clear => {
            // 4a. Decode. Failure here is a property of the bytes (corrupt /
            //     wrong format / image-bomb over the alloc cap) — re-trying
            //     won't help. Permanent block.
            let img = match decode_image(&bytes) {
                Ok(i) => i,
                Err(e) => {
                    warn!(uri = %uri, error = %e, "decode failed; marking unsupported");
                    upsert_icon_moderation(
                        pool,
                        &IconModerationWrite {
                            content_hash: &hash,
                            source_url: uri,
                            state: "blocked",
                            nsfw_score: Some(score),
                            block_reason: Some("unsupported_format"),
                            bytes_size: bytes.len() as i32,
                        },
                    )
                    .await?;
                    link_url_to_hash(pool, uri, &hash).await?;
                    return Ok(Outcome::BlockedUnsupported);
                }
            };

            // 4b. Encode to WebP. CPU-bound + sync (the `image` crate has no
            //     async API), so wrap in spawn_blocking to keep the tokio
            //     runtime free for I/O. Failure here is almost always a
            //     transient `image` crate bug; we leave the URL pending so a
            //     future library version can retry — NEVER write a
            //     `state='blocked'` row in this branch.
            let webp = match tokio::task::spawn_blocking(move || encode_to_webp(&img)).await {
                Ok(Ok(b)) => b,
                Ok(Err(e)) => {
                    warn!(uri = %uri, error = %e, "encode failed; URL stays pending for retry");
                    return Ok(Outcome::TranscodeError);
                }
                Err(e) => {
                    // spawn_blocking task panicked — extremely unlikely, but
                    // treat as transient too. Don't write a DB row.
                    warn!(uri = %uri, error = %e, "encode task panicked; URL stays pending");
                    return Ok(Outcome::TranscodeError);
                }
            };

            // 5. Write to /var/lib/tokenstork/icons/<hex_hash>.webp.
            let hex = hex::encode(hash);
            let path = output_dir.join(format!("{}.webp", hex));
            if let Err(e) = std::fs::write(&path, &webp) {
                warn!(uri = %uri, path = %path.display(), error = %e, "write failed");
                return Ok(Outcome::WriteError);
            }

            // 6. Cleared.
            upsert_icon_moderation(
                pool,
                &IconModerationWrite {
                    content_hash: &hash,
                    source_url: uri,
                    state: "cleared",
                    nsfw_score: Some(score),
                    block_reason: None,
                    bytes_size: bytes.len() as i32,
                },
            )
            .await?;
            link_url_to_hash(pool, uri, &hash).await?;
            Ok(Outcome::Cleared)
        }
    }
}

/// Per-URL placeholder hash for cases where we never read the bytes (e.g.,
/// oversize). Prefix collision with real SHA-256 of an image is
/// cryptographically impossible, so this safely shares the
/// `icon_moderation.content_hash` keyspace with real hashes.
fn synthetic_hash(uri: &str, tag: &str) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(tag.as_bytes());
    h.update(b"\0");
    h.update(uri.as_bytes());
    h.finalize().into()
}
