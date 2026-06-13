//! enrich — for each stale category, pull UTXO + holder + NFT state from our
//! local BlockBook and rebuild the enrichment tables. Intended to run on a
//! systemd timer (every 6 h for active categories, weekly for fully-burned).
//!
//! Port of `scripts/enrich-from-blockbook.ts`.
//!
//! ## How we get UTXOs
//!
//! The fork's `/api/v2/utxo/<category>` endpoint returns `[]` for every
//! category (the address index doesn't surface category-keyed UTXOs there).
//! Instead we walk `/api/v2/address/<category>?details=txs` paginated and
//! reconstruct the live UTXO set from token-bearing vouts whose `spent` flag
//! is not `true`. See `BlockbookClient::walk_category_utxos` for the full
//! workaround. The aggregator below is unchanged from the original UTXO-list
//! shape — same `Vec<Utxo>` interface, different upstream call.
//!
//! Env vars:
//! - BLOCKBOOK_URL       (default http://127.0.0.1:9131)
//! - BLOCKBOOK_MAX_RPS   (default 10)
//! - DATABASE_URL
//! - ENRICH_BATCH        (default 200)
//! - RUST_LOG

use std::time::Instant;

use anyhow::{Context, Result};
use num_bigint::BigInt;
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

use workers::blockbook::{BlockbookClient, Utxo};
use workers::enrich_core::{self, AggInput, AggNft};
use workers::env::parse_or_default;
use workers::pg::{
    self, HolderWrite, TokenStateWrite, bytes_to_hex, mark_enrich_run,
    pick_enrichment_batch, pool_from_env, write_token_state,
};

const ACTIVE_STALE_HOURS: i32 = 6;
const BURNED_STALE_HOURS: i32 = 24 * 7;
const DEFAULT_BATCH: i32 = 200;

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

/// Map a BlockBook `Utxo` to the shared [`AggInput`]. Amount parsing and
/// commitment hex-decoding (which can fail on malformed BlockBook data) happen
/// here so [`enrich_core::aggregate`] stays infallible; loud failure on an
/// unparseable amount is preserved — BlockBook should never emit one.
fn utxo_to_agg_input(u: &Utxo) -> Result<AggInput> {
    let td = u.token_data.as_ref();
    let amount: BigInt = match td.and_then(|t| t.amount.as_ref()) {
        Some(s) => s
            .parse::<BigInt>()
            .with_context(|| format!("parsing token amount {:?}", s))?,
        None => BigInt::from(0),
    };
    let nft = match td.and_then(|t| t.nft.as_ref()) {
        Some(n) => {
            // Empty commitment = malformed NFT: keep it (counts still apply in
            // aggregate) but don't hex-decode. Matches the prior behavior.
            let commitment = if n.commitment.is_empty() {
                Vec::new()
            } else {
                pg::hex_to_bytes(&n.commitment)
                    .with_context(|| format!("NFT commitment hex {:?}", &n.commitment))?
            };
            Some(AggNft { capability: n.capability, commitment })
        }
        None => None,
    };
    Ok(AggInput { address: u.address.clone(), amount, nft })
}


async fn enrich_one(
    pool: &pg::PgPool,
    bb: &BlockbookClient,
    category: &[u8],
) -> Result<usize> {
    let category_hex = bytes_to_hex(category);
    let utxos = bb
        .walk_category_utxos(&category_hex)
        .await
        .with_context(|| format!("blockbook tx-history walk for {}", &category_hex[..16]))?;
    let inputs: Vec<AggInput> = utxos
        .iter()
        .map(utxo_to_agg_input)
        .collect::<Result<_>>()?;
    let agg = enrich_core::aggregate(&inputs);

    // Sanity warning for per-category holder blow-up. BlockBook returns the
    // full UTXO list for a category unpaginated; memory scales linearly with
    // unique addresses. Realistic CashToken categories sit in the 10^3-10^4
    // range. At ~100k we're in outlier territory — log it so we notice
    // before any single run OOM-kills the process.
    if agg.holders.len() > 100_000 {
        warn!(
            category = %category_hex,
            holders = agg.holders.len(),
            "holder count unusually high; watch memory on repeat runs"
        );
    }

    let holders: Vec<HolderWrite> = agg
        .holders
        .iter()
        .map(|(addr, h)| HolderWrite {
            address: addr.clone(),
            balance: h.balance.to_string(),
            nft_count: h.nft_count,
        })
        .collect();

    let is_fully_burned = agg.live_utxo_count == 0;
    let holder_count = agg.holders.len() as i32;
    let gini_coefficient = enrich_core::compute_gini(&agg.holders);

    let w = TokenStateWrite {
        category: category.to_vec(),
        current_supply: agg.current_supply.to_string(),
        live_utxo_count: agg.live_utxo_count,
        live_nft_count: agg.live_nft_count,
        holder_count,
        has_active_minting: agg.has_active_minting,
        is_fully_burned,
        gini_coefficient,
        holders,
        nfts: agg.nfts,
    };

    write_token_state(pool, &w).await?;
    Ok(w.live_utxo_count as usize)
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let bb = BlockbookClient::from_env().context("building BlockBook client")?;
    let pool = pool_from_env().await.context("connecting to Postgres")?;
    let batch_size: i32 = parse_or_default("ENRICH_BATCH", DEFAULT_BATCH);

    // Sanity-check BlockBook is alive + in sync.
    let info = bb.get_node_info().await.context("blockbook /api/v2/")?;
    if info.blockbook.in_sync == Some(false) {
        error!("BlockBook is not in sync; aborting");
        pg::shutdown(pool).await;
        std::process::exit(2);
    }
    info!(
        best_height = ?info.blockbook.best_height,
        backend_blocks = ?info.backend.as_ref().and_then(|b| b.blocks),
        "BlockBook ok"
    );

    let batch = pick_enrichment_batch(&pool, ACTIVE_STALE_HOURS, BURNED_STALE_HOURS, batch_size).await?;
    if batch.is_empty() {
        info!("nothing stale; exiting");
        mark_enrich_run(&pool).await?;
        pg::shutdown(pool).await;
        return Ok(());
    }
    info!(n = batch.len(), "processing stale categories");

    let started = Instant::now();
    let mut ok_count: usize = 0;
    let mut burned_count: usize = 0;
    let mut err_count: usize = 0;

    for category in &batch {
        match enrich_one(&pool, &bb, category).await {
            Ok(live_utxos) => {
                ok_count += 1;
                if live_utxos == 0 {
                    burned_count += 1;
                }
            }
            Err(e) => {
                err_count += 1;
                error!(
                    category = %bytes_to_hex(category),
                    error = %e,
                    "enrich failed for category"
                );
            }
        }
    }

    mark_enrich_run(&pool).await?;
    let elapsed = started.elapsed().as_secs_f64();
    info!(
        total = batch.len(),
        ok = ok_count,
        errors = err_count,
        newly_burned = burned_count,
        elapsed_s = format!("{:.1}", elapsed),
        "enrich run complete"
    );

    pg::shutdown(pool).await;
    Ok(())
}
