//! fex — scan BCHN's UTXO set for Fex.cash AMM pool states and refresh
//! `token_venue_listings` with `venue='fex'`. Powers the UI's "Listed on
//! Fex" filter + a Fex price / TVL card on the per-token detail page.
//!
//! Fex exposes no external API. Every pool's state lives in a UTXO locked
//! to a zero-parameter `AssetCovenant`, which means every pool shares the
//! same 25-byte P2SH locking bytecode. One `scantxoutset` call returns the
//! full ecosystem (~10 pools as of 2026-04-24, each tiny to decode).
//!
//! Shape mirrors `bin/cauldron.rs` — hard-error gate on pruning, soft-error
//! bucket for TVL/history failures, same empty-seen guard against a
//! vacuous-truth `<> ALL(ARRAY[]::bytea[])` wipe.
//!
//! Env vars:
//! - `DATABASE_URL`.
//! - `BCHN_RPC_URL`, `BCHN_RPC_AUTH`.
//! - `RUST_LOG`.

use std::time::Instant;

use anyhow::{Context, Result};
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

use workers::bchn::BchnClient;
use workers::fex::{ASSET_COVENANT_P2SH_HEX, price_sats, try_decode_asset_utxo, tvl_sats};
use workers::pg::{
    self, VenueListingWrite, bytes_to_hex, insert_price_history_point, mark_fex_run,
    pool_from_env, prune_stale_venue_listings, upsert_venue_listing,
};

