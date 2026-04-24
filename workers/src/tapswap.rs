//! Tapswap ("MPSW") on-chain listing protocol parser.
//!
//! Tapswap is @mainnet-pat's peer-to-peer fixed-price marketplace for BCH
//! CashTokens (FTs + NFTs). Listings are detectable from any BCH node with a
//! 9-byte prefix match on `outputs[1].script_pub_key.hex`; no Chaingraph,
//! no GraphQL, no third-party indexer dependency.
//!
//! Protocol reference: [mainnet-pat/tapswap-subsquid](https://github.com/mainnet-pat/tapswap-subsquid).
//! Verified end-to-end against block 796,000 tx `83628e1a…edc2545f` on 2026-04-24.
//!
//! ## Listing anatomy
//!
//! ```text
//!  outputs[0]  (the "contract UTXO" — dust; locked to a unique P2SH; contains
//!               the token data the maker is offering)
//!  outputs[1]  (OP_RETURN with MPSW metadata, 10 push-op chunks)
//!  outputs[2…] (change back to the maker)
//! ```
//!
//! The OP_RETURN is:
//!
//! ```text
//!  6a                                              OP_RETURN
//!  04 4d505357                                     push-4  "MPSW"     chunk[0]
//!  01 04                                           push-1  0x04       chunk[1] — version = 4
//!  04 <4 bytes>                                    push-4             chunk[2] — unchecked nonce
//!  14 e4da17ddbe40533c2a8638fdedf2c0997d46e953     push-20            chunk[3] — platform PKH
//!  XX <…>                                          push                chunk[4] — want_sats (VM bigint)
//!  XX <…>                                          push                chunk[5] — want_category (0 / 32 / 33 bytes)
//!  XX <…>                                          push                chunk[6] — want_commitment (up to 40 bytes)
//!  XX <…>                                          push                chunk[7] — want_amount (VM bigint)
//!  14 <20 bytes>                                   push-20            chunk[8] — maker PKH
//!  XX <…>                                          push                chunk[9] — fee_sats (VM bigint, ≥ 100,000)
//! ```
//!
//! The 9-byte prefix `6a 04 4d 50 53 57 01 04 04` is what
//! [`is_mpsw_candidate`] checks. The full chunk decode + validation lives in
//! [`parse_op_return`], which returns `Some(DecodedOffer)` only when every
//! rule in the spec passes.

use anyhow::{Context, Result};
use chrono::{DateTime, TimeZone, Utc};
use num_bigint::{BigInt, Sign};

use crate::bchn::{NftCapability, TokenAmount, Tx, Vout};
use crate::pg::OfferWrite;

/// The 9-byte OP_RETURN prefix every current (v4) Tapswap listing starts
/// with: `OP_RETURN` + push-4 `"MPSW"` + push-1 `0x04` + push-4 header.
///
/// A later Tapswap version bump would rotate the final `04 04` bytes; the
/// code path currently supports only v4, which is the version in production
/// today. If a v5 ships we update this constant + re-verify [`parse_op_return`]
/// against a known v5 tx.
pub const MPSW_OP_RETURN_PREFIX: &[u8] = &[0x6a, 0x04, 0x4d, 0x50, 0x53, 0x57, 0x01, 0x04, 0x04];
/// Same prefix as a lowercase hex string — convenient for string-prefix
/// compare against BCHN's `scriptPubKey.hex` field without decoding.
pub const MPSW_OP_RETURN_PREFIX_HEX: &str = "6a044d505357010404";

/// Platform PKH baked into every legitimate Tapswap listing. Self-identifies
/// the protocol — chunk[3] must equal this, otherwise it's not Tapswap.
pub const TAPSWAP_PLATFORM_PKH: [u8; 20] = [
    0xe4, 0xda, 0x17, 0xdd, 0xbe, 0x40, 0x53, 0x3c, 0x2a, 0x86, 0x38, 0xfd, 0xed, 0xf2, 0xc0, 0x99,
    0x7d, 0x46, 0xe9, 0x53,
];

