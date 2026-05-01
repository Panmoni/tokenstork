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

use std::collections::HashMap;
use std::time::Instant;

use anyhow::{Context, Result};
use num_bigint::BigInt;
use num_traits::{ToPrimitive, Zero};
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

        let owner = u.address.as_deref().and_then(normalize_address);

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

/// Minimum holders required for a meaningful Gini score. Below this,
/// the formula produces extreme values (a 3-holder split looks
/// "Whale-controlled" no matter how the balances divide) that don't
/// say anything useful about the token.
const GINI_MIN_HOLDERS: usize = 10;

/// Gini coefficient of the holder fungible-balance distribution.
///
/// Returns `None` when:
/// - fewer than `GINI_MIN_HOLDERS` distinct holders (extreme-end values
///   are meaningless at single-digit-holder scale);
/// - total balance is zero (no fungible supply — pure-NFT collection
///   or fully-burned category).
///
/// Math (sorted-balances form):
///
/// ```text
/// gini = (2 · Σ(i · b_i for i=1..n) − (n+1) · Σ(b_i)) / (n · Σ(b_i))
/// ```
///
/// Where `b_i` are sorted ascending and `n = holder_count`. We stay in
/// `BigInt` for the numerator and denominator sums — for n=10k holders
/// at NUMERIC(78,0) max, the intermediate `Σ(i · b_i)` can be hundreds
/// of digits long. Only at the final ratio do we cast to `f64`. At that
/// stage we lose precision past ~15 significant digits, which is
/// harmless for a [0,1] ratio rendered as a percent or 2-decimal float.
fn compute_gini(holders: &HashMap<String, HolderAcc>) -> Option<f32> {
    let n = holders.len();
    if n < GINI_MIN_HOLDERS {
        return None;
    }

    let mut balances: Vec<&BigInt> = holders.values().map(|h| &h.balance).collect();
    balances.sort();

    let total: BigInt = balances.iter().copied().sum();
    if total.is_zero() {
        return None;
    }

    // Σ(i · b_i) for i = 1..=n (1-indexed per the formula).
    let mut weighted_sum = BigInt::from(0);
    for (idx, b) in balances.iter().enumerate() {
        let i = BigInt::from((idx + 1) as i64);
        weighted_sum += i * (*b);
    }

    let n_big = BigInt::from(n as i64);
    let numerator: BigInt = BigInt::from(2) * weighted_sum - (&n_big + 1) * &total;
    let denominator: BigInt = &n_big * &total;

    // `BigInt::to_f64` is lossy, not failing — it returns `Some(±INFINITY)`
    // for values past f64's range (~1.8e308). For extreme supplies × large
    // holder counts both numerator and denominator can hit infinity and
    // INF/INF = NaN. `clamp(0,1)` doesn't sanitise NaN ("If self is NaN,
    // returns NaN") so we'd silently write NaN to the REAL column and
    // break JSON serialisation downstream. Suppress to None when either
    // intermediate or the final ratio is non-finite.
    let num_f = numerator.to_f64()?;
    let den_f = denominator.to_f64()?;
    if !num_f.is_finite() || !den_f.is_finite() || den_f == 0.0 {
        return None;
    }
    let ratio = num_f / den_f;
    if !ratio.is_finite() {
        return None;
    }
    let gini = ratio.clamp(0.0, 1.0) as f32;
    Some(gini)
}

#[cfg(test)]
mod gini_tests {
    use super::*;

    fn holders(balances: &[u64]) -> HashMap<String, HolderAcc> {
        balances
            .iter()
            .enumerate()
            .map(|(i, b)| (format!("addr{i}"), HolderAcc { balance: BigInt::from(*b), nft_count: 0 }))
            .collect()
    }

    #[test]
    fn gini_below_min_holders_is_none() {
        assert!(compute_gini(&holders(&[1, 2, 3, 4, 5, 6, 7, 8, 9])).is_none());
    }

    #[test]
    fn gini_zero_supply_is_none() {
        assert!(compute_gini(&holders(&[0; 12])).is_none());
    }

    #[test]
    fn gini_perfect_equality_is_zero() {
        let g = compute_gini(&holders(&[100; 12])).expect("gini for 12 equal balances");
        assert!(g.abs() < 0.001, "expected ~0 for equal split, got {g}");
    }

    #[test]
    fn gini_extreme_inequality_approaches_one() {
        // 1 whale, 11 dust. Should be very close to (n-1)/n = 11/12 ≈ 0.9167.
        let mut balances = vec![1u64; 11];
        balances.push(1_000_000_000);
        let g = compute_gini(&holders(&balances)).expect("gini for whale-dominated split");
        assert!(g > 0.9 && g < 1.0, "expected high Gini for whale split, got {g}");
    }
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
    let gini_coefficient = compute_gini(&agg.holders);

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
