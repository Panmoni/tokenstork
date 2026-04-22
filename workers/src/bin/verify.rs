//! verify — weekly cross-check that BlockBook's enrichment agrees with what
//! BCHN's `scantxoutset` independently reports. Purely a correctness canary.
//! Never blocks or rewrites state.
//!
//! Port of `scripts/verify-current-state.ts`.
//!
//! Env vars:
//! - BCHN_RPC_URL / BCHN_RPC_AUTH
//! - BLOCKBOOK_URL / BLOCKBOOK_MAX_RPS
//! - DATABASE_URL
//! - VERIFY_SAMPLE   (default 50)
//! - RUST_LOG

use anyhow::{Context, Result};
use num_bigint::BigInt;
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

use workers::bchn::{BchnClient, ScanTxOutSet};
use workers::blockbook::{BlockbookClient, Utxo};
use workers::env::parse_or_default;
use workers::pg::{self, bytes_to_hex, mark_verify_run, pick_verify_sample, pool_from_env};

const DEFAULT_SAMPLE: i32 = 50;

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

#[derive(Debug, Default)]
struct Aggregate {
    supply: BigInt,
    utxo_count: i32,
    nft_count: i32,
}

fn aggregate_scan(res: &ScanTxOutSet) -> Result<Aggregate> {
    let mut agg = Aggregate {
        utxo_count: res.unspents.len() as i32,
        ..Aggregate::default()
    };
    for u in &res.unspents {
        let Some(td) = &u.token_data else { continue };
        if let Some(amt) = &td.amount {
            // TokenAmount is either Text or Number — both parseable to BigInt.
            let s = match amt {
                workers::bchn::TokenAmount::Text(s) => s.clone(),
                workers::bchn::TokenAmount::Number(n) => n.to_string(),
            };
            let parsed: BigInt = s
                .parse()
                .with_context(|| format!("parsing BCHN scan amount {:?}", s))?;
            agg.supply += parsed;
        }
        if td.nft.is_some() {
            agg.nft_count += 1;
        }
    }
    Ok(agg)
}

fn aggregate_blockbook(utxos: &[Utxo]) -> Result<Aggregate> {
    let mut agg = Aggregate {
        utxo_count: utxos.len() as i32,
        ..Aggregate::default()
    };
    for u in utxos {
        let Some(td) = &u.token_data else { continue };
        if let Some(s) = &td.amount {
            let parsed: BigInt = s
                .parse()
                .with_context(|| format!("parsing BlockBook amount {:?}", s))?;
            agg.supply += parsed;
        }
        if td.nft.is_some() {
            agg.nft_count += 1;
        }
    }
    Ok(agg)
}

fn format_diff(bchn: &Aggregate, bb: &Aggregate) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    if bchn.supply != bb.supply {
        parts.push(format!(
            "supply {} (bchn) vs {} (blockbook)",
            bchn.supply, bb.supply
        ));
    }
    if bchn.utxo_count != bb.utxo_count {
        parts.push(format!(
            "utxos {} vs {}",
            bchn.utxo_count, bb.utxo_count
        ));
    }
    if bchn.nft_count != bb.nft_count {
        parts.push(format!("nfts {} vs {}", bchn.nft_count, bb.nft_count));
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("; "))
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let bchn = BchnClient::from_env().context("building BCHN client")?;
    let bb = BlockbookClient::from_env().context("building BlockBook client")?;
    let pool = pool_from_env().await.context("connecting to Postgres")?;
    let sample_size: i32 = parse_or_default("VERIFY_SAMPLE", DEFAULT_SAMPLE);

    let sample = pick_verify_sample(&pool, sample_size).await?;
    if sample.is_empty() {
        info!("no categories with state to sample; nothing to do");
        mark_verify_run(&pool).await?;
        pg::shutdown(pool).await;
        return Ok(());
    }
    info!(n = sample.len(), "sampling categories");

    let mut agreements: usize = 0;
    let mut disagreements: usize = 0;
    let mut errors: usize = 0;

    for category in &sample {
        let category_hex = bytes_to_hex(category);

        // Serial per-category: scantxoutset is heavy on BCHN and we want our
        // own node calm. Parallelism across categories here would break that.
        let scan = match bchn.scan_txoutset_by_category(&category_hex).await {
            Ok(r) => r,
            Err(e) => {
                errors += 1;
                error!(category = %category_hex, error = %e, "BCHN scantxoutset failed");
                continue;
            }
        };
        let bb_utxos = match bb.get_utxos_by_category(&category_hex).await {
            Ok(u) => u,
            Err(e) => {
                errors += 1;
                error!(category = %category_hex, error = %e, "BlockBook utxo fetch failed");
                continue;
            }
        };

        let bchn_agg = match aggregate_scan(&scan) {
            Ok(a) => a,
            Err(e) => {
                errors += 1;
                error!(category = %category_hex, error = %e, "BCHN aggregate parse failed");
                continue;
            }
        };
        let bb_agg = match aggregate_blockbook(&bb_utxos) {
            Ok(a) => a,
            Err(e) => {
                errors += 1;
                error!(category = %category_hex, error = %e, "BlockBook aggregate parse failed");
                continue;
            }
        };

        match format_diff(&bchn_agg, &bb_agg) {
            Some(diff) => {
                disagreements += 1;
                warn!(category = %category_hex, diff = %diff, "DISAGREEMENT");
            }
            None => {
                agreements += 1;
            }
        }
    }

    mark_verify_run(&pool).await?;
    info!(
        sampled = sample.len(),
        agreements,
        disagreements,
        errors,
        "verify run complete"
    );

    pg::shutdown(pool).await;
    Ok(())
}
