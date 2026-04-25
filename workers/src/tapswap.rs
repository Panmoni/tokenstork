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
/// legitimate spending input's unlocking bytecode. Used by the
/// spend-detection walker to recognize close events.
pub const TAPSWAP_SPEND_MARKER: [u8; 21] = [
    0x14, 0xe4, 0xda, 0x17, 0xdd, 0xbe, 0x40, 0x53, 0x3c, 0x2a, 0x86, 0x38, 0xfd, 0xed, 0xf2, 0xc0,
    0x99, 0x7d, 0x46, 0xe9, 0x53,
];

/// Minimum length (in raw bytes) of a Tapswap-close unlocking bytecode.
/// Any legitimate close has the contract redemption script + the
/// signature + ancillary push data, totalling ≥ 210 bytes. A shorter
/// input that happens to contain the marker (e.g. a different protocol
/// using the same platform PKH bytes by coincidence) is rejected.
pub const MIN_SPEND_UNLOCKING_BYTECODE_LEN: usize = 210;

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

// ---------------------------------------------------------------------------
// Spend / close detection
// ---------------------------------------------------------------------------

/// Final lifecycle state of a Tapswap offer once it's spent. The wire
/// values match the schema's CHECK constraint
/// (`status IN ('open','taken','cancelled')`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CloseStatus {
    /// A taker spent the contract UTXO and walked off with the listed asset.
    Taken,
    /// The maker spent the contract UTXO themselves to retract the listing.
    Cancelled,
}

impl CloseStatus {
    /// String form for the `status` column. Matches the CHECK constraint.
    pub fn as_db_str(self) -> &'static str {
        match self {
            CloseStatus::Taken => "taken",
            CloseStatus::Cancelled => "cancelled",
        }
    }
}

/// Result of classifying a Tapswap-close transaction.
#[derive(Debug, Clone, PartialEq)]
pub struct DecodedClose {
    pub status: CloseStatus,
    /// Filled when status is `Taken` and the spending tx's outputs[0] is
    /// a recognizable P2PKH (i.e. we know who the taker is).
    /// `None` when status is `Cancelled` or when we couldn't recover a
    /// PKH from outputs[0] (non-P2PKH locking script — unusual but
    /// permitted; we still record the close).
    pub taker_pkh: Option<[u8; 20]>,
}

/// Cheap candidate filter for an input that may be closing a Tapswap
/// listing. Two-part check:
///   1. Length ≥ 210 bytes — any legit close has a substantial redeem
///      script + signature payload.
///   2. Contains the 21-byte spend marker — push-20 + the platform PKH.
///
/// Both checks are required: short inputs can't be Tapswap closes; long
/// inputs without the marker aren't either. Caller still validates
/// against the open-listings DB (the input's `txid` must match a row
/// with `status='open'`).
pub fn is_mpsw_spend_candidate(unlocking_bytecode: &[u8]) -> bool {
    if unlocking_bytecode.len() < MIN_SPEND_UNLOCKING_BYTECODE_LEN {
        return false;
    }
    contains_subslice(unlocking_bytecode, &TAPSWAP_SPEND_MARKER)
}

/// Length of a standard P2PKH locking script: `OP_DUP OP_HASH160
/// <push-20> <pkh> OP_EQUALVERIFY OP_CHECKSIG`.
const P2PKH_SCRIPT_LEN: usize = 25;

/// CashTokens prefix marker. Per CHIP-2022-02-CashTokens, a token-bearing
/// UTXO's locking bytecode starts with this byte, followed by category +
/// token-data + the **standard locking script as a suffix**.
const PREFIX_TOKEN: u8 = 0xef;

