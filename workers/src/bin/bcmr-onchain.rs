//! bcmr-onchain — walk the on-chain CashTokens authchain to derive BCMR
//! metadata directly from the chain (Phase 4c).
//!
//! For each picked category, we follow `vout[0].spentTxId` through BlockBook
//! starting at the category's `genesis_txid`, parse any
//! `OP_RETURN BCMR <hash> <URI>` locator we find, fetch + sha256-verify the
//! pointed-to JSON body, and:
//!   - record one `token_metadata_history` row per locator-bearing hop
//!     (verified or not — operators can audit unverified publications);
//!   - upsert the LATEST verified locator into `token_metadata` with
//!     `bcmr_source='onchain'` (cached body in `bcmr_body JSONB` for the
//!     detail-page rich card);
//!   - or, when no verified locator is found on the chain, mark the row
//!     as walked-empty via [`mark_no_locator_walked`] so the next tick's
//!     batch picker skips it under the priority-2 stale-time gate.
//!
//! There is no fallback. The Paytaca BCMR HTTP-indexer worker (Phase 4b)
//! was retired 2026-05-04; categories whose authchains carry no on-chain
//! BCMR locator render as bare hex on the directory. Legacy
//! `bcmr_source='paytaca' / 'paytaca-missing'` rows on long-running
//! deployments are upgraded to `'onchain'` if the publisher publishes a
//! verifiable locator, or left untouched if they don't.
//!
//! Env vars:
//! - DATABASE_URL                  (required)
//! - BLOCKBOOK_URL                 (required, e.g. http://127.0.0.1:9131)
//! - BLOCKBOOK_MAX_RPS             default 5 (used by BlockbookClient)
//! - BCMR_ONCHAIN_BATCH            default 200
//! - BCMR_ONCHAIN_STALE_HOURS      default 72 (revisit cadence)
//! - BCMR_ONCHAIN_FETCH_TIMEOUT_S  default 10 (per-URI fetch budget)
//! - BCMR_ONCHAIN_MAX_BODY_BYTES   default 8388608 (8 MiB)
//! - BCMR_ONCHAIN_MAX_HOPS         default 15 (walk safety bound; legit authchains are 1-5)
//! - RUST_LOG                      default info

use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow};
use chrono::{TimeZone, Utc};
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

use workers::bcmr::{BcmrFlat, BcmrToken};
use workers::bcmr_events::{
    EventType, VersionFields, authority_moved, authority_moved_severity, diff_detail, field_diff,
    pull_threshold_crossed,
};
use workers::bcmr_onchain::{
    AuthchainHop, BodyArchive, FetchedBody, body_archive, fetch_and_verify_bcmr, walk_authchain,
};
use workers::blockbook::BlockbookClient;
use workers::env::parse_or_default;
use workers::pg::{
    self, BcmrChangeEventWrite, HistoryUpsertOutcome, OnchainBcmrTarget, PgPool,
    TokenMetadataHistoryWrite, TokenMetadataOnchainWrite, bump_pull_epoch, bytes_to_hex,
    ensure_icon_url_scan_row, get_prior_verified_version, insert_bcmr_change_event,
    mark_bcmr_onchain_run, mark_no_locator_walked, pick_bcmr_onchain_batch, pool_from_env,
    pulled_event_exists, recompute_token_bcmr_profile, try_acquire_bcmr_onchain_lock,
    update_token_authchain_head, upsert_token_metadata_history, upsert_token_metadata_onchain,
};
use workers::safe_http::safe_client_builder;

