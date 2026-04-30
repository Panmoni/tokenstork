//! crc20-rescan — one-shot historical scan for CRC-20 covenants in the
//! genesis transactions of every existing `tokens` row that doesn't yet
//! have a `token_crc20` row.
//!
//! Intended use: run once after deploying the CRC-20 schema + workers.
//! After it completes, sync-tail keeps the table fresh going forward.
//! Idempotent + resumable: re-running picks up wherever the previous
//! run stopped because already-detected categories are no longer in
//! the candidate set.
//!
//! Cost: one BCHN block fetch per genesis block that needs scanning,
//! plus one extra `tx_block_height` RPC per detected covenant. CRC-20
//! is sparse so this is bounded; on a synced BCHN the whole pass over
//! ~5k tokens is minutes-scale.
//!
//! Env vars:
//! - BCHN_RPC_URL / BCHN_RPC_AUTH
//! - DATABASE_URL
//! - CRC20_RESCAN_BATCH   default 5000 (categories per run)
//! - RUST_LOG

use std::time::Instant;

use anyhow::{Context, Result};
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

use workers::bchn::BchnClient;
use workers::crc20::detect_in_tx;
use workers::env::parse_or_default;
use workers::pg::{
    self, bytes_to_hex, crc20_canonical_resolve, get_token_genesis, mark_crc20_run,
    pick_crc20_rescan_batch, pool_from_env, write_crc20_detection,
};

const DEFAULT_BATCH: i32 = 5000;

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

    let batch_size: i32 = parse_or_default("CRC20_RESCAN_BATCH", DEFAULT_BATCH);

    let candidates = pick_crc20_rescan_batch(&pool, batch_size).await?;
    if candidates.is_empty() {
        info!("no candidates; nothing to rescan");
        mark_crc20_run(&pool).await?;
        pg::shutdown(pool).await;
        return Ok(());
    }
    info!(
        n = candidates.len(),
        batch_size,
        "rescanning historical tokens for CRC-20 covenants"
    );

    let started = Instant::now();
    let mut detected: usize = 0;
    let mut missing_in_block: usize = 0;
    let mut errors: usize = 0;

    // Group consecutive categories by genesis block so we fetch each
    // block at most once. The picker orders by genesis_block ASC so
    // this grouping is locality-friendly without a HashMap.
    let mut last_block_height: Option<i32> = None;
    let mut block_cache: Option<workers::bchn::Block> = None;

    for category in &candidates {
        let category_hex = bytes_to_hex(category);
        let (genesis_block, genesis_txid) = match get_token_genesis(&pool, category).await? {
            Some(v) => v,
            None => {
                warn!(category = %category_hex, "tokens row vanished mid-run; skipping");
                continue;
            }
        };

        // Fetch the genesis block (cached if previous category shared it).
        if last_block_height != Some(genesis_block) {
            match bchn.get_block_by_height(genesis_block as u64).await {
                Ok(block) => {
                    block_cache = Some(block);
                    last_block_height = Some(genesis_block);
                }
                Err(e) => {
                    errors += 1;
                    error!(
                        category = %category_hex,
                        height = genesis_block,
                        error = %e,
                        "failed to fetch genesis block"
                    );
                    block_cache = None;
                    last_block_height = None;
                    continue;
                }
            }
        }
        let Some(block) = block_cache.as_ref() else {
            continue;
        };

        let genesis_txid_hex = bytes_to_hex(&genesis_txid);
        let Some(tx) = block.tx.iter().find(|t| t.txid == genesis_txid_hex) else {
            warn!(
                category = %category_hex,
                height = genesis_block,
                txid = %genesis_txid_hex,
                "genesis tx not found in block; skipping"
            );
            missing_in_block += 1;
            continue;
        };

        let Some(d) = detect_in_tx(tx) else {
            // Not a CRC-20 token — that's the common case.
            continue;
        };

        match write_crc20_detection(&pool, &bchn, &d, genesis_block).await {
            Ok(()) => detected += 1,
            Err(e) => {
                errors += 1;
                error!(category = %category_hex, error = %e, "crc20 upsert failed");
            }
        }
    }

    // Single canonical-winner pass at end.
    match crc20_canonical_resolve(&pool).await {
        Ok(n) => info!(rows_updated = n, "crc20 canonical resolve complete"),
        Err(e) => warn!(error = %e, "crc20 canonical resolve failed"),
    }
    mark_crc20_run(&pool).await?;

    let elapsed = started.elapsed().as_secs_f64();
    info!(
        scanned = candidates.len(),
        detected,
        missing_in_block,
        errors,
        elapsed_s = format!("{:.1}", elapsed),
        "rescan complete"
    );

    pg::shutdown(pool).await;
    Ok(())
}
