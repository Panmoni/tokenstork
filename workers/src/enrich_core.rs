//! Shared enrichment aggregation — turns a category's live token-UTXO set into
//! the `token_state` / `token_holders` / `nft_instances` write payload.
//!
//! Both enrichment upstreams normalize into [`AggInput`] and call
//! [`aggregate`], so they produce **byte-identical** results:
//!   - the legacy BlockBook `enrich` binary (maps each `blockbook::Utxo`), and
//!   - the event-driven path (maps each `live_token_utxo` row).
//! That equivalence is the precondition for safely shadow-comparing the new
//! path against the old before cutover (see docs/enrich-event-driven-design.md).
//!
//! Extracted verbatim from `bin/enrich.rs`; the aggregation/gini logic is
//! unchanged. The only shape change is that amount parsing + commitment hex
//! decoding now happen when the caller builds [`AggInput`] (and propagate their
//! errors there), so `aggregate` itself is infallible.

use std::collections::HashMap;

use num_bigint::BigInt;
use num_traits::{ToPrimitive, Zero};

use crate::bchn::NftCapability;
use crate::blockbook::normalize_address;
use crate::pg::NftWrite;

/// One live token UTXO, normalized for aggregation.
pub struct AggInput {
    /// Owner address; `normalize_address` is applied inside [`aggregate`], so
    /// either the prefixed (`bitcoincash:…`) or bare form is accepted. `None`
    /// for nonstandard scripts (counts toward supply, attributes to no holder).
    pub address: Option<String>,
    pub amount: BigInt,
    pub nft: Option<AggNft>,
}

pub struct AggNft {
    pub capability: NftCapability,
    /// Raw commitment bytes; empty = malformed NFT (excluded from `nfts[]` but
    /// still counted in `live_nft_count` / holder `nft_count`, matching the
    /// original BlockBook-path behavior).
    pub commitment: Vec<u8>,
}

#[derive(Default)]
pub struct Aggregate {
    pub current_supply: BigInt,
    pub live_utxo_count: i32,
    pub live_nft_count: i32,
    pub has_active_minting: bool,
    pub holders: HashMap<String, HolderAcc>,
    pub nfts: Vec<NftWrite>,
}

#[derive(Default)]
pub struct HolderAcc {
    pub balance: BigInt,
    pub nft_count: i32,
}

/// Walk the live UTXO set and collect per-category state.
pub fn aggregate(utxos: &[AggInput]) -> Aggregate {
    let mut agg = Aggregate {
        live_utxo_count: utxos.len() as i32,
        ..Aggregate::default()
    };

    for u in utxos {
        agg.current_supply += &u.amount;

        let owner = u.address.as_deref().and_then(normalize_address);

        if let Some(addr) = &owner {
            let entry = agg.holders.entry(addr.clone()).or_default();
            entry.balance += &u.amount;
            if u.nft.is_some() {
                entry.nft_count += 1;
            }
        }

        if let Some(nft) = &u.nft {
            agg.live_nft_count += 1;
            if matches!(nft.capability, NftCapability::Minting) {
                agg.has_active_minting = true;
            }
            let capability: &'static str = match nft.capability {
                NftCapability::None => "none",
                NftCapability::Mutable => "mutable",
                NftCapability::Minting => "minting",
            };
            // Skip malformed NFTs with empty commitments — matches TS / the
            // original BlockBook path (counts already incremented above).
            if nft.commitment.is_empty() {
                continue;
            }
            agg.nfts.push(NftWrite {
                commitment: nft.commitment.clone(),
                capability,
                owner_address: owner.clone(),
            });
        }
    }

    agg
}

/// Minimum holders required for a meaningful Gini score. Below this, the
/// formula produces extreme values that say nothing useful about the token.
const GINI_MIN_HOLDERS: usize = 10;

/// Gini coefficient of the holder fungible-balance distribution.
///
/// Returns `None` when fewer than [`GINI_MIN_HOLDERS`] distinct holders, or
/// total balance is zero (pure-NFT / fully-burned). See the original for the
/// BigInt-precision rationale; logic is unchanged.
pub fn compute_gini(holders: &HashMap<String, HolderAcc>) -> Option<f32> {
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

    let num_f = numerator.to_f64()?;
    let den_f = denominator.to_f64()?;
    if !num_f.is_finite() || !den_f.is_finite() || den_f == 0.0 {
        return None;
    }
    let ratio = num_f / den_f;
    if !ratio.is_finite() {
        return None;
    }
    Some(ratio.clamp(0.0, 1.0) as f32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn holders(balances: &[u64]) -> HashMap<String, HolderAcc> {
        balances
            .iter()
            .enumerate()
            .map(|(i, b)| {
                (
                    format!("addr{i}"),
                    HolderAcc { balance: BigInt::from(*b), nft_count: 0 },
                )
            })
            .collect()
    }

    fn ft(addr: &str, amount: u64) -> AggInput {
        AggInput {
            address: Some(addr.to_string()),
            amount: BigInt::from(amount),
            nft: None,
        }
    }

    #[test]
    fn aggregate_sums_supply_and_holder_balances() {
        let inputs = vec![ft("qaaa", 100), ft("qaaa", 50), ft("qbbb", 25)];
        let agg = aggregate(&inputs);
        assert_eq!(agg.current_supply, BigInt::from(175));
        assert_eq!(agg.live_utxo_count, 3);
        assert_eq!(agg.holders.len(), 2);
        assert_eq!(agg.holders["qaaa"].balance, BigInt::from(150));
        assert_eq!(agg.live_nft_count, 0);
    }

    #[test]
    fn aggregate_nft_counts_but_empty_commitment_excluded_from_list() {
        let inputs = vec![
            AggInput {
                address: Some("qccc".into()),
                amount: BigInt::from(0),
                nft: Some(AggNft { capability: NftCapability::Minting, commitment: vec![1, 2] }),
            },
            AggInput {
                address: Some("qccc".into()),
                amount: BigInt::from(0),
                nft: Some(AggNft { capability: NftCapability::None, commitment: vec![] }),
            },
        ];
        let agg = aggregate(&inputs);
        assert_eq!(agg.live_nft_count, 2, "both NFTs counted");
        assert!(agg.has_active_minting);
        assert_eq!(agg.holders["qccc"].nft_count, 2, "holder nft_count includes empty-commitment");
        assert_eq!(agg.nfts.len(), 1, "empty-commitment NFT excluded from nfts[]");
    }

    #[test]
    fn aggregate_nonstandard_address_counts_supply_no_holder() {
        let agg = aggregate(&[AggInput { address: None, amount: BigInt::from(99), nft: None }]);
        assert_eq!(agg.current_supply, BigInt::from(99));
        assert!(agg.holders.is_empty());
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
        let mut balances = vec![1u64; 11];
        balances.push(1_000_000_000);
        let g = compute_gini(&holders(&balances)).expect("gini for whale-dominated split");
        assert!(g > 0.9 && g < 1.0, "expected high Gini for whale split, got {g}");
    }
}