const DEFAULT_BATCH: i32 = 200;
const DEFAULT_STALE_HOURS: i32 = 72;
const DEFAULT_FETCH_TIMEOUT_S: u64 = 10;
const DEFAULT_MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
const DEFAULT_MAX_HOPS: usize = 15;
/// Inline-archive cap for `token_metadata_history.body` / `unverified_body`
/// (watchdog R8). The verifier still needs the full 8 MiB body to hash, but we
/// archive at most this many bytes per version inline — a hostile publisher can
/// rotate the authchain head indefinitely (each new hop is a new keep-once
/// row), so an uncapped per-hop body would be a storage write-amplifier.
/// Bodies above the cap set `body_oversize=true` and leave `body` NULL; the
/// content_hash + publisher URI / our /bcmr/<hash>.json mirror remain the
/// durable pointer.
const INLINE_BODY_CAP: usize = 256 * 1024;
/// Wall-clock hysteresis (seconds) before a verified-then-failing head is
/// declared `version_pulled` (watchdog R1). 24h: long enough that a transient
/// gateway/IPFS outage doesn't cry "rug", short enough that a real pull is
/// surfaced within a day. Overridable via `BCMR_PULLED_WALLCLOCK_S`.
const DEFAULT_PULLED_WALLCLOCK_S: i64 = 24 * 3600;

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

/// Counts of change events newly emitted (after idempotency dedup), by type.
/// Surfaced in the run summary so an operator can spot a `version_pulled` spike
/// (which usually means a BlockBook/gateway incident, not a real mass-rug —
/// cross-check carson health before believing it).
#[derive(Default, Debug, Clone, Copy)]
struct EventCounts {
    new_version: usize,
    version_mismatch: usize,
    version_pulled: usize,
    version_restored: usize,
    authority_moved: usize,
}

impl EventCounts {
    fn add(&mut self, other: EventCounts) {
        self.new_version += other.new_version;
        self.version_mismatch += other.version_mismatch;
        self.version_pulled += other.version_pulled;
        self.version_restored += other.version_restored;
        self.authority_moved += other.authority_moved;
    }
}

#[derive(Default, Debug)]
struct RunStats {
    walked: usize,
    hops_total: usize,
    locators_seen: usize,
    verified: usize,
    /// Hash-verified body, but `serde_json::from_slice` failed to parse it
    /// as a `BcmrToken`. The history row gets `body_verified=true` but the
    /// canonical `token_metadata` row is left at its previous state.
    /// Surfacing this counter lets operators detect systematic body
    /// corruption (e.g. an upstream gateway serving HTML instead of JSON
    /// with the correct content-length).
    verified_but_unparseable: usize,
    mismatched: usize,
    fetch_errors: usize,
    upserts: usize,
    walk_errors: usize,
    skipped_no_locator: usize,
    /// Categories where `walk_authchain` exited at the `BCMR_ONCHAIN_MAX_HOPS`
    /// bound without observing the head. Each hit is a candidate for
    /// "publisher extended their authchain past the indexer" — operator
    /// should bump the env var or investigate a specific category.
    max_hops_hit: usize,
    events: EventCounts,
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let pool = pool_from_env().await.context("connecting to Postgres")?;

    // Run-level mutex (watchdog R4): refuse to start a second concurrent walk.
    // A manual run overlapping the systemd timer would otherwise let two walks
    // race the per-hop `consecutive_fetch_failures` read-modify-write and
    // double-count into a false `version_pulled` alert. Released on pool
    // shutdown at end of run.
    if !try_acquire_bcmr_onchain_lock(&pool).await? {
        info!("another bcmr-onchain run holds the advisory lock; exiting");
        pg::shutdown(pool).await;
        return Ok(());
    }

    let bb = BlockbookClient::from_env().context("building BlockBook client")?;
    let bb = bb.with_slot(pool.clone());

    let batch_size: i32 = parse_or_default("BCMR_ONCHAIN_BATCH", DEFAULT_BATCH);
    let stale_hours: i32 = parse_or_default("BCMR_ONCHAIN_STALE_HOURS", DEFAULT_STALE_HOURS);
    let fetch_timeout_s: u64 =
        parse_or_default("BCMR_ONCHAIN_FETCH_TIMEOUT_S", DEFAULT_FETCH_TIMEOUT_S);
    let max_body_bytes: usize =
        parse_or_default("BCMR_ONCHAIN_MAX_BODY_BYTES", DEFAULT_MAX_BODY_BYTES);
    let max_hops: usize = parse_or_default("BCMR_ONCHAIN_MAX_HOPS", DEFAULT_MAX_HOPS);
    let pulled_wallclock_s: i64 =
        parse_or_default("BCMR_PULLED_WALLCLOCK_S", DEFAULT_PULLED_WALLCLOCK_S);