/// Push-20 op + platform PKH (21 bytes total). Appears inside any
/// legitimate spending input's unlocking bytecode. Used by the future
/// spend-detection walker to recognize close events.
pub const TAPSWAP_SPEND_MARKER: [u8; 21] = [
    0x14, 0xe4, 0xda, 0x17, 0xdd, 0xbe, 0x40, 0x53, 0x3c, 0x2a, 0x86, 0x38, 0xfd, 0xed, 0xf2, 0xc0,
    0x99, 0x7d, 0x46, 0xe9, 0x53,
];

/// Platform fee must be at least 100,000 sats — an anti-spam floor baked
/// into the protocol. Listings below this are rejected upstream.
pub const MIN_FEE_SATS: i64 = 100_000;

/// Decoded "want" side of a Tapswap offer (from the OP_RETURN metadata).
/// The "has" side isn't decoded here — it comes from the tx's
/// `outputs[0].token_data`, which the caller surfaces directly.
#[derive(Debug, Clone)]
pub struct DecodedOffer {
    pub want_sats: i64,
    /// `None` means "sats-only listing" (maker wants pure BCH for what
    /// they're offering). A 32-byte value means a pure FT category, a
    /// 33-byte value means NFT with trailing capability byte.
    pub want_category: Option<[u8; 32]>,
    /// Present only when the maker wants an NFT (chunk[5].len() == 33).
    pub want_capability: Option<NftCapability>,
    /// Present only when the maker wants a specific NFT by commitment.
    /// Up to 40 bytes per CashTokens spec.
    pub want_commitment: Option<Vec<u8>>,
    /// Present only when the maker wants a fungible amount.
    pub want_amount: Option<BigInt>,
    /// Maker's public-key hash (20 bytes). Combined with a network prefix +
    /// type byte this renders as the maker's cashaddr; the caller does that
    /// since cashaddr encoding isn't a concern of the parser.
    pub maker_pkh: [u8; 20],
    /// Platform fee the listing commits to pay on takeoff (chunk[9]).
    /// Typically 3% of `want_sats`, but we don't enforce that ratio —
    /// just validate `>= MIN_FEE_SATS`.
    pub fee_sats: i64,
}

/// Cheap first-pass filter: does this output's locking bytecode (raw bytes)
/// start with the MPSW v4 OP_RETURN prefix? True even for malformed-beyond-
/// the-prefix listings; callers must still run `parse_op_return` to validate.
pub fn is_mpsw_candidate(locking_bytecode: &[u8]) -> bool {
    locking_bytecode.starts_with(MPSW_OP_RETURN_PREFIX)
}

