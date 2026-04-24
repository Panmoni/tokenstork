//! tapswap-backfill — oneshot cold walk from the Tapswap-launch floor block
//! (794,520) to the current chain tip, detecting MPSW-protocol listings and
//! inserting them into `tapswap_offers`. Analogous to `bin/backfill.rs` but
//! for Tapswap P2P listings instead of token categories.
//!
//! Typical runtime: ~51 min on a synced BCHN over localhost RPC for a cold
//! ~153k-block pass. Resumable via `sync_state.last_tapswap_backfill_through`
//! which advances every CHECKPOINT_EVERY blocks.
//!
//! Env vars:
//! - BCHN_RPC_URL      (default http://127.0.0.1:8332)
//! - BCHN_RPC_AUTH     "user:password" (required)
//! - DATABASE_URL      Postgres URL (required)
//! - RUST_LOG          log filter; defaults to `info` if unset

use std::time::Instant;

use anyhow::{Context, Result};
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

use workers::bchn::{BchnClient, Block};
use workers::pg::{
    self, OfferWrite, load_tapswap_backfill_through, pool_from_env,
    save_tapswap_backfill_through, upsert_tapswap_offers_batch,
};
use workers::tapswap::try_decode_tx;

/// First block we scan — block before the Tapswap launch height per the
/// reference indexer (794,520). The backfill starts at `from + 1`.
const TAPSWAP_FLOOR_BLOCK: i32 = 794_519;

const CHECKPOINT_EVERY: i32 = 1000;
const PROGRESS_EVERY: i32 = 500;

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

/// Per-block counters returned by `process_block`. Decode failures (parser
/// rejections beyond the prefix match) and DB upsert failures are tracked
/// separately so the final summary log distinguishes "protocol weirdness"
/// from "Postgres flaked mid-run."
struct BlockCounts {
    offers_written: usize,
    decode_errors: usize,
    db_errors: usize,
}

async fn process_block(pool: &pg::PgPool, block: &Block) -> BlockCounts {
    let height: i32 = match block.height.try_into() {
        Ok(h) => h,
        Err(_) => {
            error!(height = block.height, "block height doesn't fit i32; skipping");
            return BlockCounts { offers_written: 0, decode_errors: 1, db_errors: 0 };
        }
    };

    let mut batch: Vec<OfferWrite> = Vec::new();
    let mut decode_errors = 0usize;

    for tx in &block.tx {
        match try_decode_tx(tx, height, block.time) {
            Ok(Some(offer)) => batch.push(offer),
            Ok(None) => {}
            Err(e) => {
                decode_errors += 1;
                warn!(
                    tx = %tx.txid,
                    error = %e,
                    "failed to build OfferWrite; skipping"
                );
            }
        }
    }

    if batch.is_empty() {
        return BlockCounts { offers_written: 0, decode_errors, db_errors: 0 };
    }

    match upsert_tapswap_offers_batch(pool, &batch).await {
        Ok(n) => BlockCounts {
            offers_written: n,
            decode_errors,
            db_errors: 0,
        },
        Err(e) => {
            error!(height, error = %e, "batch upsert failed; will retry next run");
            BlockCounts {
                offers_written: 0,
                decode_errors,
                db_errors: 1,
            }
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let bchn = BchnClient::from_env().context("building BCHN client")?;
    let pool = pool_from_env().await.context("connecting to Postgres")?;

    let checkpoint = load_tapswap_backfill_through(&pool).await?;
    let mut from = checkpoint.unwrap_or(TAPSWAP_FLOOR_BLOCK);
    if from < TAPSWAP_FLOOR_BLOCK {
        from = TAPSWAP_FLOOR_BLOCK;
    }

    let tip: i32 = bchn
        .get_block_count()
        .await
        .context("fetching BCHN tip")?
        .try_into()
        .context("BCHN tip doesn't fit i32")?;

    if tip <= from {
        info!(from, tip, "already at tip; nothing to backfill");
        pg::shutdown(pool).await;
        return Ok(());
    }

    info!(from = from + 1, to = tip, "Tapswap backfill starting");
    let started = Instant::now();
    let mut total_offers = 0usize;
    let mut total_decode_errors = 0usize;
    let mut total_db_errors = 0usize;
    let mut last_checkpoint = from;

    for h in (from + 1)..=tip {
        let block = match bchn.get_block_by_height(h as u64).await {
            Ok(b) => b,
            Err(e) => {
                error!(height = h, error = %e, "block fetch failed; aborting run");
                // Save what we have so a retry picks up here.
                save_tapswap_backfill_through(&pool, last_checkpoint).await?;
                pg::shutdown(pool).await;
                return Err(e).context(format!("fetching block {h}"));
            }
        };

        let counts = process_block(&pool, &block).await;
        total_offers += counts.offers_written;
        total_decode_errors += counts.decode_errors;
        total_db_errors += counts.db_errors;

        if h % CHECKPOINT_EVERY == 0 {
            save_tapswap_backfill_through(&pool, h).await?;
            last_checkpoint = h;
        }
        if h % PROGRESS_EVERY == 0 {
            info!(
                height = h,
                scanned = h - from,
                offers = total_offers,
                decode_errors = total_decode_errors,
                db_errors = total_db_errors,
                "Tapswap backfill progress"
            );
        }
    }

    save_tapswap_backfill_through(&pool, tip).await?;
    pg::mark_tapswap_run(&pool).await?;

    let elapsed = started.elapsed().as_secs_f64();
    info!(
        scanned = tip - from,
        offers = total_offers,
        decode_errors = total_decode_errors,
        db_errors = total_db_errors,
        elapsed_s = format!("{:.1}", elapsed),
        "Tapswap backfill complete"
    );

    pg::shutdown(pool).await;
    Ok(())
}
