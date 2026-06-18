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

use workers::bcmr::BcmrToken;
use workers::bcmr_onchain::{AuthchainHop, FetchedBody, fetch_and_verify_bcmr, walk_authchain};
use workers::blockbook::BlockbookClient;
use workers::env::parse_or_default;
use workers::pg::{
    self, OnchainBcmrTarget, TokenMetadataHistoryWrite, TokenMetadataOnchainWrite,
    bytes_to_hex, ensure_icon_url_scan_row, mark_bcmr_onchain_run, mark_no_locator_walked,
    pick_bcmr_onchain_batch, pool_from_env, update_token_authchain_head,
    upsert_token_metadata_history, upsert_token_metadata_onchain,
};
use workers::safe_http::safe_client_builder;

const DEFAULT_BATCH: i32 = 200;
const DEFAULT_STALE_HOURS: i32 = 72;
const DEFAULT_FETCH_TIMEOUT_S: u64 = 10;
const DEFAULT_MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
const DEFAULT_MAX_HOPS: usize = 15;

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
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
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let pool = pool_from_env().await.context("connecting to Postgres")?;
    let bb = BlockbookClient::from_env().context("building BlockBook client")?;
    let bb = bb.with_slot(pool.clone());

    let batch_size: i32 = parse_or_default("BCMR_ONCHAIN_BATCH", DEFAULT_BATCH);
    let stale_hours: i32 = parse_or_default("BCMR_ONCHAIN_STALE_HOURS", DEFAULT_STALE_HOURS);
    let fetch_timeout_s: u64 =
        parse_or_default("BCMR_ONCHAIN_FETCH_TIMEOUT_S", DEFAULT_FETCH_TIMEOUT_S);
    let max_body_bytes: usize =
        parse_or_default("BCMR_ONCHAIN_MAX_BODY_BYTES", DEFAULT_MAX_BODY_BYTES);
    let max_hops: usize = parse_or_default("BCMR_ONCHAIN_MAX_HOPS", DEFAULT_MAX_HOPS);

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
        match walk_one(&pool, &bb, &http, target, max_hops, max_body_bytes).await {
            Ok(s) => {
                stats.walked += 1;
                stats.hops_total += s.hops_total;
                stats.locators_seen += s.locators_seen;
                stats.verified += s.verified;
                stats.verified_but_unparseable += s.verified_but_unparseable;
                stats.mismatched += s.mismatched;
                stats.fetch_errors += s.fetch_errors;
                stats.upserts += s.upserts;
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
}

/// Walk one category's authchain and persist results.
async fn walk_one(
    pool: &pg::PgPool,
    bb: &BlockbookClient,
    http: &reqwest::Client,
    target: &OnchainBcmrTarget,
    max_hops: usize,
    max_body_bytes: usize,
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
    // Carries the typed BcmrToken (drives flat fields like name/symbol) AND
    // the raw serde_json::Value (cached as token_metadata.bcmr_body so the
    // detail-page rich card renders without a per-request external HTTP
    // call to the publisher's URI).
    let mut best_verified: Option<(usize, &AuthchainHop, BcmrToken, serde_json::Value)> = None;

    for (idx, hop) in hops.iter().enumerate() {
        let Some(locator) = hop.locator.as_ref() else {
            continue;
        };
        stats.locators_seen += 1;

        let outcome = fetch_and_verify_bcmr(http, &locator.uri, &locator.content_hash, max_body_bytes).await;
        let now = Utc::now();
        let block_time = hop.block_time.and_then(|t| Utc.timestamp_opt(t, 0).single());
        let block_height_i32 = hop.block_height.and_then(|h| i32::try_from(h).ok());

        let (body_verified, body_size, parsed) = match &outcome {
            FetchedBody::Verified { bytes, size } => {
                stats.verified += 1;
                // Parse to Value first (untyped); from_value to BcmrToken
                // separately. The Value is cached as bcmr_body for the UI
                // even when the typed parse fails (a malformed-but-hash-
                // verified body still represents an authentic publication
                // intent we can show as raw JSON).
                let parsed: Option<(BcmrToken, serde_json::Value)> =
                    match serde_json::from_slice::<serde_json::Value>(bytes) {
                        Ok(value) => {
                            match serde_json::from_value::<BcmrToken>(value.clone()) {
                                Ok(t) => Some((t, value)),
                                Err(e) => {
                                    stats.verified_but_unparseable += 1;
                                    warn!(
                                        category = %category_hex,
                                        uri = %locator.uri,
                                        error = %e,
                                        "BCMR body verified by hash but failed to parse as BcmrToken"
                                    );
                                    None
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
                            None
                        }
                    };
                (true, Some(*size as i32), parsed)
            }
            FetchedBody::Mismatch {
                size,
                observed_sha256,
                ..
            } => {
                stats.mismatched += 1;
                warn!(
                    category = %category_hex,
                    uri = %locator.uri,
                    expected = %hex::encode(locator.content_hash),
                    observed = %hex::encode(observed_sha256),
                    "BCMR body sha256 mismatch — recording history row but not upserting metadata"
                );
                (false, Some(*size as i32), None)
            }
            FetchedBody::Error(msg) => {
                stats.fetch_errors += 1;
                warn!(
                    category = %category_hex,
                    uri = %locator.uri,
                    error = %msg,
                    "BCMR fetch error — recording history row with body_verified=false"
                );
                (false, None, None)
            }
        };

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
        };
        if let Err(e) = upsert_token_metadata_history(pool, &history).await {
            error!(
                category = %category_hex,
                tx = %hex::encode(hop.txid),
                error = %e,
                "failed to upsert token_metadata_history; skipping this hop"
            );
            continue;
        }

        if body_verified
            && let Some((token, value)) = parsed
        {
            best_verified = Some((idx, hop, token, value));
        }
    }

    if let Some((_, hop, token, body_value)) = best_verified.take() {
        let flat = token.into_flat(&category_hex);
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

    Ok(stats)
}
