//! cauldron — scan every fungible category against the Cauldron DEX
//! indexer and refresh `token_venue_listings`. Powers the UI's
//! "Listed on Cauldron" filter and the Price / TVL columns in the grid.
//!
//! Runs on `sync-cauldron.timer` every 4 h. Fast path: ~3.4k FT / FT+NFT
//! rows × 1 price query each at 5 req/s = ~11 min. Slow path hits TVL
//! *only* for tokens that are actually listed (200 on price), so the
//! worst case with a lot of listed tokens is ~23 min per run.
//!
//! Env vars:
//! - `CAULDRON_URL`     default `https://indexer.cauldron.quest`
//! - `CAULDRON_MAX_RPS` default 5 (public shared indexer — be polite)
//! - `DATABASE_URL`
//! - `RUST_LOG`

use std::time::Instant;

use anyhow::{Context, Result};
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

use workers::cauldron::CauldronClient;
use workers::pg::{
    self, VenueListingWrite, bytes_to_hex, mark_cauldron_run, pick_cauldron_candidates,
    pool_from_env, prune_stale_venue_listings, upsert_venue_listing,
};

const VENUE: &str = "cauldron";

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

    let candidates = pick_cauldron_candidates(&pool).await?;
    if candidates.is_empty() {
        info!("no FT / FT+NFT categories to scan; exiting");
        mark_cauldron_run(&pool).await?;
        pg::shutdown(pool).await;
        return Ok(());
    }
    info!(n = candidates.len(), "scanning fungible categories against Cauldron");

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

        let w = VenueListingWrite {
            venue: VENUE,
            category: category.clone(),
            price_sats: Some(price),
            tvl_satoshis: tvl,
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

        listed += 1;
        seen.push(category.clone());
    }

    // Two guards on pruning:
    //
    // 1. Skip if any hard error occurred. A transient 5xx on a price
    //    fetch means we can't prove the token isn't listed anymore —
    //    don't delete what we didn't confirm.
    //
    // 2. Skip if `seen` is empty. This defends against a total Cauldron
    //    outage that returns 404 for every category: every iteration
    //    `Ok(None) → continue`, no hard errors, but `seen` stays empty.
    //    Without this guard the subsequent DELETE would run with an
    //    empty `keep` array; `category <> ALL(ARRAY[]::bytea[])` is
    //    vacuous-truth TRUE in Postgres and would wipe every row for
    //    this venue. Loud warn so operators notice.
    let pruned = if hard_errors > 0 {
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
