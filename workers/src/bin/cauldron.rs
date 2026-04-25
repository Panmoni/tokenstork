//! cauldron — scan fungible categories against the Cauldron DEX indexer
//! and refresh `token_venue_listings`. Powers the UI's "Listed on
//! Cauldron" filter and the Price / TVL columns in the grid.
//!
//! Two modes, selected by the `CAULDRON_MODE` env var.
//!
//! **full** (default): walk every FT / FT+NFT category, ~3.4k price
//! queries. Discovers newly-listed tokens + delists tokens that have
//! disappeared. At `CAULDRON_MAX_RPS=5` this takes ~15 min. Triggers
//! pruning — categories not `seen` this run get their
//! `token_venue_listings` row deleted.
//!
//! **fast**: only re-check the ~317 already-listed categories from
//! `token_venue_listings`. ~60 s at the same rate limit. Does NOT
//! prune: we only looked at the listed set, so unseen candidates
//! outside the set aren't confirmed delistings.
//!
//! Typical deployment: `sync-cauldron-fast.timer` fires every 10 min
//! (cheap refresh), `sync-cauldron.timer` fires every 4 h (discovery +
//! prune). The two share this binary; the service unit sets the env var.
//!
//! Env vars:
//! - `CAULDRON_MODE` — default `full`; set to `fast` to limit the scan to already-listed categories.
//! - `CAULDRON_URL` — default `https://indexer.cauldron.quest`.
//! - `CAULDRON_MAX_RPS` — default 5 (public shared indexer, be polite).
//! - `DATABASE_URL`.
//! - `RUST_LOG`.

use std::time::Instant;

use anyhow::{Context, Result};
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

use workers::cauldron::CauldronClient;
use workers::pg::{
    self, VenueListingWrite, bytes_to_hex, insert_price_history_point, mark_cauldron_run,
    pick_cauldron_candidates, pick_cauldron_listed, pool_from_env, prune_stale_venue_listings,
    upsert_venue_listing,
};

const VENUE: &str = "cauldron";

/// CAULDRON_MODE env-var values. `full` is the default so an operator
/// who forgets to set the env still gets correct (if slower) behavior.
enum Mode {
    Full,
    Fast,
}

impl Mode {
    fn from_env() -> Self {
        // Trim first so a stray trailing space in the systemd unit or
        // /etc/tokenstork/env doesn't silently flip us back to Full.
        // Lowercase after trimming for case-insensitive matching.
        match std::env::var("CAULDRON_MODE")
            .ok()
            .as_deref()
            .map(|s| s.trim().to_ascii_lowercase())
            .as_deref()
        {
            Some("fast") => Mode::Fast,
            _ => Mode::Full,
        }
    }

