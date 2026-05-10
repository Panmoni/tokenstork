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
    /// Raw bytes of the coinbase tx's scriptSig (BCHN emits this as the
    /// `coinbase` field of vin[0] on the coinbase tx). None when the
    /// upstream JSON omits it (defensive — every legit coinbase has
    /// one). Stored as BYTEA so /mining can ASCII-substring-match for
    /// well-known mining-pool tags ("ViaBTC", "AntPool", etc.).
    pub coinbase_script_sig: Option<Vec<u8>>,
    /// Number of txs in the block with at least one vout carrying
    /// token_data. Backs the /stats "Token activity (24h)" card.
    /// Coinbase excluded.
    pub token_tx_count: i32,
    /// Count of NEW CATEGORIES created in this block. Per the CashTokens
    /// CHIP, a category id is the txid of the prevout being spent at
    /// outpoint index 0 — and ANY input of the tx may carry that
    /// index-0 spend (not just vin[0], despite an early misreading of
    /// the spec). Pure-chain detection; no DB lookup. Backs the /stats
    /// "New categories" card. Counts categories, not transactions: a
    /// single tx that mints two distinct categories (two vins with
    /// vout=0, each parent's txid present in some vout's td.category)
    /// contributes 2 to this counter. Goes hand-in-hand with the
    /// existing tokens table where `tokens.category` is the parent
    /// UTXO's txid and `tokens.genesis_txid` is this tx's own txid.
    pub genesis_tx_count: i32,
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

    // Coinbase scriptSig — pulled from the first vin of the first tx.
    // Every legitimate block has it. Decode hex; on failure we drop the
    // field rather than rejecting the row (a /mining attribution miss is
    // a much smaller harm than losing the per-block economics row).
    let coinbase_script_sig = block
        .tx[0]
        .vin
        .first()
        .and_then(|v| v.coinbase.as_deref())
        .and_then(|hex_str| hex::decode(hex_str).ok());

    // CashToken activity counters. Both pure-chain (no DB / no extra RPC):
    //   - token_tx_count: any non-coinbase tx with ≥1 vout carrying token_data.
    //   - genesis_tx_count: count of NEW CATEGORIES created in this block
    //     (one entry per distinct genesis publication, even when multiple
    //     categories are created in the same tx). Per the CashTokens CHIP,
    //     a category id is the txid of the prevout being spent at outpoint
    //     index 0 — and ANY input of a tx may carry that index-0 spend
    //     (not just vin[0]). The empirical pattern on chain: many tokens
    //     are minted by txs whose vin[0] is a BCH-funding input and the
    //     genesis-eligible spend is on vin[1] or later. So we scan every
    //     vin with vout==0, gather the candidate parent_txids, and count
    //     a distinct category whenever any vout's td.category matches one
    //     of those candidates. A given (parent_txid, vout=0) outpoint can
    //     be spent only once, so duplicates within a tx are impossible —
    //     but we de-dup with a HashSet for safety against malformed RPC
    //     responses.
    //
    //     History note: earlier revisions of this counter checked only
    //     vin[0] (the 2026-05-09 launch counted 15,619 of an actual
    //     ~16,255 tokens — 96% recall). The current scan-all-vins
    //     formulation closes the gap.
    let mut token_tx_count: i32 = 0;
    let mut genesis_tx_count: i32 = 0;
    let mut new_categories_in_tx: std::collections::HashSet<&str> = std::collections::HashSet::new();
    for tx in block.tx.iter().skip(1) {
        let has_token_vout = tx.vout.iter().any(|v| v.token_data.is_some());
        if has_token_vout {
            token_tx_count = token_tx_count.saturating_add(1);
        }
        new_categories_in_tx.clear();
        for vin in &tx.vin {
            if vin.vout.is_none_or(|n| n != 0) {
                continue;
            }
            let Some(parent_txid) = vin.txid.as_deref() else {
                continue;
            };
            // Does any vout in this tx mint a token whose category id
            // is this parent's txid? If so, the parent's index-0 outpoint
            // is being consumed to genesis a new category.
            let matched = tx.vout.iter().any(|v| {
                v.token_data
                    .as_ref()
                    .is_some_and(|td| td.category == parent_txid)
            });
            if matched {
                new_categories_in_tx.insert(parent_txid);
            }
        }
        genesis_tx_count = genesis_tx_count.saturating_add(new_categories_in_tx.len() as i32);
    }

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
        coinbase_script_sig,
        token_tx_count,
        genesis_tx_count,
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

