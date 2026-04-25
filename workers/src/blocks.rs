//! Per-block economics — pure Rust, no IO.
//!
//! Used by the live `sync-tail` walker (Pass 4) and the one-shot
//! `blocks-backfill` binary to derive the row stored in the `blocks` table:
//! tx count, coinbase output, total economic value transferred (sum of all
//! outputs minus the coinbase), implied fees, and block size. All fields
//! come from the verbose `getblock 2` response we already fetch for the
//! tokens and Tapswap walkers — no extra RPC calls.
//!
//! Tested exhaustively against constructed `Block` fixtures so the
//! financial math (especially the BCH halving schedule) doesn't rot
//! silently.

use crate::bchn::Block;

/// Genesis block subsidy in sats: 50 BCH. The kernel halves this every
/// `HALVING_INTERVAL` blocks.
pub const INITIAL_SUBSIDY_SATS: i64 = 50 * 100_000_000;

/// BCH halving cadence — every 210,000 blocks, identical to BTC's. After
/// the 33rd halving the subsidy becomes 0; we model that explicitly so
/// integer right-shift can't blow past i64::BITS.
pub const HALVING_INTERVAL: i64 = 210_000;

/// CashTokens activation height (May 2023). The /blocks page covers
/// everything from this block forward; pre-activation history is out of
/// scope. Single source of truth so the live walker (Pass 4) and the
/// `blocks-backfill` binary can't drift.
pub const ACTIVATION_HEIGHT: i32 = 792_772;

/// Cap halvings at 32 — `INITIAL_SUBSIDY_SATS >> 33 == 0` already, but
/// shifting an i64 by ≥ 64 is undefined behavior in C and a debug-panic
/// in Rust. The cap also gives us a stable answer for far-future heights
/// without bothering with chrono.
const MAX_HALVINGS: i64 = 32;

/// BCH block subsidy at `height` in sats.
///
/// Derivation: `INITIAL_SUBSIDY_SATS >> (height / HALVING_INTERVAL)`,
/// clamped at MAX_HALVINGS to avoid undefined right-shift on far-future
/// heights. Matches Bitcoin Core / BCHN's `GetBlockSubsidy`.
pub fn block_subsidy_sats(height: i64) -> i64 {
    if height < 0 {
        return 0;
    }
    let halvings = height / HALVING_INTERVAL;
    if halvings >= MAX_HALVINGS {
        return 0;
    }
    INITIAL_SUBSIDY_SATS >> halvings
}

/// One row's worth of block-economics, ready to be persisted by `pg::upsert_block`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockSummary {
    pub height: i32,
    /// Block hash as raw 32-byte array, big-endian display order — i.e.,
    /// `hex::decode(block.hash)` reversed? No: BCHN's `getblock` returns
    /// the hash in the conventional explorer-display orientation already,
    /// so we store the raw bytes from `hex::decode` directly. Callers who
    /// want a hex string `encode` them back.
    pub hash: [u8; 32],
    /// Unix epoch seconds — matches `Block.time`. Caller converts to
    /// `TIMESTAMPTZ` at the DB boundary.
    pub time: i64,
    pub tx_count: i32,
    /// Sum of every output across every NON-coinbase tx, in sats. Stored
    /// as String so callers can bind it to NUMERIC(30,0) without hitting
    /// i64 limits on busy blocks (a block at the BCH 32 MB cap could in
    /// principle exceed i64::MAX in summed output if every output were
    /// near the 21 M BCH ceiling — astronomically unlikely but possible).
    pub total_output_sats: String,
    pub coinbase_sats: i64,
    pub fees_sats: i64,
    pub subsidy_sats: i64,
    pub size_bytes: i32,
}

/// Errors `summarize_block` can return. Most are bounds-conversion failures
/// — the BCHN response's `height` is u64 and `size` is i64, but the DB
/// stores INTEGER (i32). Realistic blocks fit easily; we still type-check.
#[derive(Debug, thiserror::Error)]
pub enum BlockSummaryError {
    #[error("block.height {0} does not fit in i32")]
    HeightOverflow(u64),
    #[error("block.size {0} does not fit in i32")]
    SizeOverflow(i64),
    #[error("block.tx is empty (no coinbase)")]
    EmptyBlock,
    #[error("invalid hash hex: {0}")]
    InvalidHash(String),
    #[error("hash hex {0:?} is not 32 bytes")]
    HashWrongLength(usize),
}