    fn label(&self) -> &'static str {
        match self {
            Mode::Full => "full",
            Mode::Fast => "fast",
        }
    }
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

    let cauldron = CauldronClient::from_env().context("building Cauldron client")?;
    let pool = pool_from_env().await.context("connecting to Postgres")?;

    let mode = Mode::from_env();
    let candidates = match mode {
        Mode::Full => pick_cauldron_candidates(&pool).await?,
        Mode::Fast => pick_cauldron_listed(&pool).await?,
    };

    if candidates.is_empty() {
        info!(mode = mode.label(), "no candidates to scan; exiting");
        mark_cauldron_run(&pool).await?;
        pg::shutdown(pool).await;
        return Ok(());
    }
    info!(
        mode = mode.label(),
        n = candidates.len(),
        "scanning Cauldron candidates"
    );

    let started = Instant::now();
    let mut seen: Vec<Vec<u8>> = Vec::new();
    let mut listed: usize = 0;
    // "Hard" errors gate pruning — a failed price fetch or a failed upsert
    // means we can't trust the `seen` set as the truthful current-listings
    // picture. "Soft" errors (an opportunistic TVL fetch that failed but
    // where we still got and wrote the price) don't block pruning because
    // the `seen` set is still accurate.
    let mut hard_errors: usize = 0;
    let mut soft_errors: usize = 0;

    for category in &candidates {
        let category_hex = bytes_to_hex(category);

        // Step 1: price. 404 means not listed; skip without upsert.
        let price = match cauldron.get_price_sats(&category_hex).await {
            Ok(Some(p)) if p > 0.0 => p,
            Ok(_) => continue,
            Err(e) => {
                hard_errors += 1;
                error!(
                    category = %category_hex,
                    error = %e,
                    "Cauldron price fetch failed"
                );
                continue;
            }
        };

        // Step 2: TVL (opportunistic). If this fails we still upsert the
        // price — a listed token with unknown TVL is more useful than no
        // row at all, and the `seen` set remains truthful.
        let tvl = match cauldron.get_tvl_satoshis(&category_hex).await {
            Ok(t) => t,
            Err(e) => {
                soft_errors += 1;
                warn!(
                    category = %category_hex,
                    error = %e,
                    "Cauldron TVL fetch failed; upserting without it"
                );
                None
            }
        };

        // `pools_total_tvl_sats` mirrors `tvl_satoshis` here. The
        // upstream `/cauldron/valuelocked/<cat>` endpoint returns the
        // BCH-side reserve for the category — we treat it as the
        // canonical figure both for the directory's per-token TVL and
        // for the headline aggregate. `pools_count` is unknown at this
        // layer (no per-category pool-count endpoint exists upstream)
        // so it stays NULL. The full per-pool refactor that would make
        // both columns exact for Cauldron is sketched as "Future:
        // option 3" in docs/cashtoken-index-plan.md.
        let w = VenueListingWrite {
            venue: VENUE,
            category: category.clone(),
            price_sats: Some(price),
            tvl_satoshis: tvl,
            pools_count: None,
            pools_total_tvl_sats: tvl,
        };
        if let Err(e) = upsert_venue_listing(&pool, &w).await {
            hard_errors += 1;
            error!(
                category = %category_hex,
                error = %e,
                "Cauldron upsert failed"
            );
            continue;
        }

        // Append one point to the history time series. Soft-fail: a
        // history write error doesn't invalidate the current-snapshot
        // upsert we just made, so don't block pruning or advance
        // hard_errors. Sparklines just lose one data point for this run.
        if let Err(e) =
            insert_price_history_point(&pool, VENUE, category, price, tvl).await
        {
            soft_errors += 1;
            warn!(
                category = %category_hex,
                error = %e,
                "Cauldron price-history append failed"
            );
        }

        listed += 1;
        seen.push(category.clone());
    }

    // Three guards on pruning:
    //
    // 1. Skip if we're in `fast` mode. `pick_cauldron_listed` only
    //    returned the already-listed set, so "unseen" in `fast` has a
    //    totally different meaning from `full` — we never looked at
    //    the 3k candidates outside the set, so we can't say they're
    //    still unlisted. Full-mode runs are the only ones authorised
    //    to delist.
    //
    // 2. Skip if any hard error occurred. A transient 5xx on a price
    //    fetch means we can't prove the token isn't listed anymore —
    //    don't delete what we didn't confirm.
    //
    // 3. Skip if `seen` is empty. This defends against a total Cauldron
    //    outage that returns 404 for every category: every iteration
    //    `Ok(None) → continue`, no hard errors, but `seen` stays empty.
    //    Without this guard the subsequent DELETE would run with an
    //    empty `keep` array; `category <> ALL(ARRAY[]::bytea[])` is
    //    vacuous-truth TRUE in Postgres and would wipe every row for
    //    this venue. Loud warn so operators notice.
    let pruned = if matches!(mode, Mode::Fast) {
        0
    } else if hard_errors > 0 {
        warn!(
            hard_errors,
            "hard errors during run; skipping delist pruning"
        );
        0
    } else if seen.is_empty() {
        warn!(
            candidates = candidates.len(),
            "no listed tokens found this run; skipping delist pruning (probable Cauldron outage)"
        );
        0
    } else {
        match prune_stale_venue_listings(&pool, VENUE, &seen).await {
            Ok(n) => n,
            Err(e) => {
                error!(error = %e, "prune_stale_venue_listings failed");
                0
            }
        }
    };

    mark_cauldron_run(&pool).await?;
    let elapsed = started.elapsed().as_secs_f64();
    info!(
        mode = mode.label(),
        scanned = candidates.len(),
        listed,
        hard_errors,
        soft_errors,
        pruned,
        elapsed_s = format!("{:.1}", elapsed),
        "cauldron run complete"
    );

    pg::shutdown(pool).await;
    Ok(())
}