/// Full decode + validation. Returns `Some(offer)` iff every protocol rule
/// passes; `None` on any violation (malformed chunks, wrong platform PKH,
/// wrong chunk count, out-of-range lengths, fee below floor, invalid VM
/// numbers, etc.). No partial results — this is the trust boundary between
/// raw chain bytes and the `tapswap_offers` table.
pub fn parse_op_return(locking_bytecode: &[u8]) -> Option<DecodedOffer> {
    if !is_mpsw_candidate(locking_bytecode) {
        return None;
    }

    let chunks = parse_push_chunks(locking_bytecode)?;
    if chunks.len() != 10 {
        return None;
    }

    // chunk[0] — "MPSW" tag (already implied by the prefix check, but cheap
    // to re-verify as a defensive rejection of pathological OP_RETURNs
    // that happen to match the 9-byte prefix without really being MPSW).
    if chunks[0].as_slice() != b"MPSW" {
        return None;
    }

    // chunk[1] — version byte. Must be 0x04 (v4); this is also baked into
    // the prefix check.
    if chunks[1].as_slice() != [0x04] {
        return None;
    }

    // chunk[2] — 4-byte unchecked nonce. The reference indexer doesn't
    // interpret it; we don't either. Likely ensures contract-P2SH
    // uniqueness per listing.
    if chunks[2].len() != 4 {
        return None;
    }

    // chunk[3] — platform PKH.
    if chunks[3].as_slice() != TAPSWAP_PLATFORM_PKH {
        return None;
    }

    // chunk[4] — want_sats (VM bigint). Must fit in i64 since sats top out
    // around 2.1e15 (21M BCH × 1e8) — well within i64 range.
    let want_sats = parse_vm_number(&chunks[4])?;
    let want_sats = bigint_to_i64(&want_sats)?;

    // chunk[5] — want_category: 0 (sats-only), 32 (FT), or 33 (NFT + capability byte).
    let (want_category, want_capability) = match chunks[5].len() {
        0 => (None, None),
        32 => {
            let mut cat = [0u8; 32];
            cat.copy_from_slice(&chunks[5]);
            (Some(cat), None)
        }
        33 => {
            let mut cat = [0u8; 32];
            cat.copy_from_slice(&chunks[5][..32]);
            let cap = capability_from_byte(chunks[5][32])?;
            (Some(cat), Some(cap))
        }
        _ => return None,
    };

    // chunk[6] — want_commitment. Up to 40 bytes per CashTokens spec.
    if chunks[6].len() > 40 {
        return None;
    }
    let want_commitment = if chunks[6].is_empty() || want_category.is_none() {
        None
    } else {
        Some(chunks[6].clone())
    };

    // chunk[7] — want_amount (VM bigint). Only meaningful when a category
    // is specified — for sats-only listings it's ignored.
    let want_amount = if want_category.is_none() {
        None
    } else {
        let n = parse_vm_number(&chunks[7])?;
        if n.sign() == Sign::Minus {
            // Token amounts aren't signed; reject negatives even though the
            // VM encoding allows them.
            return None;
        }
        Some(n)
    };

    // chunk[8] — maker PKH (20 bytes, always).
    if chunks[8].len() != 20 {
        return None;
    }
    let mut maker_pkh = [0u8; 20];
    maker_pkh.copy_from_slice(&chunks[8]);

    // chunk[9] — fee_sats (VM bigint). Must meet the platform-fee floor.
    let fee_sats = parse_vm_number(&chunks[9])?;
    let fee_sats = bigint_to_i64(&fee_sats)?;
    if fee_sats < MIN_FEE_SATS {
        return None;
    }

    Some(DecodedOffer {
        want_sats,
        want_category,
        want_capability,
        want_commitment,
        want_amount,
        maker_pkh,
        fee_sats,
    })
}

/// Parse a script's push ops into a sequence of data chunks.
///
/// Starts at `bytes[1]` (skipping the `OP_RETURN` byte). Handles standard
/// push ops (0x01..=0x4b), OP_PUSHDATA1 (0x4c), and OP_PUSHDATA2 (0x4d).
/// OP_PUSHDATA4 is not allowed inside OP_RETURNs by BCH consensus, so we
/// don't handle it.
///
/// Returns `None` on malformed input — any push op that extends past the end
/// of the buffer rejects the whole script.
fn parse_push_chunks(bytes: &[u8]) -> Option<Vec<Vec<u8>>> {
    if bytes.first() != Some(&0x6a) {
        return None;
    }
    let mut out: Vec<Vec<u8>> = Vec::with_capacity(10);
    let mut pos = 1usize;
    while pos < bytes.len() {
        let op = bytes[pos];
        let (data_len, header_len) = match op {
            0x00 => (0usize, 1usize),
            0x01..=0x4b => (op as usize, 1usize),
            0x4c => {
                let len = *bytes.get(pos + 1)? as usize;
                (len, 2)
            }
            0x4d => {
                let lo = *bytes.get(pos + 1)? as u16;
                let hi = *bytes.get(pos + 2)? as u16;
                let len = (hi << 8 | lo) as usize;
                (len, 3)
            }
            _ => return None, // unexpected opcode inside an OP_RETURN
        };
        let start = pos + header_len;
        let end = start.checked_add(data_len)?;
        if end > bytes.len() {
            return None;
        }
        out.push(bytes[start..end].to_vec());
        pos = end;
    }
    Some(out)
}