/// Pure-Rust derivation of one `BlockSummary` from a parsed BCHN `Block`.
///
/// Output-sat sums use i128 internally to absorb any practical block size
/// without precision loss, then format to a decimal string at the boundary
/// for binding to NUMERIC(30,0). Sats-from-BCH-float conversion uses
/// `(value * 1e8).round() as i128` — for the positive 21 M BCH magnitudes
/// at 8 decimal places this is exact in IEEE-754 f64, the same
/// well-trodden assumption used elsewhere in the workers crate.
pub fn summarize_block(block: &Block) -> Result<BlockSummary, BlockSummaryError> {
    let height_i32: i32 = block
        .height
        .try_into()
        .map_err(|_| BlockSummaryError::HeightOverflow(block.height))?;
    let size_i32: i32 = block
        .size
        .try_into()
        .map_err(|_| BlockSummaryError::SizeOverflow(block.size))?;
    let tx_count: i32 = block.tx.len().min(i32::MAX as usize) as i32;
    if block.tx.is_empty() {
        return Err(BlockSummaryError::EmptyBlock);
    }

    // Coinbase = vout sum of tx[0]. Convert each output's BCH float to
    // sats individually then sum the integers — summing as f64 first
    // would compound IEEE-754 rounding error across multi-output
    // coinbases (real BCH coinbases typically have ≥ 2 outputs: the
    // miner payout plus a zero-value commitment for fork rule signaling).
    // i128 absorbs the sum; clamp to i64 at the boundary because the
    // schema column is BIGINT.
    let coinbase_sats_i128: i128 = block.tx[0]
        .vout
        .iter()
        .map(|v| bch_to_sats_i128(v.value))
        .sum();
    let coinbase_sats: i64 = coinbase_sats_i128.min(i64::MAX as i128) as i64;

    // Total economic value: sum every non-coinbase output. Same per-output
    // conversion pattern. i128 accumulator — can't overflow on any
    // realistic block.
    let mut total: i128 = 0;
    for tx in block.tx.iter().skip(1) {
        for vout in &tx.vout {
            total += bch_to_sats_i128(vout.value);
        }
    }
    let total_output_sats = total.to_string();

    let height_i64 = i64::from(height_i32);
    let subsidy_sats = block_subsidy_sats(height_i64);
    // Fees = coinbase output - subsidy. Negative would imply the coinbase
    // claimed less than the entitled subsidy (wasted-fee or burned-subsidy
    // miner — legal on BCH); the schema's BIGINT column is signed, so we
    // preserve the sign rather than clamp.
    let fees_sats = coinbase_sats.saturating_sub(subsidy_sats);

    let hash = decode_block_hash(&block.hash)?;

    Ok(BlockSummary {
        height: height_i32,
        hash,
        time: block.time,
        tx_count,
        total_output_sats,
        coinbase_sats,
        fees_sats,
        subsidy_sats,
        size_bytes: size_i32,
    })
}

