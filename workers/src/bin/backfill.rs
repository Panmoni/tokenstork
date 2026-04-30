//! backfill — walk BCHN blocks 792,772 → tip, extract every CashToken
//! category, upsert into `tokens`.
//!
//! Port of `scripts/backfill-from-bchn.ts`. Semantics are byte-compatible:
//! same starting height, same checkpoint cadence, same classifier, same
//! `ON CONFLICT` upgrade rules. Expected wall-clock: ~90 min on a synced
//! BCHN over localhost RPC.
//!
//! Resumable: checkpoints `sync_state.backfill_through` every 1000 blocks.
//!
//! Env vars:
//! - BCHN_RPC_URL      (default http://127.0.0.1:8332)
//! - BCHN_RPC_AUTH     "user:password" (required)
//! - DATABASE_URL      Postgres URL (required)
//! - RUST_LOG          log filter; defaults to `info` if unset

use std::collections::HashMap;
use std::time::Instant;

use anyhow::{Context, Result};
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

use workers::bchn::{BchnClient, Tx};
use workers::crc20::detect_in_tx;
use workers::pg::{
    self, FoundCategory, TokenType, crc20_canonical_resolve, load_sync_state,
    mark_crc20_run, pool_from_env, save_backfill_through, upsert_tokens,
    write_crc20_detection,
};

const CASHTOKEN_START_BLOCK: i32 = 792_772;
const CHECKPOINT_EVERY: i32 = 1000;
const PROGRESS_EVERY: i32 = 500;

