//! Fex.cash AMM on-chain decoder — https://github.com/fex-cash/fex.
//!
//! Unlike Cauldron (public indexer at `indexer.cauldron.quest`), Fex has
//! no external API. We read the chain ourselves: every Fex pool's state
//! lives in a UTXO locked to a zero-parameter `AssetCovenant`, which
//! means every pool shares the same 25-byte P2SH locking bytecode. One
//! `scantxoutset` on BCHN with `raw(<p2sh_hex>)` returns the full
//! ecosystem.
//!
//! The `AssetCovenant` UTXO holds:
//! - BCH as the UTXO's sats (the `value` field, BCH float in BCHN JSON)
//! - ONE CashToken via `tokenData` (category + FT amount, never an NFT)
//!
//! Price (sats per smallest-token-unit) = `bch_sats / token_amount`.
//! TVL (sats, both sides by convention) = `bch_sats * 2`.
//!
//! Protocol reference verified end-to-end on 2026-04-24 against carson's
//! BCHN: `scantxoutset start [{desc:"raw(a9142b...d3687)"}]` returned 10
//! valid pool UTXOs spanning blocks 824,300 - 868,401.

use num_bigint::BigInt;

use crate::bchn::{ScanUnspent, TokenAmount};

/// The Fex `AssetCovenant` P2SH locking bytecode, shared across every
/// pool because the covenant takes zero constructor parameters.
///
/// Layout: `OP_HASH160 + push-20 + hash160(redeem_script) + OP_EQUAL`:
/// - `a9`             — OP_HASH160
/// - `14`             — push-20
/// - `2b...d36`       — hash160 of the compiled asset_covenant.cash
/// - `87`             — OP_EQUAL
///
/// Used as the descriptor `raw(<hex>)` passed to BCHN's scantxoutset.
pub const ASSET_COVENANT_P2SH_HEX: &str = "a9142b389120e9c741fbc5dbcd51fc4170d6640b9d3687";

/// The Fex `LpCovenant` P2SH locking bytecode. Holds LP tokens + fees.
/// Not decoded day-one (no user-facing value in the directory); kept
/// here so the follow-up work has a single place to pull the prefix.
#[allow(dead_code)]
pub const LP_COVENANT_P2SH_HEX: &str = "a91450cdb0005592816c4548e6e2b10071666ca64b4587";

/// Decoded Fex pool state. One per AssetCovenant UTXO.
#[derive(Debug, Clone, PartialEq)]
pub struct FexPool {
    /// The pool's token category (32 bytes).
    pub category: [u8; 32],
    /// Token-side reserve. Arbitrary-precision because a pool can legally
    /// hold FT amounts up to 2^63-1 per the CashTokens spec, and future
    /// amounts may exceed i64.
    pub token_amount: BigInt,
    /// BCH-side reserve in sats. Converted from the UTXO's `value` field
    /// (BCH float) via `(value * 1e8).round() as i64`. For the positive
    /// 21M-BCH magnitudes and 8-decimal values BCH uses, f64 is exact.
    pub bch_sats: i64,
    /// UTXO outpoint — kept for spend-detection follow-ups even though
    /// the day-one directory doesn't need it.
    pub utxo_txid: [u8; 32],
    pub utxo_vout: u32,
    /// Block height at which BCHN observed this unspent. Used as a "pool
    /// last active" proxy in the scanner's log summaries.
    pub discovered_height: i32,
}