const VENUE: &str = "fex";

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

    let bchn = BchnClient::from_env().context("building BCHN client")?;
    let pool = pool_from_env().await.context("connecting to Postgres")?;

    let started = Instant::now();

    info!(
        descriptor = ASSET_COVENANT_P2SH_HEX,
        "scanning BCHN UTXO set for Fex AssetCovenant pools"
    );

    let scan = match bchn
        .scan_txoutset_by_raw_script(ASSET_COVENANT_P2SH_HEX)
        .await
    {
        Ok(s) => s,
        Err(e) => {
            // Total scan failure ⇒ we cannot trust ANY conclusion about the
            // current Fex state. Don't mark the run timestamp; don't prune.
            // The staleness watchdog will pick this up by noticing
            // last_fex_run_at hasn't moved.
            error!(error = %e, "scantxoutset failed; aborting without touching DB");
            pg::shutdown(pool).await;
            return Err(e);
        }
    };

    if !scan.success {
        // BCHN sometimes returns {"success": false, "unspents": []} when
        // another process already holds the scantxoutset lock. Treat as a
        // hard failure for the same reason: we can't trust the empty
        // unspents set means "no pools" — it means "we didn't actually
        // scan".
        error!(
            "scantxoutset returned success=false (likely another scan in flight); skipping"
        );
        pg::shutdown(pool).await;
        return Ok(());
    }

    info!(n = scan.unspents.len(), "scantxoutset returned candidates");

    let mut listed: usize = 0;
    let mut decode_errors: usize = 0;
    // "Hard" errors (upsert failure) gate pruning — `seen` must be the
    // true current set of Fex-listed categories before we DELETE anything.
    // "Soft" errors (history append only) don't gate pruning; the snapshot
    // is still correct, just the time series dropped a point.
    let mut hard_errors: usize = 0;
    let mut soft_errors: usize = 0;
    let mut seen: Vec<Vec<u8>> = Vec::new();

    // A single token category can have MULTIPLE Fex pools. The
    // AssetCovenant takes zero constructor parameters so any LP can spin
    // up another pool for the same token without on-chain enforcement
    // against duplicates — the docs (https://docs.fex.cash/) describe a
    // "Fair Meme" contract that authoritatively creates the first pool
    // per token but stop short of saying competing user-created pools
    // are protocol-rejected.
    //
    // We pick the pool with the highest BCH reserve as the directory's
    // canonical entry. Reasoning:
    //  - Highest reserve ≈ thickest market ≈ the price most traders see.
    //  - Stable: a brief liquidity blip can re-elect a pool, but for the
    //    4h-cadence directory this is fine; sparkline noise from a
    //    canonical-pool flip is bounded by the BCH-reserve gap.
    //  - Verifiable: the choice is computable from on-chain state alone,
    //    no off-chain registry dependency.
    //
    // If Fex publishes a canonical-pool registry (or the docs add a
    // first-pool-only rule), revisit this. Ties on BCH-sats resolve to
    // whichever pool the BCHN scan returned first.
    use std::collections::HashMap;
    let mut best_per_category: HashMap<[u8; 32], workers::fex::FexPool> = HashMap::new();
    for u in &scan.unspents {
        let Some(pool_state) = try_decode_asset_utxo(u) else {
            decode_errors += 1;
            warn!(
                txid = %u.txid,
                vout = u.vout,
                "failed to decode as Fex AssetCovenant; skipping"
            );
            continue;
        };
        best_per_category
            .entry(pool_state.category)
            .and_modify(|existing| {
                if pool_state.bch_sats > existing.bch_sats {
                    *existing = pool_state.clone();
                }
            })
            .or_insert(pool_state);
    }

    for pool_state in best_per_category.values() {
        let category_hex = hex::encode(pool_state.category);
        let Some(price) = price_sats(pool_state) else {
            // Shouldn't happen: try_decode_asset_utxo rejects zero-token-
            // reserve pools already. Defensive only.
            warn!(
                category = %category_hex,
                "pool decoded but price computation failed; skipping"
            );
            continue;
        };
        let tvl = tvl_sats(pool_state);

        let category_vec = pool_state.category.to_vec();
        let w = VenueListingWrite {
            venue: VENUE,
            category: category_vec.clone(),
            price_sats: Some(price),
            tvl_satoshis: Some(tvl),
        };
        if let Err(e) = upsert_venue_listing(&pool, &w).await {
            hard_errors += 1;
            error!(
                category = %category_hex,
                error = %e,
                "Fex upsert failed"
            );
            continue;
        }

        if let Err(e) =
            insert_price_history_point(&pool, VENUE, &category_vec, price, Some(tvl)).await
        {
            soft_errors += 1;
            warn!(
                category = %category_hex,
                error = %e,
                "Fex price-history append failed"
            );
        }

        listed += 1;
        seen.push(category_vec);
    }

    // Same three-gate pruning guard as bin/cauldron.rs — documented in
    // detail there. Short version: skip on hard errors (truth of `seen`
    // unprovable), skip on empty `seen` (would wipe every row), otherwise
    // delete whatever venue='fex' row isn't in `seen`.
    let pruned = if hard_errors > 0 {
        warn!(hard_errors, "hard errors during run; skipping delist pruning");
        0
    } else if seen.is_empty() {
        // Zero Fex pools currently listed is a legitimate state (the
        // ecosystem is ~10 pools; a total-wipe future is possible but
        // rare). Still, the cost of one false-true wipe is high and the
        // recovery from "we pruned everything" requires a re-scan on
        // the next 4h tick anyway — so be conservative and skip. Operator
        // can manually `TRUNCATE token_venue_listings WHERE venue='fex'`
        // if the ecosystem genuinely goes to zero.
        warn!(
            scanned = scan.unspents.len(),
            "no valid Fex pools decoded this run; skipping delist pruning"
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

    mark_fex_run(&pool).await?;
    let elapsed = started.elapsed().as_secs_f64();
    info!(
        scanned = scan.unspents.len(),
        listed,
        decode_errors,
        hard_errors,
        soft_errors,
        pruned,
        elapsed_s = format!("{:.1}", elapsed),
        "fex run complete"
    );

    // Hint the operator about any seen categories — useful for a quick
    // "did the top pool still show up?" sanity check on first deploy.
    if listed > 0 {
        let top = best_per_category
            .values()
            .max_by_key(|p| p.bch_sats)
            .map(|p| (bytes_to_hex(&p.category), p.bch_sats));
        if let Some((cat_hex, sats)) = top {
            info!(category = %cat_hex, bch_sats = sats, "top-TVL Fex pool this run");
        }
    }

    pg::shutdown(pool).await;
    Ok(())
}