    // SSRF-safe outbound HTTP client. Same shape as sync-icons:
    //   - SafeResolver drops every DNS answer in private/loopback/link-local
    //     space, re-validates per redirect hop
    //   - keep-alive disabled so a hostile gateway can't replay on the same
    //     TLS session
    //   - 2 redirect hops max
    let http = safe_client_builder(
        "tokenstork-workers/0.1 (+bcmr-onchain)",
        Duration::from_secs(fetch_timeout_s),
        2,
    )
    .build()
    .context("building safe HTTP client")?;

    let batch = pick_bcmr_onchain_batch(&pool, stale_hours, batch_size).await?;

    // Absorb the first-HTTP-after-sqlx truncation bug before the
    // walk loop (walk_authchain calls get_tx, which has no internal
    // warm-up unlike walk_category_utxos).
    bb.warm_up().await.context("BlockBook warm-up")?;
    if batch.is_empty() {
        info!("nothing to walk; exiting");
        mark_bcmr_onchain_run(&pool).await?;
        pg::shutdown(pool).await;
        return Ok(());
    }
    info!(
        n = batch.len(),
        stale_hours, max_hops, max_body_bytes, "walking on-chain BCMR authchains"
    );

    let started = Instant::now();
    let mut stats = RunStats::default();

    for target in &batch {
        match walk_one(
            &pool,
            &bb,
            &http,
            target,
            max_hops,
            max_body_bytes,
            pulled_wallclock_s,
        )
        .await
        {
            Ok(s) => {
                stats.walked += 1;
                stats.hops_total += s.hops_total;
                stats.locators_seen += s.locators_seen;
                stats.verified += s.verified;
                stats.verified_but_unparseable += s.verified_but_unparseable;
                stats.mismatched += s.mismatched;
                stats.fetch_errors += s.fetch_errors;
                stats.upserts += s.upserts;
                stats.events.add(s.events);
                if s.hit_max_hops {
                    stats.max_hops_hit += 1;
                }
                if s.locators_seen == 0 {
                    stats.skipped_no_locator += 1;
                }
            }
            Err(e) => {
                stats.walk_errors += 1;
                error!(
                    category = %bytes_to_hex(&target.category),
                    error = %e,
                    "authchain walk failed"
                );
            }
        }
    }

    mark_bcmr_onchain_run(&pool).await?;
    let elapsed = started.elapsed().as_secs_f64();
    info!(
        total = batch.len(),
        walked = stats.walked,
        hops_total = stats.hops_total,
        locators_seen = stats.locators_seen,
        verified = stats.verified,
        verified_but_unparseable = stats.verified_but_unparseable,
        mismatched = stats.mismatched,
        fetch_errors = stats.fetch_errors,
        upserts = stats.upserts,
        skipped_no_locator = stats.skipped_no_locator,
        max_hops_hit = stats.max_hops_hit,
        walk_errors = stats.walk_errors,
        ev_new_version = stats.events.new_version,
        ev_version_mismatch = stats.events.version_mismatch,
        ev_version_pulled = stats.events.version_pulled,
        ev_version_restored = stats.events.version_restored,
        ev_authority_moved = stats.events.authority_moved,
        elapsed_s = format!("{:.1}", elapsed),
        "bcmr-onchain run complete"
    );

    pg::shutdown(pool).await;
    Ok(())
}

#[derive(Default, Debug)]
struct CategoryStats {
    hops_total: usize,
    locators_seen: usize,
    verified: usize,
    verified_but_unparseable: usize,
    mismatched: usize,
    fetch_errors: usize,
    upserts: usize,
    hit_max_hops: bool,
    events: EventCounts,
}