/// Attempt to decode a `ScanUnspent` row (from
/// `scan_txoutset_by_raw_script`) into a `FexPool`.
///
/// Returns `None` on any protocol violation:
/// - No tokenData (every AssetCovenant UTXO carries a token).
/// - Missing FT amount, amount ≤ 0.
/// - An NFT commitment is present (protocol says AssetCovenants are
///   pure-fungible; an NFT here means the UTXO isn't a real pool).
/// - Malformed category hex.
/// - Negative or non-finite BCH value.
///
/// None is always safe — it means "skip this row," not a hard error.
/// The scanner logs a debug line and moves on.
pub fn try_decode_asset_utxo(u: &ScanUnspent) -> Option<FexPool> {
    let token = u.token_data.as_ref()?;
    if token.nft.is_some() {
        return None;
    }
    let amount_str = match token.amount.as_ref()? {
        TokenAmount::Text(s) => s.clone(),
        TokenAmount::Number(n) => n.to_string(),
    };
    let token_amount: BigInt = amount_str.parse().ok()?;
    if token_amount.sign() != num_bigint::Sign::Plus {
        return None;
    }

    let category_bytes = hex::decode(&token.category).ok()?;
    let category: [u8; 32] = category_bytes.try_into().ok()?;

    if !u.amount.is_finite() || u.amount < 0.0 {
        return None;
    }
    let bch_sats = (u.amount * 1e8).round() as i64;
    if bch_sats <= 0 {
        return None;
    }

    let txid_bytes = hex::decode(&u.txid).ok()?;
    let utxo_txid: [u8; 32] = txid_bytes.try_into().ok()?;

    let discovered_height: i32 = i32::try_from(u.height).ok()?;

    Some(FexPool {
        category,
        token_amount,
        bch_sats,
        utxo_txid,
        utxo_vout: u.vout,
        discovered_height,
    })
}

/// Maximum token-amount BigInt the f64 price computation can represent
/// without precision loss. f64 has a 53-bit mantissa, so any integer
/// 0 ≤ n ≤ 2^53 round-trips exactly through `to_string().parse()`.
/// Past that boundary the conversion silently rounds — and persisting a
/// rounded price into `token_venue_listings` corrupts the column. We'd
/// rather skip a pool than store a quietly-wrong price.
///
/// 2^53 = 9_007_199_254_740_992. Today's largest Fex pool's token
/// reserve is ~2.3e13, three orders of magnitude under the cap. The
/// guard exists so a future pool with an unusually large supply doesn't
/// silently corrupt downstream rendering.
const F64_INTEGER_PRECISION_LIMIT: u64 = 1 << 53;

/// Price in sats-per-smallest-token-unit. Returns `None` when the token
/// reserve is zero, or when its magnitude exceeds f64's exact-integer
/// range. Matches the `f64` precision Cauldron uses for its price column,
/// so downstream code can treat them uniformly.
///
/// Kept as a free function (rather than a method on FexPool) because
/// callers typically compute price + TVL together with different
/// lifetime requirements on the pool reference.
pub fn price_sats(pool: &FexPool) -> Option<f64> {
    use num_traits::Zero;
    if pool.token_amount.is_zero() {
        return None;
    }
    if pool.token_amount.sign() == num_bigint::Sign::Minus {
        return None;
    }
    // Reject token amounts past f64's exact-integer range. See the
    // F64_INTEGER_PRECISION_LIMIT comment above.
    if pool.token_amount > BigInt::from(F64_INTEGER_PRECISION_LIMIT) {
        return None;
    }
    // BigInt → f64 via `to_string().parse()`: BigInt::to_f64 exists in
    // num_traits but adds a feature. Going via format! avoids a new dep
    // for the one place we need it. Precision is bounded by the guard
    // above.
    let tok: f64 = pool.token_amount.to_string().parse().ok()?;
    if tok <= 0.0 {
        return None;
    }
    Some(pool.bch_sats as f64 / tok)
}

