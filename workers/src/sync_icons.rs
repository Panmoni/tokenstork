//! Per-URL icon-pipeline orchestrator. Shared between the bootstrap
//! binary (`bin/sync-icons-backfill`) and the periodic worker
//! (`bin/sync-icons`) so the two can never drift on default-deny rules,
//! state-machine transitions, or Vision-spend semantics.
//!
//! Plan reference: docs/icon-safety-plan.md (Phase A step 5 + step 10).
//! Mirrors the `tapswap_walker` factoring pattern — one shared
//! per-row routine, two thin binary wrappers around it.

use std::path::Path;

use anyhow::Result;
use sha2::{Digest, Sha256};
use tracing::{debug, warn};

use crate::google_vision::safe_search;
use crate::icons::{
    decode_via_subprocess, fetch_and_hash, classify_nsfw, FetchOutcome, NsfwOutcome,
};
use crate::pg::{
    IconModerationWrite, PgPool, find_icon_moderation_state, link_url_to_hash,
    mark_icon_fetch_failed, select_rows_needing_provenance, set_icon_provenance,
    upsert_icon_moderation,
};

/// Per-URL pipeline outcome. Surfaced as a discriminated tag so the
/// caller can summarise across a batch run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Cleared,
    BlockedAdult,
    Review,
    BlockedOversize,
    /// Decoded as a non-image / corrupt bytes / unsupported format.
    /// Permanent `state='blocked' reason='unsupported_format'` —
    /// re-trying won't help.
    BlockedUnsupported,
    Deduped,
    FetchFailed,
    VisionError,
    /// Encode-side transcode failure on a SUCCESSFULLY-decoded image.
    /// Almost always a transient `image` crate bug; URL stays pending so
    /// a future library version can retry.
    TranscodeError,
    WriteError,
}

