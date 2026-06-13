//! enrich-seed — one-shot bootstrap of `live_token_utxo` from existing history.
//!
//! The event-driven enrichment path (`sync-tail` Pass 6) maintains
//! `live_token_utxo` forward from each new block, but pre-existing categories
//! need their current live token-UTXO set seeded once. This binary sweeps every
//! category in `tokens`, walks its live UTXOs via BlockBook (the same
//! `walk_category_utxos` the legacy `enrich` used), and clean-replaces that
//! category's `live_token_utxo` rows.
//!
//! After this runs, the shadow comparison in `sync-tail` becomes meaningful
//! (before it, a touched category's historical UTXOs are absent so mismatches
//! are expected). Re-runnable: each category is a delete-then-insert, so a
//! second pass converges.
//!
//! ## Load note
//!
//! This puts the SAME sustained BlockBook query load on the box that the old
//! `enrich` did (the 2026-06-13 incident). It is now safe to run because
//! `blockbook-bcash` has `MemorySwapMax=0` (can't swap-thrash the host) and the
//! BlockBook client paces at `BLOCKBOOK_MAX_RPS` (default 10). Run it
//! deliberately, off-peak, and consider lowering `BLOCKBOOK_MAX_RPS` for the
//! seed run. Bootstrapped rows get `created_height = 0` (sentinel; reorg unwind
//! only touches recent heights — see `seed_category_live_utxos`).
//!
//! Env vars:
//! - BLOCKBOOK_URL / BLOCKBOOK_MAX_RPS — BlockBook REST + pacing
//! - DATABASE_URL                      — Postgres
//! - ENRICH_SEED_BATCH                 — categories per keyset page (default 200)
//! - RUST_LOG

use anyhow::{Context, Result};
use num_bigint::BigInt;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

use workers::blockbook::{BlockbookClient, Utxo};
use workers::enrich_walker::LiveUtxo;
use workers::env::parse_or_default;
use workers::pg::{self, bytes_to_hex, pick_categories_after, pool_from_env, seed_category_live_utxos};

const DEFAULT_BATCH: i64 = 200;

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

/// Decode a 32-byte id from BlockBook's display-order hex (no reversal), the
/// same convention `live_token_utxo` / `tokens` use.
fn decode_id32(hex_str: &str) -> Result<[u8; 32]> {
    let bytes = hex::decode(hex_str).with_context(|| format!("hex decode {hex_str}"))?;
    <[u8; 32]>::try_from(bytes.as_slice())
        .map_err(|_| anyhow::anyhow!("expected 32-byte id, got {} bytes", bytes.len()))
}

/// Map a BlockBook live `Utxo` to a `live_token_utxo` row for `category`.
/// Mirrors `enrich_walker::derive_block_deltas`'s create shape so the seeded
/// rows are indistinguishable from forward-tracked ones.
fn utxo_to_live_row(category: [u8; 32], u: &Utxo) -> Result<LiveUtxo> {
    let txid = decode_id32(&u.txid)?;
    let td = u.token_data.as_ref();
    let amount: BigInt = match td.and_then(|t| t.amount.as_ref()) {
        Some(s) => s
            .parse()
            .with_context(|| format!("seed amount {s:?} for {}", &u.txid))?,
        None => BigInt::from(0),
    };
    let (nft_commitment, nft_capability) = match td.and_then(|t| t.nft.as_ref()) {
        Some(n) => {
            let commitment = if n.commitment.is_empty() {
                Vec::new()
            } else {
                hex::decode(&n.commitment)
                    .with_context(|| format!("seed NFT commitment {:?}", &n.commitment))?
            };
            (Some(commitment), Some(n.capability))
        }
        None => (None, None),
    };
    Ok(LiveUtxo {
        txid,
        vout: i32::try_from(u.vout).context("vout overflows i32")?,
        category,
        address: u.address.clone(),
        amount,
        nft_commitment,
        nft_capability,
        created_height: 0,
    })
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let bb = BlockbookClient::from_env().context("building BlockBook client")?;
    let pool = pool_from_env().await.context("connecting to Postgres")?;
    let batch: i64 = parse_or_default("ENRICH_SEED_BATCH", DEFAULT_BATCH);

    // Sanity-check BlockBook is alive + in sync before a long sweep.
    let info = bb.get_node_info().await.context("blockbook /api/v2/")?;
    if info.blockbook.in_sync != Some(true) {
        warn!("BlockBook reports not in sync; seeded UTXO sets may lag the tip");
    }

    let mut cursor: Vec<u8> = Vec::new();
    let mut categories_done: u64 = 0;
    let mut rows_written: u64 = 0;
    let mut walk_errors: u64 = 0;

    loop {
        let page = pick_categories_after(&pool, &cursor, batch)
            .await
            .context("pick category page")?;
        if page.is_empty() {
            break;
        }

        for category in &page {
            let category_hex = bytes_to_hex(category);
            let cat32 = match <[u8; 32]>::try_from(category.as_slice()) {
                Ok(c) => c,
                Err(_) => {
                    warn!(category = %category_hex, "category not 32 bytes; skipping");
                    continue;
                }
            };

            match bb.walk_category_utxos(&category_hex).await {
                Ok(utxos) => {
                    let rows: Vec<LiveUtxo> = match utxos
                        .iter()
                        .map(|u| utxo_to_live_row(cat32, u))
                        .collect::<Result<_>>()
                    {
                        Ok(r) => r,
                        Err(e) => {
                            warn!(category = %category_hex, error = %e, "seed row build failed; skipping category");
                            walk_errors += 1;
                            continue;
                        }
                    };
                    let n = seed_category_live_utxos(&pool, category, &rows)
                        .await
                        .with_context(|| format!("seed category {category_hex}"))?;
                    rows_written += n as u64;
                }
                Err(e) => {
                    warn!(category = %category_hex, error = %e, "blockbook walk failed; skipping");
                    walk_errors += 1;
                }
            }
            categories_done += 1;
        }

        cursor = page.last().expect("page non-empty").clone();
        info!(
            categories_done,
            rows_written,
            walk_errors,
            seeded_through = %bytes_to_hex(&cursor),
            "seed progress"
        );
    }

    info!(categories_done, rows_written, walk_errors, "enrich-seed complete");
    pg::shutdown(pool).await;
    Ok(())
}