// ---------------------------------------------------------------------------
// Miner-pool attribution
// ---------------------------------------------------------------------------

/// One entry in the well-known-pool table.
struct MinerPoolTag {
    name: &'static str,
    /// ASCII bytes that should appear somewhere in the coinbase scriptSig.
    /// We do a contains-check rather than a prefix/suffix because mining
    /// pools embed their tag mid-script around the height + extranonce.
    needle: &'static [u8],
}

/// Well-known BCH mining pools, in priority order. First match wins, so
/// pools with more-specific tags should appear before generic ones. The
/// list is hand-curated from observed coinbase strings on BCH; expand as
/// new pools land. Misses bucket as `None` ("Unknown") in the UI.
const KNOWN_POOLS: &[MinerPoolTag] = &[
    MinerPoolTag { name: "ViaBTC",        needle: b"/ViaBTC/" },
    MinerPoolTag { name: "AntPool",       needle: b"/AntPool/" },
    MinerPoolTag { name: "F2Pool",        needle: b"/F2Pool/" },
    MinerPoolTag { name: "BTC.com",       needle: b"/BTC.COM/" },
    MinerPoolTag { name: "Foundry USA",   needle: b"Foundry USA Pool" },
    MinerPoolTag { name: "Mining-Dutch",  needle: b"Mining-Dutch" },
    MinerPoolTag { name: "Binance Pool",  needle: b"binance/pool" },
    MinerPoolTag { name: "BTC.TOP",       needle: b"BTC.TOP" },
    MinerPoolTag { name: "Mara Pool",     needle: b"MARA Pool" },
    MinerPoolTag { name: "Luxor",         needle: b"luxor.tech" },
    MinerPoolTag { name: "ULTIMUSPOOL",   needle: b"ULTIMUSPOOL" },
    MinerPoolTag { name: "SBI Crypto",    needle: b"SBICrypto.com" },
    MinerPoolTag { name: "Solo CKPool",   needle: b"/solo.ckpool.org/" },
    // Generic ckpool catches non-solo deployments.
    MinerPoolTag { name: "CKPool",        needle: b"ckpool" },
    // EMC2pool / 2miners / etc. — add as observed.
    MinerPoolTag { name: "2Miners",       needle: b"2miners.com" },
];