/// VM-encoded signed little-endian variable-length integer.
///
/// Matches the encoding used by CashScript / libauth's `vmNumberToBigInt`:
/// - 0 bytes → value 0
/// - 1..=8 bytes → little-endian; the MSB's 0x80 bit is the sign flag; the
///   remaining 7 bits of the MSB plus the lower bytes encode the magnitude
///
/// Longer encodings are technically possible on-chain but the Tapswap
/// protocol constrains us to fit i64 — enforced by [`bigint_to_i64`] at
/// the call site.
pub fn parse_vm_number(bytes: &[u8]) -> Option<BigInt> {
    if bytes.is_empty() {
        return Some(BigInt::ZERO);
    }
    let mut be = bytes.to_vec();
    be.reverse();
    let msb = be[0];
    let negative = (msb & 0x80) != 0;
    be[0] = msb & 0x7f;
    let magnitude = BigInt::from_bytes_be(Sign::Plus, &be);
    if negative {
        Some(-magnitude)
    } else {
        Some(magnitude)
    }
}

/// Narrow a `BigInt` to i64, returning `None` on overflow. Used for
/// `want_sats` and `fee_sats` which must fit (protocol floors plus the
/// practical cap of 21M BCH in sats = 2.1e15, far under i64::MAX).
fn bigint_to_i64(n: &BigInt) -> Option<i64> {
    use num_traits::ToPrimitive;
    n.to_i64()
}

fn capability_from_byte(b: u8) -> Option<NftCapability> {
    match b {
        0x00 => Some(NftCapability::None),
        0x01 => Some(NftCapability::Mutable),
        0x02 => Some(NftCapability::Minting),
        _ => None,
    }
}

fn capability_text(c: NftCapability) -> &'static str {
    match c {
        NftCapability::None => "none",
        NftCapability::Mutable => "mutable",
        NftCapability::Minting => "minting",
    }
}

// ---------------------------------------------------------------------------
// Transaction → OfferWrite bridge.
//
// This is the glue between the pure protocol parser above and the DB
// write struct in `crate::pg`. Both the `tapswap-backfill` binary and the
// `sync-tail` binary call `try_decode_tx` on each tx; the former during a
// cold walk, the latter live against incoming blocks. Keeping the helper
// here (rather than inlining in each binary) keeps the decoder shape in
// one place — any protocol change means one edit, not two.
// ---------------------------------------------------------------------------

struct HasSide {
    category: Option<[u8; 32]>,
    amount: Option<String>,
    commitment: Option<Vec<u8>>,
    capability: Option<&'static str>,
    sats: i64,
}

fn has_side_from_output(out: &Vout) -> Result<HasSide> {
    let value_sats = (out.value * 1e8).round() as i64;

    let Some(td) = &out.token_data else {
        return Ok(HasSide {
            category: None,
            amount: None,
            commitment: None,
            capability: None,
            sats: value_sats,
        });
    };

    let category_bytes = hex::decode(&td.category)
        .with_context(|| format!("outputs[0] category hex invalid: {}", td.category))?;
    if category_bytes.len() != 32 {
        anyhow::bail!(
            "outputs[0] category must be 32 bytes, got {}",
            category_bytes.len()
        );
    }
    let mut category = [0u8; 32];
    category.copy_from_slice(&category_bytes);

    let (amount, commitment, capability) = match &td.nft {
        None => (td.amount.as_ref().map(token_amount_to_string), None, None),
        Some(nft) => {
            let commitment_bytes = if nft.commitment.is_empty() {
                None
            } else {
                Some(hex::decode(&nft.commitment).with_context(|| {
                    format!("NFT commitment hex invalid: {}", nft.commitment)
                })?)
            };
            let cap = capability_text(nft.capability);
            // FT amount on a hybrid token; pure NFTs have amount=0 or absent.
            let ft_amount = td
                .amount
                .as_ref()
                .map(token_amount_to_string)
                .filter(|s| s != "0");
            (ft_amount, commitment_bytes, Some(cap))
        }
    };

    Ok(HasSide {
        category: Some(category),
        amount,
        commitment,
        capability,
        sats: value_sats,
    })
}

fn token_amount_to_string(a: &TokenAmount) -> String {
    match a {
        TokenAmount::Number(n) => n.to_string(),
        TokenAmount::Text(s) => s.clone(),
    }
}