/// Walk one category's authchain and persist results.
async fn walk_one(
    pool: &pg::PgPool,
    bb: &BlockbookClient,
    http: &reqwest::Client,
    target: &OnchainBcmrTarget,
    max_hops: usize,
    max_body_bytes: usize,
    pulled_wallclock_secs: i64,
) -> Result<CategoryStats> {
    let mut stats = CategoryStats::default();
    let category_hex = bytes_to_hex(&target.category);
    let genesis_arr: [u8; 32] = target
        .genesis_txid
        .as_slice()
        .try_into()
        .with_context(|| {
            format!(
                "genesis_txid for {} is not 32 bytes ({} bytes found)",
                category_hex,
                target.genesis_txid.len()
            )
        })?;

    let outcome = walk_authchain(bb, &genesis_arr, max_hops).await?;
    let hops = outcome.hops;
    stats.hops_total = hops.len();
    stats.hit_max_hops = outcome.hit_max_hops;

    // Cache the current authchain head on the tokens row so the SvelteKit
    // publish-eligibility check (#33) can avoid a per-render authchain
    // walk. Only persist when we found a definitive head (not when
    // hit_max_hops was true — the chain we observed is incomplete and
    // caching the "head" we stopped at would be misleading). Idempotent
    // and best-effort: a failure here is logged but doesn't fail the
    // walk (the BCMR upsert path below is what matters for correctness).
    if !outcome.hit_max_hops
        && let Some(head) = hops.iter().find(|h| h.is_head)
        && let Err(e) = update_token_authchain_head(pool, &target.category, &head.txid).await
    {
        warn!(
            category = %category_hex,
            error = %e,
            "could not cache authchain head; publish-eligibility falls back to cold-start walk"
        );
    }

    // Track best verified hop: highest block_height (None = mempool, treat
    // as latest). Ties: later in iteration order wins (closer to head).
    // Carries the flattened fields (drive name/symbol/etc) AND the raw
    // serde_json::Value (cached as token_metadata.bcmr_body so the detail-page
    // rich card renders without a per-request external HTTP call).
    let mut best_verified: Option<(usize, &AuthchainHop, BcmrFlat, serde_json::Value)> = None;

    for (idx, hop) in hops.iter().enumerate() {
        let Some(locator) = hop.locator.as_ref() else {
            continue;
        };
        stats.locators_seen += 1;

        let outcome = fetch_and_verify_bcmr(http, &locator.uri, &locator.content_hash, max_body_bytes).await;
        let now = Utc::now();
        let block_time = hop.block_time.and_then(|t| Utc.timestamp_opt(t, 0).single());
        let block_height_i32 = hop.block_height.and_then(|h| i32::try_from(h).ok());

        // Per-hop capture (watchdog M1): persist the resolved body + flat fields
        // for EVERY hop, not just the latest verified one. `body` holds a
        // verified canonical body (inline-capped); `unverified_body` holds a
        // sha256-MISMATCH body (the rug-signature payload), kept separate so
        // readers never confuse it for canonical. `flat` drives the stored
        // name/symbol/decimals/icon/description for the version-history diff.
        let mut body_col: Option<serde_json::Value> = None;
        let mut unverified_col: Option<serde_json::Value> = None;
        let mut body_oversize = false;
        let mut flat: Option<BcmrFlat> = None;
        let mut raw_value: Option<serde_json::Value> = None;
        // True only for a genuine sha256 MISMATCH (we fetched bytes that didn't
        // match the on-chain hash) — the deterministic rug signal. A plain fetch
        // ERROR (timeout/404/DNS) is transient infra and must NOT be treated as
        // a critical mismatch on first sight.
        let mut now_mismatch = false;

        let (body_verified, body_size) = match &outcome {
            FetchedBody::Verified { bytes, size } => {
                stats.verified += 1;
                match serde_json::from_slice::<serde_json::Value>(bytes) {
                    Ok(value) => {
                        // Inline-archive cap (R8): keep the hash + size always,
                        // but only archive the body inline when it's small
                        // enough. The full value still feeds token_metadata's
                        // single-row (bounded) bcmr_body cache below.
                        match body_archive(true, *size, INLINE_BODY_CAP) {
                            BodyArchive::VerifiedInline => body_col = Some(value.clone()),
                            BodyArchive::VerifiedOversize => body_oversize = true,
                            BodyArchive::UnverifiedInline | BodyArchive::UnverifiedTooLarge => {}
                        }
                        raw_value = Some(value.clone());
                        match serde_json::from_value::<BcmrToken>(value) {
                            Ok(t) => flat = Some(t.into_flat(&category_hex)),
                            Err(e) => {
                                stats.verified_but_unparseable += 1;
                                warn!(
                                    category = %category_hex,
                                    uri = %locator.uri,
                                    error = %e,
                                    "BCMR body verified by hash but failed to parse as BcmrToken"
                                );
                            }
                        }
                    }
                    Err(e) => {
                        stats.verified_but_unparseable += 1;
                        warn!(
                            category = %category_hex,
                            uri = %locator.uri,
                            error = %e,
                            "BCMR body verified by hash but is not valid JSON"
                        );
                    }
                }
                (true, Some(*size as i32))
            }
            FetchedBody::Mismatch {
                bytes,
                size,
                observed_sha256,
            } => {
                stats.mismatched += 1;
                now_mismatch = true;
                warn!(
                    category = %category_hex,
                    uri = %locator.uri,
                    expected = %hex::encode(locator.content_hash),
                    observed = %hex::encode(observed_sha256),
                    "BCMR body sha256 mismatch — recording history row (unverified_body) but not upserting metadata"
                );
                // Capture the UNTRUSTED body so the M2 version_mismatch event
                // has a payload to diff and the timeline can show what the
                // attacker tried to publish. Best-effort parse; never trusted.
                if let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) {
                    if body_archive(false, *size, INLINE_BODY_CAP) == BodyArchive::UnverifiedInline {
                        unverified_col = Some(value.clone());
                    }
                    if let Ok(t) = serde_json::from_value::<BcmrToken>(value) {
                        flat = Some(t.into_flat(&category_hex));
                    }
                }
                (false, Some(*size as i32))
            }
            FetchedBody::Error(msg) => {
                stats.fetch_errors += 1;
                warn!(
                    category = %category_hex,
                    uri = %locator.uri,
                    error = %msg,
                    "BCMR fetch error — recording history row with body_verified=false"
                );
                (false, None)
            }
        };

        let flat_ref = flat.as_ref();
        let history = TokenMetadataHistoryWrite {
            category: target.category.clone(),
            authchain_tx: hop.txid.to_vec(),
            block_height: block_height_i32,
            block_time,
            content_hash: locator.content_hash.to_vec(),
            publication_uri: locator.uri.clone(),
            body_verified,
            body_size_bytes: body_size,
            fetched_at: Some(now),
            body: body_col,
            unverified_body: unverified_col,
            name: flat_ref.and_then(|f| f.name.clone()),
            symbol: flat_ref.and_then(|f| f.symbol.clone()),
            decimals: flat_ref.map(|f| f.decimals),
            icon_uri: flat_ref.and_then(|f| f.icon_uri.clone()),
            description: flat_ref.and_then(|f| f.description.clone()),
            head_controller_addr: hop.controller_addr.clone(),
            body_oversize,
        };
        // Flat fields of THIS version, for the change-event diff — captured
        // before `flat` is moved into best_verified below.
        let new_fields = flat.as_ref().map(|f| VersionFields {
            name: f.name.clone(),
            symbol: f.symbol.clone(),
            decimals: Some(f.decimals),
            icon_uri: f.icon_uri.clone(),
            description: f.description.clone(),
        });

        let outcome = match upsert_token_metadata_history(pool, &history).await {
            Ok(o) => o,
            Err(e) => {
                error!(
                    category = %category_hex,
                    tx = %hex::encode(hop.txid),
                    error = %e,
                    "failed to upsert token_metadata_history; skipping this hop"
                );
                continue;
            }
        };

        // M2: classify this observation into change events (idempotent). The
        // history row above is the durable record; alerting is best-effort, so
        // a detection error is logged but never fails the walk.
        if let Err(e) = detect_and_emit_events(
            pool,
            &target.category,
            hop,
            &locator.content_hash,
            new_fields.as_ref(),
            body_verified,
            now_mismatch,
            &outcome,
            block_height_i32,
            block_time,
            pulled_wallclock_secs,
            now,
            &mut stats.events,
        )
        .await
        {
            warn!(
                category = %category_hex,
                tx = %hex::encode(hop.txid),
                error = %e,
                "change-event detection failed for hop; continuing"
            );
        }

        if body_verified
            && let (Some(flat_val), Some(value)) = (flat, raw_value)
        {
            best_verified = Some((idx, hop, flat_val, value));
        }
    }

    if let Some((_, hop, flat, body_value)) = best_verified.take() {
        // Seed icon-pipeline queue for the icon URI (idempotent).
        if let Some(uri) = flat.icon_uri.as_deref()
            && let Err(e) = ensure_icon_url_scan_row(pool, uri).await
        {
            error!(
                category = %category_hex,
                uri,
                error = %e,
                "could not seed icon_url_scan row; will re-seed on next bootstrap"
            );
        }
        let revision = hop
            .block_time
            .and_then(|t| Utc.timestamp_opt(t, 0).single())
            .unwrap_or_else(Utc::now);
        let last_locator = hop.locator.as_ref().ok_or_else(|| {
            anyhow!(
                "best_verified hop {} carried no locator — invariant violated",
                hex::encode(hop.txid)
            )
        })?;
        let w = TokenMetadataOnchainWrite {
            category: target.category.clone(),
            name: flat.name,
            symbol: flat.symbol,
            decimals: flat.decimals,
            description: flat.description,
            icon_uri: flat.icon_uri,
            bcmr_publication_uri: last_locator.uri.clone(),
            bcmr_revision: revision,
            bcmr_body: body_value,
        };
        upsert_token_metadata_onchain(pool, &w)
            .await
            .with_context(|| format!("upsert onchain metadata for {}", category_hex))?;
        stats.upserts += 1;
    } else {
        // No verified locator on this category's authchain (or every hop's
        // body failed to fetch / hash-verify). Bump fetched_at via the
        // sentinel helper so the next tick's batch picker sees this row
        // through the priority-2 stale-time gate, not as priority 1 / 2
        // again immediately. Preserves any legacy Paytaca-cached fields
        // on existing rows; inserts an `onchain-empty` row for brand-new
        // categories so they fall out of priority 1 too.
        if let Err(e) = mark_no_locator_walked(pool, &target.category).await {
            error!(
                category = %category_hex,
                error = %e,
                "could not mark no-locator-walked; row will be re-picked next tick"
            );
        }
    }

    // M4: refresh the trust/stability profile for categories that have BCMR
    // history (≥1 locator-bearing hop this walk). Best-effort — a failure here
    // doesn't fail the walk; the next walk recomputes.
    if stats.locators_seen > 0
        && let Err(e) = recompute_token_bcmr_profile(pool, &target.category).await
    {
        warn!(category = %category_hex, error = %e, "failed to recompute bcmr profile");
    }

    // NOTE: max_hops_hit is intentionally a STAT only (counted in the run
    // summary via `stats.hit_max_hops` → RunStats.max_hops_hit), NOT a change
    // event. In production ~40% of categories hit the hop bound (long or
    // mis-resolved authchains — a pre-existing walker characteristic), so
    // emitting one event per category would flood the operator webhook with
    // low-signal warnings and bury the criticals (version_pulled /
    // version_mismatch). The EventType::MaxHopsHit variant + schema check value
    // are kept for the run-summary stat and a possible future opt-in.

    Ok(stats)
}