/// TVL in sats — the **single-side BCH reserve**. Cauldron stores its
/// `tvl_satoshis` column the same way (the BCH-side `valuelocked` value
/// straight from their indexer) and the UI's `formatVenueTvlUSD` /
/// detail-page renderers apply the `* 2` doubled-sides convention at
/// display time. Returning the doubled value here would silently double-
/// count when any future render path treated the column uniformly across
/// venues.
pub fn tvl_sats(pool: &FexPool) -> i64 {
    pool.bch_sats
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bchn::{Nft, NftCapability, TokenData};

    fn mk_unspent(category_hex: &str, amount: TokenAmount, bch: f64) -> ScanUnspent {
        ScanUnspent {
            txid: "0".repeat(64),
            vout: 0,
            height: 850_000,
            token_data: Some(TokenData {
                category: category_hex.to_string(),
                amount: Some(amount),
                nft: None,
            }),
            amount: bch,
        }
    }

    #[test]
    fn decodes_happy_path() {
        let u = mk_unspent(
            "0838f27713c6ef89abcdef0123456789abcdef0123456789abcdef0123456789",
            TokenAmount::Text("23183417958540".into()),
            15.0989,
        );
        let p = try_decode_asset_utxo(&u).expect("should decode");
        assert_eq!(p.bch_sats, 1_509_890_000);
        assert_eq!(p.token_amount.to_string(), "23183417958540");
        // Price: 1,509,890,000 / 23,183,417,958,540 ≈ 6.5125e-5 sats/unit
        let px = price_sats(&p).unwrap();
        assert!((px - (1_509_890_000f64 / 23_183_417_958_540f64)).abs() < 1e-12);
        // Single-side TVL — matches what Cauldron stores. Doubled-sides
        // convention is applied at the UI render layer (formatVenueTvlUSD
        // multiplies by 2). Storing single-side here keeps the column's
        // semantic uniform across venues.
        assert_eq!(tvl_sats(&p), 1_509_890_000);
    }

    #[test]
    fn rejects_utxo_with_no_token() {
        let u = ScanUnspent {
            txid: "0".repeat(64),
            vout: 0,
            height: 1,
            token_data: None,
            amount: 1.0,
        };
        assert!(try_decode_asset_utxo(&u).is_none());
    }

    #[test]
    fn rejects_utxo_with_nft_commitment() {
        // AssetCovenants are protocol-forbidden from holding NFTs. If
        // we find one here, it's not a real pool — maybe a P2SH collision
        // or a malformed test tx. Reject.
        let mut u = mk_unspent(
            "0838f27713c6ef89abcdef0123456789abcdef0123456789abcdef0123456789",
            TokenAmount::Text("1".into()),
            1.0,
        );
        if let Some(td) = u.token_data.as_mut() {
            td.nft = Some(Nft {
                capability: NftCapability::None,
                commitment: "deadbeef".into(),
            });
        }
        assert!(try_decode_asset_utxo(&u).is_none());
    }

    #[test]
    fn rejects_zero_and_negative_token_amounts() {
        let u0 = mk_unspent(
            "0838f27713c6ef89abcdef0123456789abcdef0123456789abcdef0123456789",
            TokenAmount::Text("0".into()),
            1.0,
        );
        assert!(try_decode_asset_utxo(&u0).is_none());

        let uneg = mk_unspent(
            "0838f27713c6ef89abcdef0123456789abcdef0123456789abcdef0123456789",
            TokenAmount::Text("-500".into()),
            1.0,
        );
        assert!(try_decode_asset_utxo(&uneg).is_none());
    }

    #[test]
    fn rejects_zero_bch_side() {
        let u = mk_unspent(
            "0838f27713c6ef89abcdef0123456789abcdef0123456789abcdef0123456789",
            TokenAmount::Text("1000".into()),
            0.0,
        );
        assert!(try_decode_asset_utxo(&u).is_none());
    }

    #[test]
    fn rejects_negative_or_non_finite_bch() {
        let u = mk_unspent(
            "0838f27713c6ef89abcdef0123456789abcdef0123456789abcdef0123456789",
            TokenAmount::Text("1000".into()),
            -1.0,
        );
        assert!(try_decode_asset_utxo(&u).is_none());

        let u2 = mk_unspent(
            "0838f27713c6ef89abcdef0123456789abcdef0123456789abcdef0123456789",
            TokenAmount::Text("1000".into()),
            f64::NAN,
        );
        assert!(try_decode_asset_utxo(&u2).is_none());
    }

    #[test]
    fn rejects_malformed_category_hex() {
        let u = mk_unspent(
            "not-hex-at-all",
            TokenAmount::Text("1000".into()),
            1.0,
        );
        assert!(try_decode_asset_utxo(&u).is_none());

        // Wrong length (31 bytes).
        let u2 = mk_unspent(
            &"aa".repeat(31),
            TokenAmount::Text("1000".into()),
            1.0,
        );
        assert!(try_decode_asset_utxo(&u2).is_none());
    }

    #[test]
    fn accepts_integer_token_amount_variant() {
        // BCHN may emit the FT amount as a JSON number for small values;
        // TokenAmount::Number should decode identically to the Text form.
        let u = mk_unspent(
            "0838f27713c6ef89abcdef0123456789abcdef0123456789abcdef0123456789",
            TokenAmount::Number(200_000_000),
            0.002,
        );
        let p = try_decode_asset_utxo(&u).expect("should decode");
        assert_eq!(p.bch_sats, 200_000);
        assert_eq!(p.token_amount.to_string(), "200000000");
    }

    #[test]
    fn price_returns_none_on_token_amount_past_f64_limit() {
        // 2^54 sits one bit past the exact-integer mantissa range; the
        // f64 round-trip of a near-by integer like 2^54 + 3 silently
        // rounds to a different integer. We refuse to compute a price
        // in that regime so the `token_venue_listings.price_sats` column
        // never holds a quietly-corrupted value.
        let p = FexPool {
            category: [0u8; 32],
            token_amount: BigInt::from(1_u128 << 54),
            bch_sats: 1_000_000,
            utxo_txid: [0u8; 32],
            utxo_vout: 0,
            discovered_height: 1,
        };
        assert!(price_sats(&p).is_none());

        // Just-at-the-limit (2^53) should still succeed: the boundary
        // value itself round-trips exactly.
        let p_at_limit = FexPool {
            category: [0u8; 32],
            token_amount: BigInt::from(1_u64 << 53),
            bch_sats: 1_000_000,
            utxo_txid: [0u8; 32],
            utxo_vout: 0,
            discovered_height: 1,
        };
        assert!(price_sats(&p_at_limit).is_some());
    }

    #[test]
    fn price_returns_none_on_zero_token_reserve() {
        // Can't construct via try_decode_asset_utxo (it rejects zero),
        // so assemble a FexPool directly to exercise the guard.
        let p = FexPool {
            category: [0u8; 32],
            token_amount: BigInt::from(0),
            bch_sats: 1_000_000,
            utxo_txid: [0u8; 32],
            utxo_vout: 0,
            discovered_height: 1,
        };
        assert!(price_sats(&p).is_none());
    }

    #[test]
    fn tvl_equals_bch_reserve_single_side() {
        let p = FexPool {
            category: [0u8; 32],
            token_amount: BigInt::from(1),
            bch_sats: 123_456_789,
            utxo_txid: [0u8; 32],
            utxo_vout: 0,
            discovered_height: 1,
        };
        // Stored as single-side; UI doubles at render. Matches Cauldron.
        assert_eq!(tvl_sats(&p), 123_456_789);
    }

    #[test]
    fn constant_p2sh_has_correct_shape() {
        // Sanity-check the constants haven't been corrupted:
        // Standard P2SH = 23 bytes = 46 hex chars:
        // OP_HASH160 (a9) + push-20 (14) + 20-byte hash + OP_EQUAL (87).
        assert_eq!(ASSET_COVENANT_P2SH_HEX.len(), 46);
        assert!(ASSET_COVENANT_P2SH_HEX.starts_with("a914"));
        assert!(ASSET_COVENANT_P2SH_HEX.ends_with("87"));
        assert_eq!(LP_COVENANT_P2SH_HEX.len(), 46);
        assert!(LP_COVENANT_P2SH_HEX.starts_with("a914"));
        assert!(LP_COVENANT_P2SH_HEX.ends_with("87"));
    }
}