/// A cross-block accumulator entry. We keep the earliest-seen genesis data
/// and upgrade `token_type` as more evidence arrives.
#[derive(Debug, Clone)]
struct Observation {
    token_type: TokenType,
    genesis_block: i32,
    genesis_time: i64,
    genesis_txid: String,
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

/// Scan a single transaction's outputs. Returns a per-tx map of category (hex)
/// → (hasFT, hasNFT). Categories that appear in multiple vouts get combined.
fn scan_tx(tx: &Tx) -> HashMap<String, (bool, bool)> {
    let mut per_tx: HashMap<String, (bool, bool)> = HashMap::new();
    for vout in &tx.vout {
        let Some(td) = &vout.token_data else { continue };
        let entry = per_tx.entry(td.category.clone()).or_insert((false, false));
        if let Some(amt) = &td.amount
            && amt.is_positive()
        {
            entry.0 = true;
        }
        if td.nft.is_some() {
            entry.1 = true;
        }
    }
    per_tx
}

/// Merge a per-tx observation into the cross-block batch.
fn observe(
    batch: &mut HashMap<String, Observation>,
    category: String,
    has_ft: bool,
    has_nft: bool,
    height: i32,
    time: i64,
    txid: &str,
) {
    let new_type = TokenType::from_evidence(has_ft, has_nft);
    batch
        .entry(category)
        .and_modify(|obs| obs.token_type = obs.token_type.merge(new_type))
        .or_insert_with(|| Observation {
            token_type: new_type,
            genesis_block: height,
            genesis_time: time,
            genesis_txid: txid.to_string(),
        });
}

/// Flush the batch into Postgres as a single transaction, then clear it.
async fn flush_batch(
    pool: &pg::PgPool,
    batch: &mut HashMap<String, Observation>,
) -> Result<usize> {
    if batch.is_empty() {
        return Ok(0);
    }
    let mut rows: Vec<FoundCategory> = Vec::with_capacity(batch.len());
    for (cat_hex, obs) in batch.iter() {
        let category = pg::hex_to_bytes(cat_hex)?;
        let genesis_txid = pg::hex_to_bytes(&obs.genesis_txid)?;
        rows.push(FoundCategory {
            category,
            token_type: obs.token_type,
            genesis_txid,
            genesis_block: obs.genesis_block,
            genesis_time: obs.genesis_time,
        });
    }
    let written = upsert_tokens(pool, &rows).await?;
    batch.clear();
    Ok(written)
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let bchn = BchnClient::from_env().context("building BCHN client")?;
    let pool = pool_from_env().await.context("connecting to Postgres")?;

    let info = bchn.get_blockchain_info().await?;
    let tip: i32 = info
        .blocks
        .try_into()
        .context("tip height does not fit in i32")?;

    let state = load_sync_state(&pool).await?;
    let through = state.backfill_through.unwrap_or(CASHTOKEN_START_BLOCK - 1);
    let start = through.saturating_add(1).max(CASHTOKEN_START_BLOCK);

    info!(
        tip,
        start,
        through,
        backfill_complete = state.backfill_complete,
        chain = %info.chain,
        "backfill start"
    );

    if start > tip {
        info!(tip, "already at tip; marking backfill_complete");
        save_backfill_through(&pool, tip, true).await?;
        pg::shutdown(pool).await;
        return Ok(());
    }

    let total_blocks = tip - start + 1;
    info!(
        total_blocks,
        start,
        tip,
        "scanning blocks"
    );

    let mut batch: HashMap<String, Observation> = HashMap::new();
    let mut flushed_total: usize = 0;
    let mut last_checkpoint = start - 1;
    let started = Instant::now();

    for height in start..=tip {
        // Fetch block. On error, flush what we have, checkpoint, and abort.
        let block = match bchn.get_block_by_height(height as u64).await {
            Ok(b) => b,
            Err(e) => {
                error!(height, error = %e, "failed to fetch block; flushing and aborting");
                flush_batch(&pool, &mut batch).await.ok();
                save_backfill_through(&pool, last_checkpoint, false).await.ok();
                pg::shutdown(pool).await;
                return Err(e);
            }
        };

        let block_time = block.time;
        for tx in &block.tx {
            let per_tx = scan_tx(tx);
            for (cat, (has_ft, has_nft)) in per_tx {
                observe(&mut batch, cat, has_ft, has_nft, height, block_time, &tx.txid);
            }

            // CRC-20 detection. Independent of the cross-block tokens
            // batch — every CRC-20 reveal is a single tx event, so we
            // upsert immediately rather than buffering. Errors are
            // soft-failed (warn + continue) so a single bad row doesn't
            // pin the whole backfill.
            if let Some(d) = detect_in_tx(tx)
                && let Err(e) = write_crc20_detection(&pool, &bchn, &d, height).await
            {
                warn!(
                    category = %d.category_hex,
                    error = %e,
                    "crc20 write failed during backfill; continuing"
                );
            }
        }

        if height % PROGRESS_EVERY == 0 {
            let elapsed = started.elapsed().as_secs_f64().max(0.001);
            let done = (height - start + 1) as f64;
            let rate = done / elapsed;
            let eta_secs = (total_blocks as f64 - done) / rate.max(0.1);
            info!(
                height,
                tip,
                pct = format!("{:.1}%", done * 100.0 / total_blocks as f64),
                rate_bps = format!("{:.1}", rate),
                eta_s = format!("{:.0}", eta_secs),
                buffered = batch.len(),
                "progress"
            );
        }

        if height - last_checkpoint >= CHECKPOINT_EVERY {
            let written = flush_batch(&pool, &mut batch).await.inspect_err(|e| {
                error!(height, error = %e, "batch flush failed");
            })?;
            flushed_total += written;
            save_backfill_through(&pool, height, false).await?;
            last_checkpoint = height;
        }
    }

    // Final flush.
    flushed_total += flush_batch(&pool, &mut batch).await?;
    save_backfill_through(&pool, tip, true).await?;

    // Single canonical-winner pass at end of backfill — much cheaper
    // than running it per block, and the data is only consumed after
    // backfill completes anyway.
    match crc20_canonical_resolve(&pool).await {
        Ok(n) => info!(rows_updated = n, "crc20 canonical resolve complete"),
        Err(e) => warn!(error = %e, "crc20 canonical resolve failed"),
    }
    if let Err(e) = mark_crc20_run(&pool).await {
        warn!(error = %e, "mark_crc20_run failed; observability only");
    }

    let elapsed = started.elapsed().as_secs_f64();
    let count = pg::count_tokens(&pool).await.unwrap_or(-1);
    info!(
        scanned = total_blocks,
        elapsed_s = format!("{:.1}", elapsed),
        rows_written = flushed_total,
        tokens_row_count = count,
        "backfill complete"
    );

    if count < 0 {
        warn!("could not read tokens count after backfill");
    }

    pg::shutdown(pool).await;
    Ok(())
}
