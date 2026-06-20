//! bcmr-otr — pull the OpenTokenRegistry (otr.cash) multi-token BCMR and
//! gap-fill metadata for categories the on-chain authchain walker could not
//! satisfy.
//!
//! OTR is the de-facto community registry of CashToken metadata, curated via
//! GitHub PRs and published as a single BCMR-v2 registry JSON at the
//! well-known URI. Many tokens are listed there without ever publishing an
//! on-chain `OP_RETURN BCMR` locator, so without this worker they render as
//! bare hex on the directory.
//!
//! ## Where OTR sits relative to the on-chain walker
//!
//! The on-chain walker ([crate::bcmr_onchain], `bcmr-onchain` bin) is the
//! canonical, sha256-verified source and writes `bcmr_source='onchain'`. This
//! worker is strictly secondary: it writes `bcmr_source='otr'` via a guarded
//! UPDATE that
//!   - never overwrites a canonical `'onchain'` row,
//!   - never INSERTs (it only augments rows the walker already created —
//!     normally `'onchain-empty'`), and
//!   - never touches `fetched_at` (the walker's stale clock),
//! so OTR can never mask or starve the on-chain path. See
//! [`workers::pg::update_token_metadata_otr`] for the full precedence rationale.
//!
//! For each filled category we also seed the icon pipeline
//! ([`workers::pg::ensure_icon_url_scan_row`]) so OTR icons get fetched,
//! moderated, and served exactly like on-chain ones.
//!
//! Env vars:
//! - DATABASE_URL            (required)
//! - OTR_REGISTRY_URL        default https://otr.cash/.well-known/bitcoin-cash-metadata-registry.json
//! - OTR_FETCH_TIMEOUT_S     default 30 (the registry is a single multi-MB GET)
//! - OTR_MAX_BODY_BYTES      default 33554432 (32 MiB)
//! - RUST_LOG                default info

use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use chrono::{DateTime, Utc};
use serde_json::json;
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

use workers::bcmr::OtrRegistry;
use workers::env::parse_or_default;
use workers::pg::{
    self, TokenMetadataOtrWrite, ensure_icon_url_scan_row, mark_otr_run, pool_from_env,
    update_token_metadata_otr,
};
use workers::safe_http::{read_body_capped, safe_client_builder, validate_url_scheme};

const DEFAULT_OTR_URL: &str = "https://otr.cash/.well-known/bitcoin-cash-metadata-registry.json";
const DEFAULT_FETCH_TIMEOUT_S: u64 = 30;
const DEFAULT_MAX_BODY_BYTES: usize = 32 * 1024 * 1024;

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

#[derive(Default, Debug)]
struct RunStats {
    /// Categories listed in the registry (with a non-empty revision map).
    identities_total: usize,
    /// Registry keys that weren't valid 32-byte category hex — skipped.
    bad_category_hex: usize,
    /// Rows actually filled (UPDATE affected 1 row: an existing non-onchain row).
    updated: usize,
    /// UPDATE affected 0 rows — either no `token_metadata` row yet (walker
    /// hasn't reached the category) or it's already `bcmr_source='onchain'`.
    skipped_unknown_or_onchain: usize,
    /// Icon-pipeline rows seeded for filled categories that carry an icon URI.
    icon_seeded: usize,
    /// DB errors on individual upserts (logged, run continues).
    db_errors: usize,
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let pool = pool_from_env().await.context("connecting to Postgres")?;

    let url = std::env::var("OTR_REGISTRY_URL").unwrap_or_else(|_| DEFAULT_OTR_URL.to_string());
    let fetch_timeout_s: u64 = parse_or_default("OTR_FETCH_TIMEOUT_S", DEFAULT_FETCH_TIMEOUT_S);
    let max_body_bytes: usize = parse_or_default("OTR_MAX_BODY_BYTES", DEFAULT_MAX_BODY_BYTES);

    // SSRF-safe outbound HTTP client — same profile as bcmr-onchain /
    // sync-icons: SafeResolver drops private/loopback/link-local DNS answers
    // and re-validates each redirect hop, keep-alive disabled, 2 redirects max.
    let http = safe_client_builder(
        "tokenstork-workers/0.1 (+bcmr-otr)",
        Duration::from_secs(fetch_timeout_s),
        2,
    )
    .build()
    .context("building safe HTTP client")?;

    let started = Instant::now();
    let mut stats = RunStats::default();

    match sync_otr(&pool, &http, &url, max_body_bytes, &mut stats).await {
        Ok(()) => {}
        Err(e) => {
            // Mark the heartbeat even on failure so a stalled run is visible
            // as `last_otr_run_at` lag rather than silence, then propagate so
            // the unit logs a non-zero exit in journalctl.
            mark_otr_run(&pool).await.ok();
            pg::shutdown(pool).await;
            return Err(e);
        }
    }

