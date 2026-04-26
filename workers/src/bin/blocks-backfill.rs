//! blocks-backfill — oneshot cold walk from CashTokens activation (block
//! 792,772) to the current chain tip, populating the `blocks` table with
//! per-block economics derived from each block's verbose getblock
//! response. Backs the `/blocks` page so the table isn't blank on
//! day-one of the feature.
//!
//! Reuses `workers::blocks::summarize_block` (the same pure-Rust
//! summarizer the live `sync-tail` Pass 4 walker uses) so the historical
//! and live data are bit-identical.
//!
//! Idempotent + resumable. The schema is upsert-on-conflict (height PK),
//! so re-running this binary on a partially-populated DB overwrites the
//! existing rows with fresh values. Resume point lives in
//! `sync_state.last_blocks_backfill_through`, advanced every
//! CHECKPOINT_EVERY blocks.
//!
//! Expected runtime: ~25-30 min on a synced BCHN over localhost RPC for
//! a cold ~155k-block pass — same shape as the original tokens backfill,
//! since the dominant cost is one BCHN getblock RPC per height.
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

use workers::bchn::BchnClient;
use workers::blocks::{ACTIVATION_HEIGHT, summarize_block};
use workers::pg::{
    self, BlockWrite, load_blocks_backfill_through, mark_blocks_run, pool_from_env,
    save_blocks_backfill_through, upsert_blocks_batch,
};

/// Flush the buffered batch every N blocks. 1000 keeps each Postgres
/// transaction short (sub-second) so a mid-batch crash loses at most
/// 1000 blocks; the per-row UPSERT-on-conflict makes the redo idempotent.
const CHECKPOINT_EVERY: i32 = 1000;

/// Log a progress line every N blocks.
const PROGRESS_EVERY: i32 = 5000;

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

    let checkpoint = load_blocks_backfill_through(&pool).await?;
    // We start at `from + 1`. If checkpoint is None or below the floor,
    // begin one block before activation so the first iteration covers
    // 792,772 itself.
    let mut from = checkpoint.unwrap_or(ACTIVATION_HEIGHT - 1);
    if from < ACTIVATION_HEIGHT - 1 {
        from = ACTIVATION_HEIGHT - 1;
    }

    let tip: i32 = bchn
        .get_block_count()
        .await
        .context("fetching BCHN tip")?
        .try_into()
        .context("BCHN tip doesn't fit i32")?;

    if tip <= from {
        info!(from, tip, "blocks-backfill already at tip; nothing to do");
        pg::shutdown(pool).await;
        return Ok(());
    }

    info!(from = from + 1, to = tip, "blocks-backfill starting");
    let started = Instant::now();
    let mut batch: Vec<BlockWrite> = Vec::with_capacity(CHECKPOINT_EVERY as usize);
    let mut total_written: usize = 0;
    let mut total_skipped: usize = 0;
    let mut last_checkpoint = from;

    for h in (from + 1)..=tip {
        let block = match bchn.get_block_by_height(h as u64).await {
            Ok(b) => b,
            Err(e) => {
                error!(height = h, error = %e, "block fetch failed; flushing batch + aborting");
                if !batch.is_empty()
                    && let Err(flush_err) = upsert_blocks_batch(&pool, &batch).await
                {
                    error!(error = %flush_err, "final flush also failed");
                }
                save_blocks_backfill_through(&pool, last_checkpoint).await?;
                pg::shutdown(pool).await;
                return Err(e).context(format!("fetching block {h}"));
            }
        };

        match summarize_block(&block) {
            Ok(summary) => {
                batch.push(BlockWrite {
                    height: summary.height,
                    hash: summary.hash.to_vec(),
                    time_unix: summary.time,
                    tx_count: summary.tx_count,
                    total_output_sats: summary.total_output_sats,
                    coinbase_sats: summary.coinbase_sats,
                    fees_sats: summary.fees_sats,
                    subsidy_sats: summary.subsidy_sats,
                    size_bytes: summary.size_bytes,
                    coinbase_script_sig: summary.coinbase_script_sig,
                });
            }
            Err(e) => {
                warn!(height = h, error = %e, "summarize_block failed; skipping row");
                total_skipped += 1;
            }
        }

        if h % CHECKPOINT_EVERY == 0 {
            if !batch.is_empty() {
                let n = upsert_blocks_batch(&pool, &batch)
                    .await
                    .with_context(|| format!("blocks batch flush at height {h}"))?;
                total_written += n;
                batch.clear();
            }
            save_blocks_backfill_through(&pool, h).await?;
            last_checkpoint = h;
        }

        if h % PROGRESS_EVERY == 0 {
            info!(
                height = h,
                scanned = h - from,
                written = total_written,
                skipped = total_skipped,
                "blocks-backfill progress"
            );
        }
    }

    // Final flush for the remainder of the tail end (anything past the
    // last CHECKPOINT_EVERY boundary).
    if !batch.is_empty() {
        let n = upsert_blocks_batch(&pool, &batch)
            .await
            .context("final blocks batch flush")?;
        total_written += n;
    }
    save_blocks_backfill_through(&pool, tip).await?;
    if let Err(e) = mark_blocks_run(&pool).await {
        warn!(error = %e, "mark_blocks_run failed; observability only");
    }

    let elapsed = started.elapsed().as_secs_f64();
    info!(
        scanned = tip - from,
        written = total_written,
        skipped = total_skipped,
        elapsed_s = format!("{:.1}", elapsed),
        "blocks-backfill complete"
    );

    pg::shutdown(pool).await;
    Ok(())
}
