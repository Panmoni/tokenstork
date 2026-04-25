//! Shared per-block Tapswap close walker. Used by both `sync-tail`
//! (live, on every new block) and `tapswap-spend-backfill` (one-shot,
//! walking history). Centralized here to prevent drift between the two
//! callers — any future bug fix to candidate detection / classification
//! / close application lands in one place.
//!
//! The function returns the count of rows transitioned. Errors are
//! propagated; each caller wraps with its own error policy:
//!   - Live walker (`bin/tail.rs` Pass 3): propagates the error, which
//!     prevents the tail's checkpoint from advancing so the next tick
//!     re-processes the block.
//!   - Backfill (`bin/tapswap-spend-backfill.rs`): catches and counts
//!     into a `db_errors` field, then continues — re-running picks up
//!     any missed rows via the `WHERE status='open'` guard.

use anyhow::{Context, Result};
use chrono::TimeZone;
use tracing::warn;

use crate::bchn::{Block, Tx};
use crate::pg::{
    OfferCloseWrite, PgPool, apply_tapswap_closes, find_open_tapswap_offers_by_id,
};
use crate::tapswap::{CloseStatus, classify_close, is_mpsw_spend_candidate};

/// Walk one block's transactions for Tapswap close events; classify
/// and apply each. Returns the number of rows transitioned.
///
/// Algorithm (mirrors the protocol reference):
///   1. For each tx, examine `vin[0]` — the contract input.
///   2. Skip coinbase (no txid/vout) and any input that doesn't spend
///      `prev_vout=0` of some prior tx (Tapswap listings are always
///      at vout=0 of the listing tx).
///   3. Cheap byte-level filter: unlocking bytecode length floor + the
///      21-byte spend-marker presence. Short-circuits before any DB work.
///   4. Bulk-lookup matching open offers by listing-txid (the prior
///      tx's id is the `tapswap_offers.id`).
///   5. For each match, classify by inspecting the spending tx's
///      `vout[0]` PKH against the listing's stored maker_pkh:
///      - matches → Cancelled
///      - differs (P2PKH) → Taken with that PKH as the taker
///      - non-P2PKH → Taken with no recoverable taker_pkh
///   6. Apply the staged closes via per-row guarded UPDATE.
///
/// `block.height` is read inside; the caller doesn't need to pass it
/// separately. `block.time` becomes `closed_at` for each transitioned
/// row.
pub async fn process_block_spends(pool: &PgPool, block: &Block) -> Result<usize> {
    let height: i32 = block
        .height
        .try_into()
        .context("block.height does not fit in i32")?;

    struct Candidate<'a> {
        listing_id: [u8; 32],
        spending_tx: &'a Tx,
    }
    let mut candidates: Vec<Candidate> = Vec::new();

    for tx in &block.tx {
        let Some(input0) = tx.vin.first() else {
            continue;
        };
        let (Some(prev_txid_hex), Some(prev_vout)) = (input0.txid.as_ref(), input0.vout) else {
            continue;
        };
        if prev_vout != 0 {
            continue;
        }
        let Some(script_sig) = input0.script_sig.as_ref() else {
            continue;
        };
        let Ok(unlocking_bytes) = hex::decode(&script_sig.hex) else {
            continue;
        };
        if !is_mpsw_spend_candidate(&unlocking_bytes) {
            continue;
        }
        let Ok(prev_txid_bytes) = hex::decode(prev_txid_hex) else {
            continue;
        };
        let Ok(listing_id) = <[u8; 32]>::try_from(prev_txid_bytes.as_slice()) else {
            continue;
        };
        candidates.push(Candidate {
            listing_id,
            spending_tx: tx,
        });
    }

    if candidates.is_empty() {
        return Ok(0);
    }

    let candidate_ids: Vec<[u8; 32]> = candidates.iter().map(|c| c.listing_id).collect();
    let open_offers = find_open_tapswap_offers_by_id(pool, &candidate_ids)
        .await
        .with_context(|| format!("lookup open tapswap offers at height {height}"))?;
    let by_id: std::collections::HashMap<[u8; 32], [u8; 20]> =
        open_offers.into_iter().map(|r| (r.id, r.maker_pkh)).collect();

    let block_time_ts = chrono::Utc
        .timestamp_opt(block.time, 0)
        .single()
        .ok_or_else(|| {
            anyhow::anyhow!("invalid block.time {} at height {}", block.time, height)
        })?;

    let mut close_batch: Vec<OfferCloseWrite> = Vec::new();
    for c in candidates {
        let Some(maker_pkh) = by_id.get(&c.listing_id) else {
            // Spend candidate but not an open listing of ours — could
            // be an unrelated tx that happens to embed the platform
            // PKH bytes, or a re-process of an already-closed listing.
            // Skip silently.
            continue;
        };
        let Some(out0) = c.spending_tx.vout.first() else {
            warn!(
                spending_tx = %c.spending_tx.txid,
                listing_id = %hex::encode(c.listing_id),
                "spend candidate has no outputs[0]; skipping"
            );
            continue;
        };
        let out0_bytes = match hex::decode(&out0.script_pub_key.hex) {
            Ok(b) => b,
            Err(e) => {
                warn!(
                    spending_tx = %c.spending_tx.txid,
                    listing_id = %hex::encode(c.listing_id),
                    error = %e,
                    "spending tx vout[0] hex decode failed; skipping close classification"
                );
                continue;
            }
        };
        let decoded = classify_close(&out0_bytes, maker_pkh);

        let Ok(closed_tx_bytes) = hex::decode(&c.spending_tx.txid) else {
            warn!(
                spending_tx = %c.spending_tx.txid,
                "spending tx txid hex invalid; skipping"
            );
            continue;
        };
        let Ok(closed_tx) = <[u8; 32]>::try_from(closed_tx_bytes.as_slice()) else {
            continue;
        };

        close_batch.push(OfferCloseWrite {
            id: c.listing_id,
            status: decoded.status.as_db_str(),
            taker_pkh: match decoded.status {
                CloseStatus::Taken => decoded.taker_pkh,
                CloseStatus::Cancelled => None,
            },
            closed_tx,
            closed_at: block_time_ts,
        });
    }

    if close_batch.is_empty() {
        return Ok(0);
    }

    apply_tapswap_closes(pool, &close_batch)
        .await
        .with_context(|| format!("apply tapswap closes at height {height}"))
}