/// Process one icon URL end-to-end. Default-deny on every error path:
/// only writes `state='cleared'` when bytes pass every gate AND the
/// transcoded WebP makes it to disk.
///
/// Cloudflare's CSAM Scanning Tool runs at the edge when the cleared
/// WebP is later served — we never call out from here for CSAM. The
/// cascade-on-CSAM flow lives in the operator runbook (manual today,
/// future webhook automation).
///
/// `api_key = None` means Vision is disabled (e.g. cost cutoff). In
/// that mode every newly-decoded icon is routed to `state='review'`
/// with the WebP written to disk so an operator can inspect the file
/// before flipping the row to `cleared` or `blocked`. Default-deny
/// still holds — `iconHrefFor` only serves `state='cleared'` rows.
pub async fn process_url(
    pool: &PgPool,
    http: &reqwest::Client,
    api_key: Option<&str>,
    output_dir: &Path,
    uri: &str,
    block_threshold: f32,
    review_threshold: f32,
) -> Result<Outcome> {
    // 1. Fetch + hash.
    let (bytes, hash) = match fetch_and_hash(http, uri).await {
        FetchOutcome::Ok { bytes, sha256 } => (bytes, sha256),
        FetchOutcome::Oversize { observed_bytes } => {
            // We don't have a hash because we never read the bytes.
            // Synthesise a stable per-URL placeholder so the
            // content-keyed `icon_moderation` table maintains its
            // invariant. SHA-256 of "OVERSIZE\0" || uri can't collide
            // with a real image hash by preimage resistance.
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
                    source_format: None,
                    source_width: None,
                    source_height: None,
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

    // 2. Dedupe — if this hash has already been decided, just link the
    // URL row. Logged at `debug` so a re-run with high dedupe rate
    // doesn't flood the info-level journal.
    if let Some(state) = find_icon_moderation_state(pool, &hash).await? {
        link_url_to_hash(pool, uri, &hash).await?;
        debug!(uri = %uri, prior_state = %state, "dedupe — already decided");
        return Ok(Outcome::Deduped);
    }

    // 3. Decode + encode inside a memory-capped subprocess. The subprocess
    // is forked with prlimit(RLIMIT_AS, 512 MiB) so a pathological input
    // that survives the header probe triggers OOM *in the child* (SIGKILL
    // from the OOM killer) rather than an uncatchable SIGABRT in the
    // parent worker. Subprocess isolation means the decode + encode are
    // both done in the child; the parent receives WebP bytes + vision PNG
    // bytes + dimensions through a pipe, or an OOM signal if the child
    // was killed without writing.
    //
    // SVG note: `decode_image` rasterizes parseable SVG to PNG and
    // returns it via `vision_bytes`, so the Vision call below can use
    // the raster — Vision rejects the SVG XML directly.
    let sub_result = decode_via_subprocess(&bytes);
    let (webp_bytes, vision_bytes, source_format, source_width, source_height) =
        match sub_result {
            Ok(r) => {
                (r.webp_bytes, r.vision_bytes, r.source_format, r.width as i32, r.height as i32)
            }
            // SubprocessOom is a zero-sized unit struct. In practice the Err
            // variant of decode_via_subprocess is always SubprocessOom
            // (OOM kill → pipe break; decode error → status byte 0x00 path
            // exits cleanly). The Err arm handles any error from the
            // subprocess gracefully: leave the URL pending so retry backoff
            // applies rather than permanently blocking the icon.
            Err(_) => {
                warn!(uri = %uri, "decode subprocess failed; URL stays pending for retry");
                return Ok(Outcome::TranscodeError);
            }
        };

    // 4. NSFW gate (or manual-review bypass when Vision is disabled).
    // For raster inputs we send the original bytes (saves a re-encode
    // round-trip); for SVG we send the rasterized PNG that the subprocess
    // produced.
    let (outcome, score) = match api_key {
        Some(key) => {
            let vision_input: &[u8] = vision_bytes.as_deref().unwrap_or(&bytes);
            match safe_search(http, key, vision_input).await {
                Ok(s) => {
                    let score = s.nsfw_score();
                    (classify_nsfw(score, block_threshold, review_threshold), Some(score))
                }
                Err(e) => {
                    warn!(uri = %uri, error = %e, "vision API error; leaving URL pending for retry");
                    return Ok(Outcome::VisionError);
                }
            }
        }
        None => (NsfwOutcome::Review, None),
    };

    match outcome {
        NsfwOutcome::Block => {
            // No WebP on disk — blocked icons are never served.
            upsert_icon_moderation(
                pool,
                &IconModerationWrite {
                    content_hash: &hash,
                    source_url: uri,
                    state: "blocked",
                    nsfw_score: score,
                    block_reason: Some("adult"),
                    bytes_size: bytes.len() as i32,
                    source_format: Some(&source_format),
                    source_width: Some(source_width),
                    source_height: Some(source_height),
                },
            )
            .await?;
            link_url_to_hash(pool, uri, &hash).await?;
            Ok(Outcome::BlockedAdult)
        }
        // Review and Clear share the write path so the WebP is on disk in
        // both cases — the operator can inspect a review-state file before
        // flipping it to `cleared`. Default-deny still holds:
        // `iconHrefFor` only serves `state='cleared'`.
        //
        // The WebP bytes are already transcoded from the decode subprocess,
        // so no additional spawn_blocking is needed here.
        NsfwOutcome::Review | NsfwOutcome::Clear => {
            let hex = hex::encode(hash);
            let path = output_dir.join(format!("{}.webp", hex));
            if let Err(e) = std::fs::write(&path, &webp_bytes) {
                warn!(uri = %uri, path = %path.display(), error = %e, "write failed");
                return Ok(Outcome::WriteError);
            }

            let is_review = matches!(outcome, NsfwOutcome::Review);
            upsert_icon_moderation(
                pool,
                &IconModerationWrite {
                    content_hash: &hash,
                    source_url: uri,
                    state: if is_review { "review" } else { "cleared" },
                    nsfw_score: score,
                    block_reason: None,
                    bytes_size: bytes.len() as i32,
                    source_format: Some(&source_format),
                    source_width: Some(source_width),
                    source_height: Some(source_height),
                },
            )
            .await?;
            link_url_to_hash(pool, uri, &hash).await?;
            Ok(if is_review { Outcome::Review } else { Outcome::Cleared })
        }
    }
}

/// Reflag — re-derive + record source provenance (format + native
/// dimensions) for already-decided icons that predate provenance tracking,
/// IN PLACE. Re-fetches each source, decodes it to read the geometry, and
/// fills the moderation row's `source_*` columns WITHOUT re-deciding — a
/// `cleared` icon stays cleared (it is NOT pushed back through the
/// review/clear state machine). Bounded to icons decided within
/// `max_age_hours` so it touches the recent gap, never the legacy corpus.
/// Returns `(updated, skipped)`.
pub async fn backfill_provenance(
    pool: &PgPool,
    http: &reqwest::Client,
    max_age_hours: i64,
) -> Result<(usize, usize)> {
    let rows = select_rows_needing_provenance(pool, max_age_hours).await?;
    let mut updated = 0usize;
    let mut skipped = 0usize;

    for (hash, uri) in &rows {
        // Re-fetch the source. Only attribute provenance derived from the
        // SAME bytes this row was decided on — if the source drifted, skip
        // rather than record a different image's geometry.
        let bytes = match fetch_and_hash(http, uri).await {
            crate::icons::FetchOutcome::Ok { bytes, sha256 } => {
                if sha256.as_slice() != hash.as_slice() {
                    warn!(uri = %uri, "reflag: source drifted from stored hash; skipping");
                    skipped += 1;
                    continue;
                }
                bytes
            }
            _ => {
                skipped += 1;
                continue;
            }
        };

        // Decode (header-guarded) to read source format + native dimensions.
        // Use subprocess isolation — backfill processes potentially hostile
        // icons from the legacy corpus; an OOM kill should skip, not crash.
        let decoded = match decode_via_subprocess(&bytes) {
            Ok(r) => r,
            Err(_) => {
                warn!(uri = %uri, "reflag: decode subprocess failed; skipping");
                skipped += 1;
                continue;
            }
        };

        if set_icon_provenance(pool, hash, &decoded.source_format, decoded.width as i32, decoded.height as i32).await? {
            updated += 1;
        } else {
            skipped += 1;
        }
        tokio::time::sleep(std::time::Duration::from_millis(35)).await;
    }
    Ok((updated, skipped))
}

/// Per-URL placeholder hash for cases where we never read the bytes
/// (e.g., oversize). Prefix collision with real SHA-256 of an image is
/// cryptographically impossible, so this safely shares the
/// `icon_moderation.content_hash` keyspace with real hashes.
pub fn synthetic_hash(uri: &str, tag: &str) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(tag.as_bytes());
    h.update(b"\0");
    h.update(uri.as_bytes());
    h.finalize().into()
}

/// Phase D — periodic re-scan outcome. Surfaced separately from
/// [`Outcome`] because the rescan loop's failure modes are different:
/// it never produces NSFW / cleared / blocked decisions (those are made
/// by the pending pipeline, possibly on a future tick), only "bytes
/// matched" / "bytes drifted" / "fetch failed".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RescanOutcome {
    /// Hash matched the stored value. Timestamp bumped; URL drops to
    /// the back of the rescan rotation.
    Unchanged,
    /// Hash differs from the stored value. URL flipped back to pending
    /// (`content_hash = NULL`) so the next periodic-pending tick
    /// scans the new bytes from scratch via [`process_url`]. The OLD
    /// hash's `icon_moderation` decision and on-disk WebP are
    /// preserved — other URIs may still legitimately point at them.
    Drifted,
    /// Network / HTTP failure or oversize. URL stays scanned (we still
    /// have a valid prior hash); operator alerts off `db_errors` /
    /// `fetch_failed` aggregates.
    FetchFailed,
}