fn decode_block_hash(s: &str) -> Result<[u8; 32], BlockSummaryError> {
    let bytes = hex::decode(s).map_err(|e| BlockSummaryError::InvalidHash(e.to_string()))?;
    if bytes.len() != 32 {
        return Err(BlockSummaryError::HashWrongLength(bytes.len()));
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Ok(out)
}

/// `(bch * 1e8).round() as i128` — exact for the positive 21 M BCH range
/// at 8 decimal places (IEEE-754 f64 has 52 mantissa bits = ~15.9
/// decimal digits, more than enough for 16-digit sat amounts in practice).
#[inline]
fn bch_to_sats_i128(bch: f64) -> i128 {
    if !bch.is_finite() || bch < 0.0 {
        return 0;
    }
    (bch * 1e8).round() as i128
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bchn::{Block, ScriptPubKey, Tx, Vin, Vout};

    fn vout(value: f64) -> Vout {
        Vout {
            token_data: None,
            script_pub_key: ScriptPubKey::default(),
            value,
        }
    }

    fn coinbase_tx(value: f64) -> Tx {
        Tx {
            txid: "00".repeat(32),
            vout: vec![vout(value)],
            // A single coinbase vin with no prev txid — matches what BCHN emits.
            vin: vec![Vin {
                txid: None,
                vout: None,
                script_sig: None,
            }],
        }
    }

    fn normal_tx(in_count: usize, vouts: Vec<f64>) -> Tx {
        Tx {
            txid: "11".repeat(32),
            vout: vouts.into_iter().map(vout).collect(),
            vin: (0..in_count)
                .map(|_| Vin {
                    txid: Some("22".repeat(32)),
                    vout: Some(0),
                    script_sig: None,
                })
                .collect(),
        }
    }

    fn block_at(height: u64, size: i64, txs: Vec<Tx>) -> Block {
        Block {
            hash: "ab".repeat(32),
            height,
            time: 1_700_000_000,
            tx: txs,
            size,
        }
    }

    // ---- subsidy ----

    #[test]
    fn subsidy_genesis_is_50_bch() {
        assert_eq!(block_subsidy_sats(0), 50 * 100_000_000);
    }

    #[test]
    fn subsidy_pre_first_halving() {
        // Last block before the first halving still pays 50 BCH.
        assert_eq!(block_subsidy_sats(209_999), 50 * 100_000_000);
    }

    #[test]
    fn subsidy_at_first_halving() {
        // Height 210_000 is the first 25 BCH block.
        assert_eq!(block_subsidy_sats(210_000), 25 * 100_000_000);
    }

    #[test]
    fn subsidy_at_third_halving() {
        // Height 630_000 → 4th era, 6.25 BCH = 625_000_000 sats.
        assert_eq!(block_subsidy_sats(630_000), 625_000_000);
    }

    #[test]
    fn subsidy_at_cashtokens_activation_is_625m_sats() {
        // Block 792_772 (CashTokens activation) is between halvings 3 (630k)
        // and 4 (840k) → 6.25 BCH per block. This is the floor for the
        // /blocks page.
        assert_eq!(block_subsidy_sats(792_772), 625_000_000);
    }

    #[test]
    fn subsidy_clamps_at_far_future_heights() {
        // Past 32 halvings (height ≥ 32 * 210_000 = 6_720_000) the subsidy
        // is 0. Verify both the boundary and a far-future value don't
        // panic on right-shift overflow.
        assert_eq!(block_subsidy_sats(6_720_000), 0);
        assert_eq!(block_subsidy_sats(i64::MAX), 0);
    }

    #[test]
    fn subsidy_negative_height_returns_zero() {
        assert_eq!(block_subsidy_sats(-1), 0);
    }

    // ---- summarize_block ----

    #[test]
    fn summarize_realistic_post_activation_block() {
        // Block at activation-height-ish: coinbase claims subsidy + 0.05 BCH
        // of fees; two normal txs move 1 BCH and 0.5 BCH respectively.
        let coinbase_value = 6.30; // 6.25 subsidy + 0.05 fees
        let block = block_at(
            792_780,
            45_000,
            vec![
                coinbase_tx(coinbase_value),
                normal_tx(1, vec![1.00, 0.0]), // change + something
                normal_tx(1, vec![0.50]),
            ],
        );
        let s = summarize_block(&block).expect("summarize ok");
        assert_eq!(s.height, 792_780);
        assert_eq!(s.tx_count, 3);
        assert_eq!(s.size_bytes, 45_000);
        assert_eq!(s.coinbase_sats, 630_000_000);
        assert_eq!(s.subsidy_sats, 625_000_000);
        assert_eq!(s.fees_sats, 5_000_000);
        // Total economic = 1.00 + 0.0 + 0.50 = 1.50 BCH.
        assert_eq!(s.total_output_sats, "150000000");
        assert_eq!(s.hash, [0xab; 32]);
    }

    #[test]
    fn summarize_coinbase_only_block_has_zero_economic_value() {
        // Realistic for very-early or completely-empty blocks.
        let block = block_at(800_000, 200, vec![coinbase_tx(6.25)]);
        let s = summarize_block(&block).expect("summarize ok");
        assert_eq!(s.tx_count, 1);
        assert_eq!(s.total_output_sats, "0");
        assert_eq!(s.coinbase_sats, 625_000_000);
        assert_eq!(s.fees_sats, 0);
    }

    #[test]
    fn summarize_empty_block_is_error() {
        // A block with no transactions is structurally invalid — every
        // BCH block has at least the coinbase.
        let block = block_at(900_000, 80, vec![]);
        let err = summarize_block(&block).unwrap_err();
        assert!(matches!(err, BlockSummaryError::EmptyBlock));
    }

    #[test]
    fn summarize_under_paying_coinbase_yields_negative_fees() {
        // Miner deliberately under-claimed the subsidy. BCH allows this
        // (the unclaimed sats are burned). fees_sats is signed so we
        // preserve the negative.
        let block = block_at(800_000, 250, vec![coinbase_tx(5.00), normal_tx(1, vec![0.10])]);
        let s = summarize_block(&block).expect("summarize ok");
        assert_eq!(s.subsidy_sats, 625_000_000);
        assert_eq!(s.coinbase_sats, 500_000_000);
        assert_eq!(s.fees_sats, -125_000_000);
        assert_eq!(s.total_output_sats, "10000000");
    }

    #[test]
    fn summarize_height_overflow_rejects() {
        let block = block_at(u64::from(u32::MAX) + 1, 80, vec![coinbase_tx(0.0)]);
        let err = summarize_block(&block).unwrap_err();
        assert!(matches!(err, BlockSummaryError::HeightOverflow(_)));
    }

    #[test]
    fn summarize_invalid_hash_hex_rejects() {
        let mut block = block_at(800_000, 250, vec![coinbase_tx(6.25)]);
        block.hash = "not-hex".to_string();
        assert!(matches!(
            summarize_block(&block).unwrap_err(),
            BlockSummaryError::InvalidHash(_)
        ));
    }

    #[test]
    fn summarize_multi_output_coinbase_sums_per_output_in_sats() {
        // Real BCH coinbases typically have 2 outputs: the miner payout
        // plus a zero-value commitment for fork rule signaling. A few
        // mining pools split into 3+. We must convert each output to
        // sats individually before summing — summing as f64 first would
        // compound rounding error across outputs.
        //
        // Pathological-on-paper input: 0.1 + 0.2 + 0.3 = 0.6 in math but
        // 0.6000000000000001 in IEEE-754 f64. Per-output conversion gets
        // us 10000000 + 20000000 + 30000000 = 60_000_000 sats exactly.
        let block = block_at(
            800_000,
            500,
            vec![
                Tx {
                    txid: "00".repeat(32),
                    vout: vec![vout(0.1), vout(0.2), vout(0.3)],
                    vin: vec![Vin {
                        txid: None,
                        vout: None,
                        script_sig: None,
                    }],
                },
                normal_tx(1, vec![1.0]),
            ],
        );
        let s = summarize_block(&block).expect("summarize ok");
        assert_eq!(s.coinbase_sats, 60_000_000, "per-output conversion expected");
        assert_eq!(s.total_output_sats, "100000000");
    }

    // ---- bch_to_sats_i128 boundary cases ----

    #[test]
    fn bch_to_sats_handles_nan_inf_negative_as_zero() {
        assert_eq!(bch_to_sats_i128(f64::NAN), 0);
        assert_eq!(bch_to_sats_i128(f64::INFINITY), 0);
        assert_eq!(bch_to_sats_i128(f64::NEG_INFINITY), 0);
        assert_eq!(bch_to_sats_i128(-1.0), 0);
        assert_eq!(bch_to_sats_i128(-0.00000001), 0);
    }

    #[test]
    fn bch_to_sats_zero_and_one_sat() {
        assert_eq!(bch_to_sats_i128(0.0), 0);
        assert_eq!(bch_to_sats_i128(0.00000001), 1);
        assert_eq!(bch_to_sats_i128(1.0), 100_000_000);
    }

    #[test]
    fn activation_height_constant_matches_plan() {
        // Single source of truth — Pass 4 in tail.rs and the backfill
        // binary both consume this. Asserting it here means a typo-fix
        // in one place can't silently de-sync the two binaries.
        assert_eq!(ACTIVATION_HEIGHT, 792_772);
    }

    #[test]
    fn summarize_short_hash_rejects() {
        let mut block = block_at(800_000, 250, vec![coinbase_tx(6.25)]);
        block.hash = "ab".repeat(16); // 16 bytes, not 32
        assert!(matches!(
            summarize_block(&block).unwrap_err(),
            BlockSummaryError::HashWrongLength(16)
        ));
    }
}
