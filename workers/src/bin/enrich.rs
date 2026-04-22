//! enrich — for each stale category, pull UTXO + holder + NFT state from our
//! local BlockBook and rebuild the enrichment tables. Intended to run on a
//! systemd timer (every 6 h for active categories, weekly for fully-burned).
//!
//! Port of `scripts/enrich-from-blockbook.ts`.
//!
//! Env vars:
//! - BLOCKBOOK_URL       (default http://127.0.0.1:9130)
//! - BLOCKBOOK_MAX_RPS   (default 10)
//! - DATABASE_URL
//! - ENRICH_BATCH        (default 200)
//! - RUST_LOG

use std::collections::HashMap;
use std::time::Instant;

use anyhow::{Context, Result};
use num_bigint::BigInt;
use num_traits::Zero;
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

use workers::bchn::NftCapability;
use workers::blockbook::{BlockbookClient, Utxo, normalize_address};
use workers::env::parse_or_default;
use workers::pg::{
    self, HolderWrite, NftWrite, TokenStateWrite, bytes_to_hex, mark_enrich_run,
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

#[derive(Default)]
struct Aggregate {
    current_supply: BigInt,
    live_utxo_count: i32,
    live_nft_count: i32,
    has_active_minting: bool,
    holders: HashMap<String, HolderAcc>,
    nfts: Vec<NftWrite>,
}

#[derive(Default)]
struct HolderAcc {
    balance: BigInt,
    nft_count: i32,
}

/// Walk the UTXO list and collect per-category state. Errors on malformed
/// token amounts (unparseable decimal strings) — BlockBook should never emit
/// those, so loud failure is the right signal.
fn aggregate(utxos: &[Utxo]) -> Result<Aggregate> {
    let mut agg = Aggregate {
        live_utxo_count: utxos.len() as i32,
        ..Aggregate::default()
    };

    for u in utxos {
        let Some(td) = &u.token_data else { continue };
        let amount: BigInt = match &td.amount {
            Some(s) => s
                .parse::<BigInt>()
                .with_context(|| format!("parsing token amount {:?}", s))?,
            None => BigInt::zero(),
        };
        agg.current_supply += &amount;

        let owner = u.address.as_deref().map(normalize_address);

        if let Some(addr) = &owner {
            let entry = agg.holders.entry(addr.clone()).or_default();
            entry.balance += &amount;
            if td.nft.is_some() {
                entry.nft_count += 1;
            }
        }

        if let Some(nft) = &td.nft {
            agg.live_nft_count += 1;
            if matches!(nft.capability, NftCapability::Minting) {
                agg.has_active_minting = true;
            }
            let capability: &'static str = match nft.capability {
                NftCapability::None => "none",
                NftCapability::Mutable => "mutable",
                NftCapability::Minting => "minting",
            };
            // Skip malformed NFTs with empty commitments — matches TS.
            if nft.commitment.is_empty() {
                continue;
            }
            let commitment = pg::hex_to_bytes(&nft.commitment)
                .with_context(|| format!("NFT commitment hex {:?}", &nft.commitment))?;
            agg.nfts.push(NftWrite {
                commitment,
                capability,
                owner_address: owner.clone(),
            });
        }
    }

    Ok(agg)
}

async fn enrich_one(
    pool: &pg::PgPool,
    bb: &BlockbookClient,
    category: &[u8],
) -> Result<usize> {
    let category_hex = bytes_to_hex(category);
    let utxos = bb
        .get_utxos_by_category(&category_hex)
        .await
        .with_context(|| format!("blockbook utxos for {}", &category_hex[..16]))?;
    let agg = aggregate(&utxos)?;

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

    let w = TokenStateWrite {
        category: category.to_vec(),
        current_supply: agg.current_supply.to_string(),
        live_utxo_count: agg.live_utxo_count,
        live_nft_count: agg.live_nft_count,
        holder_count,
        has_active_minting: agg.has_active_minting,
        is_fully_burned,
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