/// Returns `Some(pkh)` if `locking_bytecode` is recognizably a P2PKH
/// script paying `pkh`. Two shapes are accepted:
///
/// 1. **Standard P2PKH** (no token): exactly 25 bytes, hex
///    `76a914<20-byte PKH>88ac`.
///
/// 2. **CashToken-prefixed P2PKH**: bytecode starts with `0xef`
///    (PREFIX_TOKEN) and ends with the same 25-byte P2PKH suffix.
///    The intermediate bytes carry the token category + variable-length
///    commitment + FT amount, which we don't need to fully decode —
///    the standard locking script is by spec always the *suffix* of
///    the encoded locking bytecode.
///
/// Why this matters: every Tapswap close transaction's `vout[0]` is the
/// listed asset being delivered to the new owner. For FT or NFT
/// listings (the common case) that's a CashToken-bearing UTXO whose
/// locking bytecode is the prefixed shape. Without case 2, every
/// non-pure-BCH close fell through to a non-P2PKH fallback and was
/// misclassified as Taken with `taker_pkh: None` — hiding cancellations
/// entirely.
///
/// Returns `None` for any other shape (P2SH, OP_RETURN, segwit-style,
/// malformed bytes). The CashToken case carries a tiny false-positive
/// risk (~2^-40) that a random tail coincidentally ends with the magic
/// 25-byte sequence; acceptable for a directory index.
pub fn extract_p2pkh_pkh(locking_bytecode: &[u8]) -> Option<[u8; 20]> {
    let len = locking_bytecode.len();

    // Reject anything that isn't either standard P2PKH (exact length)
    // or CashToken-prefixed (starts with 0xef, has room for the prefix
    // + the 25-byte suffix). Other-length non-token bytecodes (P2SH at
    // 23 bytes, OP_RETURN of varying length, etc.) bail here.
    let is_raw_p2pkh = len == P2PKH_SCRIPT_LEN;
    let is_cashtoken_prefixed = len > P2PKH_SCRIPT_LEN && locking_bytecode[0] == PREFIX_TOKEN;
    if !is_raw_p2pkh && !is_cashtoken_prefixed {
        return None;
    }

    // The P2PKH script is always the suffix of the bytecode — true for
    // both raw P2PKH (suffix == whole bytecode) and CashToken-prefixed
    // (suffix follows the variable-length token data).
    let suffix = &locking_bytecode[len - P2PKH_SCRIPT_LEN..];
    if suffix[0] != 0x76      // OP_DUP
        || suffix[1] != 0xa9  // OP_HASH160
        || suffix[2] != 0x14  // push-20
        || suffix[23] != 0x88 // OP_EQUALVERIFY
        || suffix[24] != 0xac
    // OP_CHECKSIG
    {
        return None;
    }
    let mut pkh = [0u8; 20];
    pkh.copy_from_slice(&suffix[3..23]);
    Some(pkh)
}

/// Classify a spending transaction as Taken vs Cancelled given the
/// listing's stored maker_pkh. Rule:
///   - outputs[0] pays the maker → maker is recovering their asset → Cancelled.
///   - outputs[0] pays anyone else (or anything-not-P2PKH) → Taken; the
///     spending tx's outputs[0] PKH (if recoverable) is the taker.
///
/// Why outputs[0]: by Tapswap protocol convention, outputs[0] of a
/// close transaction carries the listed asset to its new owner. The
/// taker case has additional outputs paying the maker the want_sats +
/// the platform fee, but those don't drive classification here.
pub fn classify_close(
    spending_tx_output0_locking_bytecode: &[u8],
    listing_maker_pkh: &[u8; 20],
) -> DecodedClose {
    let recipient_pkh = extract_p2pkh_pkh(spending_tx_output0_locking_bytecode);
    match recipient_pkh {
        Some(pkh) if pkh == *listing_maker_pkh => DecodedClose {
            status: CloseStatus::Cancelled,
            taker_pkh: None,
        },
        Some(pkh) => DecodedClose {
            status: CloseStatus::Taken,
            taker_pkh: Some(pkh),
        },
        None => DecodedClose {
            status: CloseStatus::Taken,
            taker_pkh: None,
        },
    }
}