/// Classify one walker observation of a locator-bearing hop into change events
/// and append them, idempotently. The history archive is the durable record;
/// alerting is best-effort, so the caller treats an error here as non-fatal.
///
/// Event rules (watchdog M2):
/// - A freshly-seen VERIFIED hop whose content_hash differs from the prior
///   verified version → `new_version` (info), with a field diff.
/// - A freshly-seen UNVERIFIED hop (hash mismatch / unfetchable) → the rug
///   signature `version_mismatch` (critical). First-ever versions are archived
///   silently (no prior to change from) unless they're unverifiable.
/// - The controlling authority moved between versions → `authority_moved`
///   (critical if it coincides with a content change, else warning).
/// - The current head, previously verified, has been failing past the
///   wall-clock threshold → `version_pulled` (critical), one per pull epoch.
/// - A head re-verifying after an alerted pull → `version_restored` (info),
///   then the epoch advances so a re-pull is a fresh alert.
#[allow(clippy::too_many_arguments)]
async fn detect_and_emit_events(
    pool: &PgPool,
    category: &[u8],
    hop: &AuthchainHop,
    new_content_hash: &[u8],
    new_fields: Option<&VersionFields>,
    now_verified: bool,
    now_mismatch: bool,
    outcome: &HistoryUpsertOutcome,
    block_height: Option<i32>,
    block_time: Option<chrono::DateTime<Utc>>,
    pulled_wallclock_secs: i64,
    now: chrono::DateTime<Utc>,
    counts: &mut EventCounts,
) -> Result<()> {
    let authchain_tx = hop.txid.to_vec();
    let new_addr = hop.controller_addr.clone();

    // ── New-hop events: first observation of this authchain_tx ───────────────
    if outcome.inserted {
        let prior = get_prior_verified_version(pool, category, &authchain_tx).await?;

        if now_verified {
            // Only a genuine change relative to a PRIOR verified version is an
            // alert. The first-ever version is archived silently (it changes
            // nothing) — this also avoids a backfill event storm on first walk.
            if let Some(p) = prior.as_ref() {
                let hash_changed = p.content_hash.as_slice() != new_content_hash;
                if hash_changed {
                    let detail = new_fields.map(|nf| diff_detail(&field_diff(&p.fields, nf)));
                    let ev = BcmrChangeEventWrite {
                        category: category.to_vec(),
                        authchain_tx: authchain_tx.clone(),
                        event_type: EventType::NewVersion.as_str(),
                        severity: EventType::NewVersion.default_severity().as_str(),
                        prev_content_hash: Some(p.content_hash.clone()),
                        new_content_hash: Some(new_content_hash.to_vec()),
                        prev_addr: p.controller_addr.clone(),
                        new_addr: new_addr.clone(),
                        detail,
                        block_height,
                        block_time,
                        pull_epoch: None,
                    };
                    if insert_bcmr_change_event(pool, &ev).await? {
                        counts.new_version += 1;
                    }
                }
                // Authority handoff between versions — critical if it lands with
                // a content change (the classic compromise pattern), else a
                // standalone warning (authNFT moved wallets, same metadata).
                if authority_moved(p.controller_addr.as_deref(), new_addr.as_deref()) {
                    let ev = BcmrChangeEventWrite {
                        category: category.to_vec(),
                        authchain_tx: authchain_tx.clone(),
                        event_type: EventType::AuthorityMoved.as_str(),
                        severity: authority_moved_severity(hash_changed).as_str(),
                        prev_content_hash: Some(p.content_hash.clone()),
                        new_content_hash: Some(new_content_hash.to_vec()),
                        prev_addr: p.controller_addr.clone(),
                        new_addr: new_addr.clone(),
                        detail: None,
                        block_height,
                        block_time,
                        pull_epoch: None,
                    };
                    if insert_bcmr_change_event(pool, &ev).await? {
                        counts.authority_moved += 1;
                    }
                }
            }
        } else if now_mismatch {
            // A freshly-seen publication whose body did NOT match its on-chain
            // hash — the deterministic rug signature (the served body differs
            // from what was committed). Worth a critical even with no prior. A
            // plain fetch ERROR (transient infra) is deliberately NOT alerted
            // here: it's archived and re-tried, and if it persists the trust
            // profile surfaces it as a "no verified publication" badge.
            let prev_hash = prior.as_ref().map(|p| p.content_hash.clone());
            let prev_addr = prior.as_ref().and_then(|p| p.controller_addr.clone());
            let detail = new_fields.map(|nf| {
                serde_json::json!({
                    "claimed": {
                        "name": nf.name,
                        "symbol": nf.symbol,
                        "icon_uri": nf.icon_uri,
                    }
                })
            });
            let ev = BcmrChangeEventWrite {
                category: category.to_vec(),
                authchain_tx: authchain_tx.clone(),
                event_type: EventType::VersionMismatch.as_str(),
                severity: EventType::VersionMismatch.default_severity().as_str(),
                prev_content_hash: prev_hash,
                new_content_hash: Some(new_content_hash.to_vec()),
                prev_addr,
                new_addr: new_addr.clone(),
                detail,
                block_height,
                block_time,
                pull_epoch: None,
            };
            if insert_bcmr_change_event(pool, &ev).await? {
                counts.version_mismatch += 1;
            }
        }
    }

    // ── Head pull / restore: state of the CURRENT head over time ─────────────
    // Only the live head matters — an old, spent hop's URL going dead is normal
    // link rot (its body is already archived), not a rug.
    if hop.is_head {
        let age_secs = outcome.last_verified_at.map(|lv| (now - lv).num_seconds());
        if pull_threshold_crossed(now_verified, age_secs, pulled_wallclock_secs) {
            let ev = BcmrChangeEventWrite {
                category: category.to_vec(),
                authchain_tx: authchain_tx.clone(),
                event_type: EventType::VersionPulled.as_str(),
                severity: EventType::VersionPulled.default_severity().as_str(),
                prev_content_hash: None,
                new_content_hash: Some(new_content_hash.to_vec()),
                prev_addr: None,
                new_addr: new_addr.clone(),
                detail: Some(serde_json::json!({
                    "consecutive_fetch_failures": outcome.consecutive_fetch_failures,
                    "pulled_wallclock_secs": pulled_wallclock_secs,
                })),
                block_height,
                block_time,
                pull_epoch: Some(outcome.pull_epoch),
            };
            if insert_bcmr_change_event(pool, &ev).await? {
                counts.version_pulled += 1;
            }
        } else if now_verified && outcome.prev_body_verified == Some(false) {
            // Head re-verified after a failure — a genuine RESTORE only if a
            // pull was actually alerted for this epoch (else it was a
            // sub-threshold blip nobody was paged about).
            if pulled_event_exists(pool, category, &authchain_tx, outcome.pull_epoch).await? {
                let ev = BcmrChangeEventWrite {
                    category: category.to_vec(),
                    authchain_tx: authchain_tx.clone(),
                    event_type: EventType::VersionRestored.as_str(),
                    severity: EventType::VersionRestored.default_severity().as_str(),
                    prev_content_hash: None,
                    new_content_hash: Some(new_content_hash.to_vec()),
                    prev_addr: None,
                    new_addr,
                    detail: None,
                    block_height,
                    block_time,
                    pull_epoch: Some(outcome.pull_epoch),
                };
                if insert_bcmr_change_event(pool, &ev).await? {
                    counts.version_restored += 1;
                }
                // Advance the epoch so a subsequent pull is a fresh crossing.
                bump_pull_epoch(pool, category, &authchain_tx).await?;
            }
        }
    }

    Ok(())
}