    mark_otr_run(&pool).await?;
    let elapsed = started.elapsed().as_secs_f64();
    info!(
        registry = %url,
        identities_total = stats.identities_total,
        updated = stats.updated,
        skipped_unknown_or_onchain = stats.skipped_unknown_or_onchain,
        bad_category_hex = stats.bad_category_hex,
        icon_seeded = stats.icon_seeded,
        db_errors = stats.db_errors,
        elapsed_s = format!("{:.1}", elapsed),
        "bcmr-otr run complete"
    );

    pg::shutdown(pool).await;
    Ok(())
}

/// Fetch the registry, parse it, and gap-fill every category it lists.
async fn sync_otr(
    pool: &pg::PgPool,
    http: &reqwest::Client,
    url: &str,
    max_body_bytes: usize,
    stats: &mut RunStats,
) -> Result<()> {
    // Scheme gate (https/ipfs only); the SafeResolver in the client enforces
    // the IP allowlist on connect + redirect.
    validate_url_scheme(url, false).with_context(|| format!("OTR registry URL refused: {}", url))?;

    let resp = http
        .get(url)
        .send()
        .await
        .with_context(|| format!("fetching OTR registry {}", url))?;
    if !resp.status().is_success() {
        bail!("OTR registry {} returned HTTP {}", url, resp.status().as_u16());
    }
    if let Some(cl) = resp.content_length()
        && cl > max_body_bytes as u64
    {
        bail!(
            "OTR registry content-length {} exceeds cap {}",
            cl,
            max_body_bytes
        );
    }
    let bytes = read_body_capped(resp, max_body_bytes)
        .await
        .context("reading OTR registry body")?;

    // Parse once as untyped Value (for per-category bcmr_body slicing) and
    // once as the typed registry (for flattened columns). Both views share
    // the same bytes.
    let raw: serde_json::Value =
        serde_json::from_slice(&bytes).context("OTR registry is not valid JSON")?;
    let registry: OtrRegistry =
        serde_json::from_value(raw.clone()).context("OTR registry has unexpected shape")?;

    info!(
        registry = %url,
        size_bytes = bytes.len(),
        identities = registry.identities.len(),
        "fetched OTR registry; gap-filling"
    );

    for (cat_hex, meta) in registry.iter_categories() {
        stats.identities_total += 1;

        let category = match hex::decode(cat_hex) {
            Ok(b) if b.len() == 32 => b,
            _ => {
                stats.bad_category_hex += 1;
                warn!(key = %cat_hex, "OTR identity key is not 32-byte category hex; skipping");
                continue;
            }
        };

        let revision: Option<DateTime<Utc>> = DateTime::parse_from_rfc3339(&meta.revision)
            .ok()
            .map(|dt| dt.with_timezone(&Utc));

        // Minimal BCMR-v2 envelope sliced from the registry so the detail-page
        // `bcmrFromBody(body, categoryHex)` resolves `identities[cat][newest]`
        // the same way it does for the on-chain `bcmr_body`. No top-level
        // `latestRevision`: the registry's own is the registry entity's, not
        // this token's — bcmrFromBody falls back to max-by-key, matching how
        // we picked `meta` here.
        let revmap = raw
            .get("identities")
            .and_then(|i| i.get(cat_hex))
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        // Build the inner `{ <cat_hex>: <revmap> }` object explicitly — the
        // key is dynamic, so a Map keeps it unambiguous (no reliance on
        // json! macro key-expression parsing).
        let mut identities = serde_json::Map::new();
        identities.insert(cat_hex.to_string(), revmap);
        let bcmr_body = json!({ "identities": serde_json::Value::Object(identities) });

        let w = TokenMetadataOtrWrite {
            category,
            name: meta.flat.name.clone(),
            symbol: meta.flat.symbol.clone(),
            decimals: meta.flat.decimals,
            description: meta.flat.description.clone(),
            icon_uri: meta.flat.icon_uri.clone(),
            bcmr_revision: revision,
            bcmr_body,
        };

        match update_token_metadata_otr(pool, &w).await {
            Ok(0) => stats.skipped_unknown_or_onchain += 1,
            Ok(_) => {
                stats.updated += 1;
                // Seed the icon pipeline for this category's icon (idempotent).
                if let Some(uri) = w.icon_uri.as_deref() {
                    match ensure_icon_url_scan_row(pool, uri).await {
                        Ok(()) => stats.icon_seeded += 1,
                        Err(e) => {
                            stats.db_errors += 1;
                            error!(
                                category = %cat_hex,
                                uri,
                                error = %e,
                                "could not seed icon_url_scan row for OTR icon"
                            );
                        }
                    }
                }
            }
            Err(e) => {
                stats.db_errors += 1;
                error!(category = %cat_hex, error = %e, "OTR metadata update failed");
            }
        }
    }

    Ok(())
}