/// Naive substring search on byte slices. Used by `is_mpsw_spend_candidate`
/// to test for the 21-byte marker inside an unlocking bytecode of typically
/// 200-400 bytes — `O(n*m)` is fine at these sizes; pulling in a smarter
/// algorithm (Boyer-Moore, KMP) would be premature optimization.
fn contains_subslice(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() || haystack.len() < needle.len() {
        return needle.is_empty();
    }
    haystack.windows(needle.len()).any(|w| w == needle)
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

    // -----------------------------------------------------------------------
    // Spend / close detection
    // -----------------------------------------------------------------------

    /// Build an unlocking bytecode of `len` bytes with the spend marker
    /// embedded at a specific offset. Padded with arbitrary filler so
    /// the candidate-length check still passes.
    fn unlock_with_marker(len: usize, marker_offset: usize) -> Vec<u8> {
        assert!(marker_offset + TAPSWAP_SPEND_MARKER.len() <= len);
        let mut bytes = vec![0xab; len];
        bytes[marker_offset..marker_offset + TAPSWAP_SPEND_MARKER.len()]
            .copy_from_slice(&TAPSWAP_SPEND_MARKER);
        bytes
    }

    #[test]
    fn spend_candidate_requires_minimum_length() {
        // Right at the floor — a 210-byte input containing the marker
        // is a candidate.
        let at_floor = unlock_with_marker(MIN_SPEND_UNLOCKING_BYTECODE_LEN, 50);
        assert!(is_mpsw_spend_candidate(&at_floor));

        // One byte under the floor is rejected even if the marker is present.
        let under_floor = unlock_with_marker(MIN_SPEND_UNLOCKING_BYTECODE_LEN - 1, 50);
        assert!(!is_mpsw_spend_candidate(&under_floor));
    }

    #[test]
    fn spend_candidate_requires_marker() {
        // 300-byte input full of zero bytes — no marker — rejected.
        let no_marker = vec![0x00; 300];
        assert!(!is_mpsw_spend_candidate(&no_marker));
    }

    #[test]
    fn spend_candidate_finds_marker_anywhere() {
        // Marker placed at a few different offsets — all should match.
        let len = 300;
        for offset in [0, 50, 150, len - TAPSWAP_SPEND_MARKER.len()] {
            let bytes = unlock_with_marker(len, offset);
            assert!(
                is_mpsw_spend_candidate(&bytes),
                "marker at offset {offset} should match"
            );
        }
    }

    #[test]
    fn extract_p2pkh_pkh_recognizes_standard_p2pkh() {
        // 76a914<20-byte PKH>88ac
        let pkh: [u8; 20] = [0x33; 20];
        let mut bytes = vec![0x76, 0xa9, 0x14];
        bytes.extend_from_slice(&pkh);
        bytes.push(0x88);
        bytes.push(0xac);
        assert_eq!(bytes.len(), 25);
        assert_eq!(extract_p2pkh_pkh(&bytes), Some(pkh));
    }

    #[test]
    fn extract_p2pkh_pkh_rejects_p2sh() {
        // a914<20>87 — P2SH, not P2PKH.
        let hash: [u8; 20] = [0x44; 20];
        let mut bytes = vec![0xa9, 0x14];
        bytes.extend_from_slice(&hash);
        bytes.push(0x87);
        // P2SH is 23 bytes — wrong length anyway, returns None.
        assert_eq!(bytes.len(), 23);
        assert!(extract_p2pkh_pkh(&bytes).is_none());
    }

    #[test]
    fn extract_p2pkh_pkh_rejects_op_return() {
        // 6a<...> — OP_RETURN locking bytecode is not a P2PKH.
        let bytes = vec![0x6a, 0x04, 0xde, 0xad, 0xbe, 0xef];
        assert!(extract_p2pkh_pkh(&bytes).is_none());
    }

    #[test]
    fn extract_p2pkh_pkh_rejects_wrong_length() {
        // 24-byte buffer (one short of P2PKH) → None.
        let short = vec![0x76, 0xa9, 0x14, 0x33, 0x88, 0xac];
        assert!(extract_p2pkh_pkh(&short).is_none());

        // 26-byte buffer (one over, no 0xef token prefix marker) → None.
        let long = vec![0x00; 26];
        assert!(extract_p2pkh_pkh(&long).is_none());
    }

    #[test]
    fn extract_p2pkh_pkh_recognizes_cashtoken_prefixed_p2pkh() {
        // Build a CashToken-prefixed P2PKH paying a known PKH:
        //   0xef                                  (PREFIX_TOKEN)
        //   <32 bytes category>
        //   0x10                                  (bitfield: HAS_AMOUNT only)
        //   <single-byte VM amount>
        //   76 a9 14 <20-byte PKH> 88 ac          (standard P2PKH suffix)
        let pkh: [u8; 20] = [0x88; 20];
        let mut bytes = vec![PREFIX_TOKEN];
        bytes.extend_from_slice(&[0x55; 32]); // category
        bytes.push(0x10); // bitfield
        bytes.push(0x01); // VM amount = 1
        // P2PKH suffix:
        bytes.push(0x76);
        bytes.push(0xa9);
        bytes.push(0x14);
        bytes.extend_from_slice(&pkh);
        bytes.push(0x88);
        bytes.push(0xac);
        assert!(bytes.len() > P2PKH_SCRIPT_LEN);
        assert_eq!(extract_p2pkh_pkh(&bytes), Some(pkh));
    }

    #[test]
    fn extract_p2pkh_pkh_rejects_cashtoken_prefix_with_non_p2pkh_suffix() {
        // CashToken-prefixed bytecode whose suffix isn't a standard
        // P2PKH (e.g., trailing P2SH-style 23 bytes pads to 25 but
        // doesn't pattern-match) — must reject, not silently accept.
        let mut bytes = vec![PREFIX_TOKEN];
        bytes.extend_from_slice(&[0x55; 32]); // category
        bytes.push(0x10); // bitfield
        bytes.push(0x01); // amount
        // 25 trailing bytes that DON'T match 76a914...88ac (random):
        bytes.extend_from_slice(&[0xa9; 25]);
        assert!(extract_p2pkh_pkh(&bytes).is_none());
    }

    #[test]
    fn classify_close_cancelled_with_cashtoken_prefixed_output() {
        // The realistic case for Tapswap cancellation: the maker reclaims
        // a CashToken-bearing UTXO. vout[0] is a CashToken-prefixed P2PKH
        // paying the maker. Pre-fix this would have classified Taken with
        // None taker — hiding the cancellation.
        let maker: [u8; 20] = [0x55; 20];
        let mut bytes = vec![PREFIX_TOKEN];
        bytes.extend_from_slice(&[0x77; 32]);
        bytes.push(0x10);
        bytes.push(0x01);
        bytes.push(0x76);
        bytes.push(0xa9);
        bytes.push(0x14);
        bytes.extend_from_slice(&maker);
        bytes.push(0x88);
        bytes.push(0xac);

        let result = classify_close(&bytes, &maker);
        assert_eq!(result.status, CloseStatus::Cancelled);
        assert_eq!(result.taker_pkh, None);
    }

    #[test]
    fn classify_close_taken_with_cashtoken_prefixed_output() {
        // Realistic takeoff case: taker receives the CashToken-bearing
        // UTXO. vout[0] is a CashToken-prefixed P2PKH paying the taker.
        let maker: [u8; 20] = [0x55; 20];
        let taker: [u8; 20] = [0x99; 20];
        let mut bytes = vec![PREFIX_TOKEN];
        bytes.extend_from_slice(&[0x77; 32]);
        bytes.push(0x10);
        bytes.push(0x01);
        bytes.push(0x76);
        bytes.push(0xa9);
        bytes.push(0x14);
        bytes.extend_from_slice(&taker);
        bytes.push(0x88);
        bytes.push(0xac);

        let result = classify_close(&bytes, &maker);
        assert_eq!(result.status, CloseStatus::Taken);
        assert_eq!(result.taker_pkh, Some(taker));
    }

    #[test]
    fn classify_close_cancelled_when_pkh_matches() {
        let maker: [u8; 20] = [0x55; 20];
        // outputs[0] = P2PKH paying the maker.
        let mut p2pkh = vec![0x76, 0xa9, 0x14];
        p2pkh.extend_from_slice(&maker);
        p2pkh.extend_from_slice(&[0x88, 0xac]);
        let result = classify_close(&p2pkh, &maker);
        assert_eq!(result.status, CloseStatus::Cancelled);
        assert_eq!(result.taker_pkh, None, "no taker on a cancellation");
    }

    #[test]
    fn classify_close_taken_when_pkh_differs() {
        let maker: [u8; 20] = [0x55; 20];
        let taker: [u8; 20] = [0x77; 20];
        let mut p2pkh = vec![0x76, 0xa9, 0x14];
        p2pkh.extend_from_slice(&taker);
        p2pkh.extend_from_slice(&[0x88, 0xac]);
        let result = classify_close(&p2pkh, &maker);
        assert_eq!(result.status, CloseStatus::Taken);
        assert_eq!(result.taker_pkh, Some(taker));
    }

    #[test]
    fn classify_close_taken_when_output_not_p2pkh() {
        // outputs[0] is OP_RETURN — taker PKH unrecoverable, but still
        // a Taken because the maker isn't getting it back.
        let maker: [u8; 20] = [0x55; 20];
        let op_return = vec![0x6a, 0x04, 0xde, 0xad, 0xbe, 0xef];
        let result = classify_close(&op_return, &maker);
        assert_eq!(result.status, CloseStatus::Taken);
        assert_eq!(result.taker_pkh, None);
    }

    #[test]
    fn close_status_db_strings_match_check_constraint() {
        // The schema's CHECK constraint allows 'taken' / 'cancelled' /
        // 'open'. Our db_str() must match those exactly or upserts fail.
        assert_eq!(CloseStatus::Taken.as_db_str(), "taken");
        assert_eq!(CloseStatus::Cancelled.as_db_str(), "cancelled");
    }
}