/// Phase D — re-scan one previously-scanned URL. See [`RescanOutcome`].
pub async fn rescan_url(
    pool: &PgPool,
    http: &reqwest::Client,
    uri: &str,
    expected_hash: &[u8; 32],
) -> Result<RescanOutcome> {
    use crate::icons::FetchOutcome;
    use crate::pg::{flip_icon_url_to_pending, mark_icon_fetch_failed, touch_icon_url_last_fetched};

    let actual = match fetch_and_hash(http, uri).await {
        FetchOutcome::Ok { sha256, .. } => sha256,
        FetchOutcome::Oversize { observed_bytes } => {
            // The URL used to fit; now it's oversize. Treat as a fetch
            // failure for rescan purposes — record it but don't drop the
            // existing decision. Operator could investigate from the
            // fetch_error column if it persists.
            mark_icon_fetch_failed(
                pool,
                uri,
                &format!("rescan: now oversize at {} bytes", observed_bytes),
            )
            .await?;
            return Ok(RescanOutcome::FetchFailed);
        }
        FetchOutcome::NetworkError(err) => {
            mark_icon_fetch_failed(pool, uri, &format!("rescan: {}", err)).await?;
            return Ok(RescanOutcome::FetchFailed);
        }
    };

    if &actual == expected_hash {
        touch_icon_url_last_fetched(pool, uri).await?;
        Ok(RescanOutcome::Unchanged)
    } else {
        // Bytes drifted. WARN-log so the audit trail captures the
        // event; operator can chase it down via journalctl. Do NOT
        // surface the hash mismatch payload at info level — it's
        // signal that someone is messing with content under a stable
        // URL, which is interesting to attackers who'd notice the
        // chatter.
        tracing::warn!(
            uri,
            old = hex::encode(expected_hash),
            new = hex::encode(actual),
            "rescan: bytes drifted; flipping URL back to pending"
        );
        flip_icon_url_to_pending(pool, uri).await?;
        Ok(RescanOutcome::Drifted)
    }
}