/// Identify the mining pool that produced a block from its coinbase
/// scriptSig. Returns the canonical pool name when a known tag matches,
/// or `None` for "Unknown" (solo / private pool / unrecognized tag).
///
/// Matching is byte-substring, case-sensitive — pools standardize on
/// specific casings of their own tags so case-insensitive matching
/// would risk collisions (e.g., "viaBTC" in a non-pool context).
pub fn identify_miner_pool(coinbase_script_sig: &[u8]) -> Option<&'static str> {
    for pool in KNOWN_POOLS {
        if contains_bytes(coinbase_script_sig, pool.needle) {
            return Some(pool.name);
        }
    }
    None
}

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    // Standard contains-substring semantics: an empty needle matches
    // everywhere (vacuously); a needle longer than the haystack can't
    // match. Without this guard, `slice::windows(0)` panics outright
    // and `haystack.windows(big_n)` would yield no windows but the
    // earlier (buggy) early-return claimed "match" for any pool whose
    // needle was longer than a short coinbase scriptSig — every block
    // attributed to whichever pool came first in the table with a
    // long-enough needle.
    if needle.is_empty() {
        return true;
    }
    if haystack.len() < needle.len() {
        return false;
    }
    haystack.windows(needle.len()).any(|w| w == needle)
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

    /// Token-bearing vout for activity-counter tests. The category id is
    /// arbitrary — just needs to be a 64-char hex string.
    fn vout_with_token_category(value: f64, category: &str) -> Vout {
        use crate::bchn::TokenData;
        Vout {
            token_data: Some(TokenData {
                category: category.to_string(),
                amount: None,
                nft: None,
            }),
            script_pub_key: ScriptPubKey::default(),
            value,
        }
    }

    /// Genesis-tx helper. Per the CashTokens CHIP, a genesis tx (a) has
    /// vin[0] spending vout=0 of a prior tx, and (b) emits at least one
    /// token_data vout whose category equals **vin[0].txid** — the txid
    /// of the parent UTXO being spent (the category id IS the parent's
    /// txid by spec; see also tokens.category vs tokens.genesis_txid in
    /// the schema where category == parent_txid and genesis_txid == this
    /// tx's own txid).
    fn genesis_tx(self_txid_hex: &str, parent_txid_hex: &str) -> Tx {
        Tx {
            txid: self_txid_hex.to_string(),
            // td.category MUST equal parent_txid_hex per spec — that's
            // the rule that makes this tx the genesis of a new category.
            vout: vec![vout_with_token_category(0.001, parent_txid_hex)],
            vin: vec![Vin {
                txid: Some(parent_txid_hex.to_string()),
                vout: Some(0), // genesis: spend index-0
                script_sig: None,
                coinbase: None,
            }],
        }
    }

    /// Token-bearing transfer (NOT genesis): vin[0] spends a non-zero
    /// index, OR td.category doesn't equal vin[0].txid (i.e. the tx
    /// transfers an existing category, it's not creating one). Used to
    /// verify token_tx_count counts these but genesis_tx_count does not.
    fn token_transfer_tx(self_txid_hex: &str, prev_vout_index: u32, category: &str) -> Tx {
        Tx {
            txid: self_txid_hex.to_string(),
            vout: vec![vout_with_token_category(0.001, category)],
            vin: vec![Vin {
                txid: Some("44".repeat(32)),
                vout: Some(prev_vout_index),
                script_sig: None,
                coinbase: None,
            }],
        }
    }

    fn coinbase_tx(value: f64) -> Tx {
        coinbase_tx_with_script(value, None)
    }

    fn coinbase_tx_with_script(value: f64, coinbase_hex: Option<&str>) -> Tx {
        Tx {
            txid: "00".repeat(32),
            vout: vec![vout(value)],
            // A single coinbase vin with no prev txid — matches what BCHN emits.
            // Optional `coinbase` hex carries the miner-pool tag.
            vin: vec![Vin {
                txid: None,
                vout: None,
                script_sig: None,
                coinbase: coinbase_hex.map(String::from),
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
                    coinbase: None,
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

    // ---- activity counters (token_tx_count + genesis_tx_count) ----

    #[test]
    fn counters_zero_when_no_token_txs() {
        // Plain BCH-only block: coinbase + two non-token transfers.
        let block = block_at(
            800_000,
            1_000,
            vec![coinbase_tx(6.25), normal_tx(1, vec![1.0]), normal_tx(1, vec![0.5])],
        );
        let s = summarize_block(&block).expect("summarize ok");
        assert_eq!(s.token_tx_count, 0);
        assert_eq!(s.genesis_tx_count, 0);
    }

    #[test]
    fn counters_recognize_genesis_tx() {
        // Pure genesis-tx block: coinbase + one tx that mints a new
        // category. The category id == vin[0].txid (parent of the
        // outpoint being spent at index 0), per CashTokens CHIP. Both
        // counters should be 1.
        let parent = "11".repeat(32);
        let self_txid = "55".repeat(32);
        let block = block_at(
            800_000,
            2_000,
            vec![coinbase_tx(6.25), genesis_tx(&self_txid, &parent)],
        );
        let s = summarize_block(&block).expect("summarize ok");
        assert_eq!(s.token_tx_count, 1);
        assert_eq!(s.genesis_tx_count, 1);
    }

    #[test]
    fn counters_token_transfer_is_activity_but_not_genesis() {
        // A token-bearing tx where vin[0].vout != 0 is a transfer, not
        // a genesis. token_tx_count counts it; genesis_tx_count doesn't.
        let block = block_at(
            800_000,
            2_000,
            vec![
                coinbase_tx(6.25),
                token_transfer_tx(&"66".repeat(32), 1, &"77".repeat(32)),
            ],
        );
        let s = summarize_block(&block).expect("summarize ok");
        assert_eq!(s.token_tx_count, 1);
        assert_eq!(s.genesis_tx_count, 0);
    }

    #[test]
    fn counters_index_0_spend_with_unrelated_category_is_not_genesis() {
        // vin[0].vout == 0 BUT td.category doesn't equal vin[0].txid.
        // This is a transfer of an EXISTING category that happens to
        // also spend a parent's index-0 output (e.g. a transfer chain
        // that flows through index-0 outputs). The genesis of that
        // category was a different earlier tx — this one isn't creating
        // anything new, so genesis_tx_count must NOT count it.
        let parent = "33".repeat(32);
        let self_txid = "88".repeat(32);
        let other_category = "99".repeat(32);
        // Custom: vin[0] spends parent at index 0, but vouts carry an
        // unrelated category id (the existing category being transferred).
        let tx = Tx {
            txid: self_txid,
            vout: vec![vout_with_token_category(0.001, &other_category)],
            vin: vec![Vin {
                txid: Some(parent),
                vout: Some(0),
                script_sig: None,
                coinbase: None,
            }],
        };
        let block = block_at(800_000, 2_000, vec![coinbase_tx(6.25), tx]);
        let s = summarize_block(&block).expect("summarize ok");
        assert_eq!(s.token_tx_count, 1);
        assert_eq!(s.genesis_tx_count, 0);
    }

    #[test]
    fn counters_mixed_block() {
        // Realistic mixed block: coinbase + 2 BCH-only + 1 genesis +
        // 2 token transfers. token_tx_count = 3; genesis_tx_count = 1.
        let parent = "aa".repeat(32);
        let genesis_self = "bb".repeat(32);
        let block = block_at(
            800_000,
            10_000,
            vec![
                coinbase_tx(6.25),
                normal_tx(1, vec![1.0]),
                normal_tx(1, vec![0.5]),
                genesis_tx(&genesis_self, &parent),
                token_transfer_tx(&"cc".repeat(32), 1, &"dd".repeat(32)),
                token_transfer_tx(&"ee".repeat(32), 2, &"ff".repeat(32)),
            ],
        );
        let s = summarize_block(&block).expect("summarize ok");
        assert_eq!(s.token_tx_count, 3);
        assert_eq!(s.genesis_tx_count, 1);
    }

    #[test]
    fn counters_recognize_genesis_via_non_vin_0() {
        // On-chain pattern observed at carson 2026-05-10: tx
        // 6995ace8…d3e3 has vin[0] spending an unrelated parent at
        // index 0 AND vin[1] spending the genesis-eligible parent at
        // index 0. The minted category id == vin[1].txid. Earlier
        // detection that only checked vin[0] missed this entirely —
        // gap of 636 categories across the chain history.
        let unrelated_parent = "11".repeat(32);
        let genesis_parent = "22".repeat(32);
        let self_txid = "ff".repeat(32);
        let tx = Tx {
            txid: self_txid,
            // The genesis-eligible category id == vin[1].txid (genesis_parent).
            vout: vec![vout_with_token_category(0.001, &genesis_parent)],
            vin: vec![
                Vin {
                    txid: Some(unrelated_parent),
                    vout: Some(0), // index-0 but parent's txid doesn't appear in any vout
                    script_sig: None,
                    coinbase: None,
                },
                Vin {
                    txid: Some(genesis_parent),
                    vout: Some(0), // the actual genesis input
                    script_sig: None,
                    coinbase: None,
                },
            ],
        };
        let block = block_at(800_000, 2_000, vec![coinbase_tx(6.25), tx]);
        let s = summarize_block(&block).expect("summarize ok");
        assert_eq!(s.token_tx_count, 1);
        assert_eq!(
            s.genesis_tx_count, 1,
            "genesis via vin[1] should be detected"
        );
    }

    #[test]
    fn counters_multi_category_per_tx_counts_each() {
        // A single tx that mints TWO distinct categories: vin[0] and
        // vin[1] both spend index-0 outpoints, AND the tx emits two
        // vouts whose categories match each parent's txid. The counter
        // is category-granular, so this contributes 2 (matches the
        // tokens-table row count for the same block).
        let parent_a = "aa".repeat(32);
        let parent_b = "bb".repeat(32);
        let self_txid = "cc".repeat(32);
        let tx = Tx {
            txid: self_txid,
            vout: vec![
                vout_with_token_category(0.001, &parent_a),
                vout_with_token_category(0.001, &parent_b),
            ],
            vin: vec![
                Vin {
                    txid: Some(parent_a),
                    vout: Some(0),
                    script_sig: None,
                    coinbase: None,
                },
                Vin {
                    txid: Some(parent_b),
                    vout: Some(0),
                    script_sig: None,
                    coinbase: None,
                },
            ],
        };
        let block = block_at(800_000, 2_000, vec![coinbase_tx(6.25), tx]);
        let s = summarize_block(&block).expect("summarize ok");
        assert_eq!(s.token_tx_count, 1);
        assert_eq!(s.genesis_tx_count, 2, "two categories minted in one tx");
    }

    #[test]
    fn counters_skip_coinbase() {
        // Even if the coinbase had a phantom token_data (impossible in
        // practice but defensive), the counter loop skips block.tx[0].
        let mut block = block_at(800_000, 1_000, vec![coinbase_tx(6.25)]);
        block.tx[0].vout = vec![vout_with_token_category(6.25, &"ff".repeat(32))];
        let s = summarize_block(&block).expect("summarize ok");
        assert_eq!(s.token_tx_count, 0);
        assert_eq!(s.genesis_tx_count, 0);
    }

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
                        coinbase: None,
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

    // ---- coinbase scriptSig + miner-pool attribution ----

    #[test]
    fn summarize_extracts_coinbase_script_sig_when_present() {
        // hex of "/ViaBTC/Mined by user1234/" surrounded by realistic
        // height-push + extranonce bytes
        let coinbase_hex = "03c0fd0b04362f566961425443214d696e656420627920757365723132333442fabe6d6d";
        let block = block_at(
            800_000,
            300,
            vec![
                coinbase_tx_with_script(6.25, Some(coinbase_hex)),
                normal_tx(1, vec![1.0]),
            ],
        );
        let s = summarize_block(&block).expect("summarize ok");
        assert!(s.coinbase_script_sig.is_some());
        let bytes = s.coinbase_script_sig.unwrap();
        assert_eq!(bytes, hex::decode(coinbase_hex).unwrap());
    }

    #[test]
    fn summarize_handles_missing_coinbase_field() {
        // BCHN should always emit `coinbase` on vin[0] but treat it as
        // optional defensively. `coinbase_tx` (without _with_script) emits
        // a Vin without a coinbase field.
        let block = block_at(800_000, 200, vec![coinbase_tx(6.25)]);
        let s = summarize_block(&block).expect("summarize ok");
        assert_eq!(s.coinbase_script_sig, None);
    }

    #[test]
    fn identify_miner_pool_recognizes_well_known_tags() {
        // Real-world coinbase strings observed on BCH (ASCII portion only;
        // the actual bytes are a hex string with mining-pool tag embedded
        // alongside height/nonce bytes).
        assert_eq!(identify_miner_pool(b"\x03\x12\x34\x56/ViaBTC/Mined/"), Some("ViaBTC"));
        assert_eq!(identify_miner_pool(b"abc/AntPool/v0.5/"), Some("AntPool"));
        assert_eq!(identify_miner_pool(b"prefixFoundry USA Pool"), Some("Foundry USA"));
        assert_eq!(identify_miner_pool(b"Mining-Dutch.nl"), Some("Mining-Dutch"));
        assert_eq!(identify_miner_pool(b"/solo.ckpool.org/"), Some("Solo CKPool"));
        // CKPool catches the generic case
        assert_eq!(identify_miner_pool(b"ckpool stuff"), Some("CKPool"));
    }

    #[test]
    fn identify_miner_pool_returns_none_for_unknown_tags() {
        assert_eq!(identify_miner_pool(b""), None);
        assert_eq!(identify_miner_pool(b"\x03\x12\x34\x56"), None); // height-only, no tag
        assert_eq!(identify_miner_pool(b"some random miner"), None);
    }

    #[test]
    fn identify_miner_pool_is_case_sensitive() {
        // Pool tags are intentionally case-sensitive. "viaBTC" lowercase
        // shouldn't match because real ViaBTC blocks always emit the
        // CamelCase form. Lowering case would risk false-positives where
        // a non-pool string happens to contain a substring.
        assert_eq!(identify_miner_pool(b"/viabtc/"), None);
        assert_eq!(identify_miner_pool(b"/VIABTC/"), None);
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