/// Three-valued result from `try_decode_tx`:
/// - `Ok(None)` — not a Tapswap listing; skip quietly (the common case).
/// - `Ok(Some(offer))` — valid listing, ready to upsert.
/// - `Err(_)` — looked like a listing but didn't cleanly decode; log + skip.
///
/// The caller (backfill binary or sync-tail) iterates the block's txs and
/// calls this on each.
pub fn try_decode_tx(
    tx: &Tx,
    block_height: i32,
    block_time: i64,
) -> Result<Option<OfferWrite>> {
    // Fast filter: only tx whose output[1] hex starts with the MPSW prefix
    // get the full decode.
    let Some(out1) = tx.vout.get(1) else {
        return Ok(None);
    };
    if !out1.script_pub_key.hex.starts_with(MPSW_OP_RETURN_PREFIX_HEX) {
        return Ok(None);
    }

    let op_return_bytes = hex::decode(&out1.script_pub_key.hex)
        .with_context(|| format!("outputs[1] script hex invalid for tx {}", tx.txid))?;
    let Some(decoded) = parse_op_return(&op_return_bytes) else {
        // Prefix matched but full decode failed — we explicitly *don't*
        // escalate this to an Err. It's an expected possibility (e.g., a
        // spurious 9-byte-prefix collision, or a malformed listing). The
        // caller logs at the warn level and moves on.
        return Ok(None);
    };

    let Some(out0) = tx.vout.first() else {
        anyhow::bail!("MPSW listing {} has no outputs[0]", tx.txid);
    };
    let has = has_side_from_output(out0)
        .with_context(|| format!("has-side decode for tx {}", tx.txid))?;

    let listed_at: DateTime<Utc> = Utc
        .timestamp_opt(block_time, 0)
        .single()
        .ok_or_else(|| anyhow::anyhow!("invalid block timestamp {}", block_time))?;

    let id_bytes = hex::decode(&tx.txid)
        .with_context(|| format!("listing txid hex invalid: {}", tx.txid))?;
    if id_bytes.len() != 32 {
        anyhow::bail!("listing txid must be 32 bytes, got {}", id_bytes.len());
    }
    let mut id = [0u8; 32];
    id.copy_from_slice(&id_bytes);

    let want_amount_string = match decoded.want_amount {
        Some(ref n) if n.sign() == Sign::Minus => {
            // Parser should have rejected already; belt-and-braces.
            anyhow::bail!("negative want_amount in {}", tx.txid);
        }
        Some(n) => Some(n.to_string()),
        None => None,
    };

    Ok(Some(OfferWrite {
        id,
        has_category: has.category,
        has_amount: has.amount,
        has_commitment: has.commitment,
        has_capability: has.capability,
        has_sats: has.sats,
        want_category: decoded.want_category,
        want_amount: want_amount_string,
        want_commitment: decoded.want_commitment,
        want_capability: decoded.want_capability.map(capability_text),
        want_sats: decoded.want_sats,
        fee_sats: decoded.fee_sats,
        maker_pkh: decoded.maker_pkh,
        listed_block: block_height,
        listed_at,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Live decoded hex from block 796,000 tx 83628e1a…edc2545f, output 1.
    /// Full protocol end-to-end verification.
    const LIVE_TX_OP_RETURN_HEX: &str =
        "6a044d5053570104043d400caf14e4da17ddbe40533c2a8638fdedf2c0997d46e953040095ba0a00000014d0d9f7ef35c4ee6d8df2a97f60548c2fbca3111a03c06552";

    fn live_bytes() -> Vec<u8> {
        hex::decode(LIVE_TX_OP_RETURN_HEX).unwrap()
    }

    #[test]
    fn prefix_constants_are_coherent() {
        assert_eq!(
            MPSW_OP_RETURN_PREFIX.len(),
            9,
            "prefix is 9 bytes: OP_RETURN + push-4 MPSW + push-1 ver + push-4 header"
        );
        assert_eq!(
            hex::encode(MPSW_OP_RETURN_PREFIX),
            MPSW_OP_RETURN_PREFIX_HEX
        );
        assert_eq!(TAPSWAP_SPEND_MARKER[0], 0x14);
        assert_eq!(&TAPSWAP_SPEND_MARKER[1..], TAPSWAP_PLATFORM_PKH.as_slice());
    }

    #[test]
    fn is_candidate_matches_prefix() {
        assert!(is_mpsw_candidate(&live_bytes()));
        assert!(!is_mpsw_candidate(b"\x6a\x04\x4d\x50\x53\x57\x01\x04\x05"));
        assert!(!is_mpsw_candidate(&[0x6a]));
        assert!(!is_mpsw_candidate(&[]));
    }

    #[test]
    fn decodes_live_tx_83628e1a_block_796000() {
        let bytes = live_bytes();
        let offer = parse_op_return(&bytes).expect("live tx must decode");

        assert_eq!(offer.want_sats, 180_000_000);
        assert_eq!(offer.want_category, None, "sats-only listing");
        assert_eq!(offer.want_capability, None);
        assert_eq!(offer.want_commitment, None);
        assert_eq!(offer.want_amount, None);
        assert_eq!(offer.fee_sats, 5_400_000);

        let expected_maker =
            hex::decode("d0d9f7ef35c4ee6d8df2a97f60548c2fbca3111a").unwrap();
        assert_eq!(offer.maker_pkh.as_slice(), expected_maker.as_slice());

        // Fee should be exactly 3% of the ask for this tx (sanity).
        assert_eq!(offer.fee_sats * 100, offer.want_sats * 3);
    }

    #[test]
    fn rejects_wrong_platform_pkh() {
        let mut bad = live_bytes();
        // chunk[3] starts at byte offset: prefix(9) + push-4(1) + 4 + push-1(1) = 15
        // Actually let me compute: prefix ends at 9. chunk[2] is push-4 nonce,
        // so positions 9..14 are [0x04, 0xnn, 0xnn, 0xnn, 0xnn] → chunk[2] ends at 14.
        // Then chunk[3]: [0x14, 20 bytes of platform pkh] at positions 14..35.
        // The PKH itself starts at position 15.
        bad[16] ^= 0xff;
        assert!(
            parse_op_return(&bad).is_none(),
            "flipped PKH must reject"
        );
    }

    #[test]
    fn rejects_unknown_version_via_prefix() {
        let mut bad = live_bytes();
        bad[8] = 0x05; // the trailing push-4 header of the version wrapper
        assert!(parse_op_return(&bad).is_none());
    }

    #[test]
    fn rejects_fee_below_floor() {
        // Synthesize a listing identical to the live one but with fee_sats = 50000.
        // fee_sats lives in chunk[9], which is the very last push in the script.
        // In the live bytes the chunk[9] push is `03 c0 65 52` (push-3, 5_400_000).
        // Replace with `03 50 c3 00` → 50_000 * ... let's compute: 50_000 little-endian =
        //   50_000 = 0x0000c350 → LE bytes 0x50 0xc3 0x00. push-3 + those = 03 50 c3 00.
        // But VM encoding of positive number with MSB having 0x80 bit would need
        // padding. 0x00 MSB has bit 7 clear, so 3 bytes work.
        // Strip the last 4 bytes of the live hex and append the new fee push.
        let mut bad = live_bytes();
        // Last 4 bytes are the push-3 fee. Truncate + re-append.
        for _ in 0..4 {
            bad.pop();
        }
        bad.extend_from_slice(&[0x03, 0x50, 0xc3, 0x00]);
        assert!(parse_op_return(&bad).is_none(), "fee 50k must reject");
    }

    #[test]
    fn rejects_malformed_chunk_count() {
        // Truncate last 4 bytes → 9 chunks total → reject.
        let mut bad = live_bytes();
        for _ in 0..4 {
            bad.pop();
        }
        assert!(parse_op_return(&bad).is_none());
    }

    #[test]
    fn parses_push_chunks_correctly() {
        let chunks = parse_push_chunks(&live_bytes()).expect("parse ok");
        assert_eq!(chunks.len(), 10);
        assert_eq!(chunks[0].as_slice(), b"MPSW");
        assert_eq!(chunks[1].as_slice(), [0x04]);
        assert_eq!(chunks[2].len(), 4);
        assert_eq!(chunks[3].as_slice(), TAPSWAP_PLATFORM_PKH.as_slice());
        assert_eq!(chunks[5].len(), 0, "sats-only listing has empty want_category");
        assert_eq!(chunks[6].len(), 0);
        assert_eq!(chunks[7].len(), 0);
        assert_eq!(chunks[8].len(), 20);
    }

    #[test]
    fn vm_number_zero() {
        assert_eq!(parse_vm_number(&[]).unwrap(), BigInt::ZERO);
    }

    #[test]
    fn vm_number_positive() {
        // 180_000_000 in LE bytes: 0x00 0x95 0xba 0x0a
        let bytes = [0x00, 0x95, 0xba, 0x0a];
        assert_eq!(parse_vm_number(&bytes).unwrap(), BigInt::from(180_000_000));
    }

    #[test]
    fn vm_number_small_positive() {
        // 5_400_000 in LE bytes: 0xc0 0x65 0x52 (3 bytes)
        let bytes = [0xc0, 0x65, 0x52];
        assert_eq!(parse_vm_number(&bytes).unwrap(), BigInt::from(5_400_000));
    }

    #[test]
    fn vm_number_one_byte_values() {
        // Single byte values: 0x01 = 1, 0x7f = 127
        assert_eq!(parse_vm_number(&[0x01]).unwrap(), BigInt::from(1));
        assert_eq!(parse_vm_number(&[0x7f]).unwrap(), BigInt::from(127));
        // 0x81 = 1 with sign bit → -1
        assert_eq!(parse_vm_number(&[0x81]).unwrap(), BigInt::from(-1));
        // 0xff = 127 with sign bit → -127
        assert_eq!(parse_vm_number(&[0xff]).unwrap(), BigInt::from(-127));
    }

    #[test]
    fn rejects_non_op_return() {
        let mut bytes = live_bytes();
        bytes[0] = 0x76; // OP_DUP instead of OP_RETURN
        assert!(parse_op_return(&bytes).is_none());
        assert!(parse_push_chunks(&bytes).is_none());
    }

    #[test]
    fn synthesize_ft_listing_decodes() {
        // Build a listing that wants 100 units of some FT category for 1 BCH.
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&[0x6a]); // OP_RETURN
        // chunk[0] "MPSW"
        bytes.extend_from_slice(&[0x04, 0x4d, 0x50, 0x53, 0x57]);
        // chunk[1] version 4
        bytes.extend_from_slice(&[0x01, 0x04]);
        // chunk[2] unchecked nonce (any 4 bytes)
        bytes.extend_from_slice(&[0x04, 0xde, 0xad, 0xbe, 0xef]);
        // chunk[3] platform PKH
        bytes.push(0x14);
        bytes.extend_from_slice(&TAPSWAP_PLATFORM_PKH);
        // chunk[4] want_sats = 100_000_000 (1 BCH)
        //   100_000_000 LE = 0x00 0xe1 0xf5 0x05
        bytes.extend_from_slice(&[0x04, 0x00, 0xe1, 0xf5, 0x05]);
        // chunk[5] want_category = 32 bytes of a fake category
        bytes.push(0x20);
        let fake_cat: [u8; 32] = [0x11; 32];
        bytes.extend_from_slice(&fake_cat);
        // chunk[6] want_commitment = empty (FT, no NFT commitment)
        bytes.push(0x00);
        // chunk[7] want_amount = 100 (single byte)
        bytes.extend_from_slice(&[0x01, 0x64]);
        // chunk[8] maker PKH
        bytes.push(0x14);
        let fake_maker: [u8; 20] = [0x22; 20];
        bytes.extend_from_slice(&fake_maker);
        // chunk[9] fee_sats = 3_000_000 (3% of 100M)
        //   3_000_000 LE = 0xc0 0xc6 0x2d
        bytes.extend_from_slice(&[0x03, 0xc0, 0xc6, 0x2d]);

        let offer = parse_op_return(&bytes).expect("synthesized FT listing must decode");
        assert_eq!(offer.want_sats, 100_000_000);
        assert_eq!(offer.want_category, Some(fake_cat));
        assert_eq!(offer.want_capability, None);
        assert_eq!(offer.want_commitment, None, "FT listings have no commitment");
        assert_eq!(offer.want_amount, Some(BigInt::from(100)));
        assert_eq!(offer.maker_pkh, fake_maker);
        assert_eq!(offer.fee_sats, 3_000_000);
    }
}
