//! CRC-20 covenant detection.
//!
//! CRC-20 is a permissionless naming convention layered on top of CashTokens.
//! Every CRC-20 token's `symbol` / `decimals` / `name` is encoded inside a
//! 21-byte CashScript covenant whose redeem script is revealed in the
//! genesis input of the genesis transaction. The covenant pins `output[0]`
//! to a 25-byte P2PKH whose pubkey-hash equals `hash160(symbol)`.
//!
//! Redeem-script byte layout (constructor pushes are pushed first so they
//! end up deepest on the stack; CashScript reverses arg order at compile
//! time so `(pubkey, metadata, int)` ends up as `<int><metadata><pubkey>`):
//!
//! ```text
//! <push: symbolLength>     # OP_0..OP_16, OP_PUSHBYTES_N data, OP_PUSHDATA1/2 data
//! <push: metadata>         # symbol || 1-byte decimals || name
//! <push: recipientPK>      # OP_PUSHBYTES_33 (compressed) or _65 (uncompressed)
//! 53 7a 7c ad 7c 7f 75 a9 03 76 a9 14 7c 7e 02 88 ac 7e 00 cd 87
//! ```
//!
//! The 21-byte trailing constant is invariant across every CRC-20 token
//! ever minted — it's the compiled body of `GenesisOutput.reveal()`.
//!
//! Detection is byte-pattern only: any redeem script that ends with the
//! canonical tail and decodes to three valid pushes (with the third being
//! a 33- or 65-byte pubkey) is a CRC-20 covenant. Marker verification
//! (`verify_marker_output`) then confirms the spending tx pinned
//! `output[0]` to the expected P2PKH.
//!
//! Reference: <https://crc20.cash/> · CRC20-BCH genesis tx
//! `a145e4692d5877df270518971f0b7a93fbf27a0475c2a3933e973c531ab48ebd`
//! (block 792,772) is the golden vector below.

use ripemd::Ripemd160;
use sha2::{Digest, Sha256};

/// Invariant 21-byte tail of every CRC-20 covenant redeem script.
pub const CRC20_CONTRACT_TAIL: [u8; 21] = [
    0x53, 0x7a, 0x7c, 0xad, 0x7c, 0x7f, 0x75, 0xa9, 0x03, 0x76, 0xa9, 0x14, 0x7c, 0x7e, 0x02, 0x88,
    0xac, 0x7e, 0x00, 0xcd, 0x87,
];

/// Decoded contents of a CRC-20 covenant reveal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Crc20Reveal {
    /// Raw symbol bytes from the covenant. Authoritative.
    pub symbol_bytes: Vec<u8>,
    /// Best-effort UTF-8 decoding of `symbol_bytes`. When the bytes are
    /// not valid UTF-8 (or contain a NUL), this falls back to
    /// `"0x" || hex(symbol_bytes)` and `symbol_is_hex` is set.
    pub symbol: String,
    pub symbol_is_hex: bool,
    /// One-byte decimals field. CashTokens spec caps at 8, but the covenant
    /// permits 0..=255 — store the raw value, clamp at render time.
    pub decimals: i16,
    pub name_bytes: Vec<u8>,
    /// Best-effort UTF-8 decoding of `name_bytes`. None if the bytes are
    /// not valid UTF-8.
    pub name: Option<String>,
    /// 33-byte compressed or 65-byte uncompressed pubkey of the creator.
    pub recipient_pubkey: Vec<u8>,
}

/// One push extracted from a script. `data` is the bytes that would be
/// pushed onto the stack — for OP_0 / OP_1..=OP_16 this is the canonical
/// script-num encoding (empty for OP_0, single-byte for OP_1..=OP_16).
struct Push {
    opcode: u8,
    data: Vec<u8>,
}

/// Read a single push starting at `offset`. Returns the push and the new
/// offset, or `None` if the bytes don't decode as a valid push opcode (or
/// if the push runs past the end of the script).
fn read_push(script: &[u8], offset: usize) -> Option<(Push, usize)> {
    if offset >= script.len() {
        return None;
    }
    let op = script[offset];
    let mut i = offset + 1;
    let data = match op {
        0x00 => Vec::new(),
        // OP_1..=OP_16 push integer (op - 0x50) onto the stack as a single
        // byte. We encode that as the canonical script-num form.
        0x51..=0x60 => vec![op - 0x50],
        // OP_1NEGATE pushes -1, encoded as 0x81 in script-num form.
        0x4f => vec![0x81],
        // OP_PUSHBYTES_1..=75: opcode IS the length.
        0x01..=0x4b => {
            let n = op as usize;
            if i + n > script.len() {
                return None;
            }
            let d = script[i..i + n].to_vec();
            i += n;
            d
        }
        // OP_PUSHDATA1: 1-byte length follows.
        0x4c => {
            if i >= script.len() {
                return None;
            }
            let n = script[i] as usize;
            i += 1;
            if i + n > script.len() {
                return None;
            }
            let d = script[i..i + n].to_vec();
            i += n;
            d
        }
        // OP_PUSHDATA2: 2-byte LE length follows.
        0x4d => {
            if i + 2 > script.len() {
                return None;
            }
            let n = u16::from_le_bytes([script[i], script[i + 1]]) as usize;
            i += 2;
            if i + n > script.len() {
                return None;
            }
            let d = script[i..i + n].to_vec();
            i += n;
            d
        }
        // OP_PUSHDATA4 — never seen on real CashScript output and would
        // imply a >64KB push; reject.
        _ => return None,
    };
    Some((Push { opcode: op, data }, i))
}

/// Decode a Bitcoin script-num (little-endian, sign-magnitude with the
/// high bit of the high byte as the sign flag). Returns `None` for
/// over-long encodings or trailing zero bytes (canonical form only).
fn decode_script_num(bytes: &[u8]) -> Option<i64> {
    if bytes.is_empty() {
        return Some(0);
    }
    if bytes.len() > 8 {
        return None;
    }
    let mut value: i64 = 0;
    for (i, b) in bytes.iter().enumerate() {
        value |= (*b as i64 & 0xff) << (i * 8);
    }
    let high = bytes[bytes.len() - 1];
    if high & 0x80 != 0 {
        // Sign bit set: clear it and negate.
        let mask = !((0x80_i64) << ((bytes.len() - 1) * 8));
        Some(-(value & mask))
    } else {
        Some(value)
    }
}

/// Parse a redeem script as a CRC-20 covenant reveal. Returns `None` if
/// the script does not match the CRC-20 byte pattern. Pure byte-level
/// check — no marker-output verification (call `verify_marker_output`
/// separately on the spending transaction).
pub fn parse_crc20_redeem(redeem: &[u8]) -> Option<Crc20Reveal> {
    // Tail check first: cheapest filter, eliminates almost all non-CRC-20
    // scripts in 21 byte comparisons.
    if redeem.len() < CRC20_CONTRACT_TAIL.len() + 3 {
        return None;
    }
    if !redeem.ends_with(&CRC20_CONTRACT_TAIL) {
        return None;
    }
    let prefix = &redeem[..redeem.len() - CRC20_CONTRACT_TAIL.len()];

    // Push 1: symbolLength (script-num).
    let (sym_len_push, i) = read_push(prefix, 0)?;
    let symbol_length = decode_script_num(&sym_len_push.data)?;
    // CashScript pushes positional ints as small unsigned values; reject
    // negative or absurdly large symbol lengths.
    if !(0..=520).contains(&symbol_length) {
        return None;
    }

    // Push 2: metadata (raw bytes).
    let (metadata_push, i) = read_push(prefix, i)?;
    let metadata = metadata_push.data;

    // Push 3: pubkey, MUST be 33-byte compressed (opcode 0x21) or 65-byte
    // uncompressed (opcode 0x41).
    let (pubkey_push, i) = read_push(prefix, i)?;
    if pubkey_push.opcode != 0x21 && pubkey_push.opcode != 0x41 {
        return None;
    }
    let pubkey_expected_len = pubkey_push.opcode as usize;
    if pubkey_push.data.len() != pubkey_expected_len {
        return None;
    }

    // No leftover bytes between push 3 and the contract tail.
    if i != prefix.len() {
        return None;
    }

    // Split metadata into symbol || decimals || name.
    let symbol_length = symbol_length as usize;
    if metadata.len() < symbol_length + 1 {
        // Need at least one decimals byte after the symbol.
        return None;
    }
    let symbol_bytes = metadata[..symbol_length].to_vec();
    let decimals = metadata[symbol_length] as i16;
    let name_bytes = metadata[symbol_length + 1..].to_vec();

    let (symbol, symbol_is_hex) = match std::str::from_utf8(&symbol_bytes) {
        Ok(s) if !s.contains('\0') => (s.to_string(), false),
        _ => (format!("0x{}", hex::encode(&symbol_bytes)), true),
    };
    let name = std::str::from_utf8(&name_bytes)
        .ok()
        .filter(|s| !s.contains('\0'))
        .map(|s| s.to_string());

    Some(Crc20Reveal {
        symbol_bytes,
        symbol,
        symbol_is_hex,
        decimals,
        name_bytes,
        name,
        recipient_pubkey: pubkey_push.data,
    })
}

/// Parse a scriptSig as exactly two pushes: `<sig push><redeem push>`.
/// Returns `(sig, redeem)` data. `None` if the scriptSig has any other
/// shape — that's a strong signal it's not a CRC-20 reveal spend.
pub fn parse_p2sh_unlock(scriptsig: &[u8]) -> Option<(Vec<u8>, Vec<u8>)> {
    let (sig, i) = read_push(scriptsig, 0)?;
    let (redeem, j) = read_push(scriptsig, i)?;
    if j != scriptsig.len() {
        return None;
    }
    Some((sig.data, redeem.data))
}

/// Verify that a spending transaction's `output[0].scriptPubKey` is the
/// 25-byte P2PKH pinned by the CRC-20 covenant: `OP_DUP OP_HASH160 <20
/// bytes hash160(symbol)> OP_EQUALVERIFY OP_CHECKSIG`.
pub fn verify_marker_output(symbol_bytes: &[u8], vout0_script: &[u8]) -> bool {
    if vout0_script.len() != 25 {
        return false;
    }
    if vout0_script[0] != 0x76 || vout0_script[1] != 0xa9 || vout0_script[2] != 0x14 {
        return false;
    }
    if vout0_script[23] != 0x88 || vout0_script[24] != 0xac {
        return false;
    }
    let expected = hash160(symbol_bytes);
    vout0_script[3..23] == expected[..]
}

/// `RIPEMD160(SHA256(x))`. 20 bytes.
pub fn hash160(bytes: &[u8]) -> [u8; 20] {
    let sha = Sha256::digest(bytes);
    let r = Ripemd160::digest(sha);
    let mut out = [0u8; 20];
    out.copy_from_slice(&r);
    out
}

// ---------------------------------------------------------------------------
// Block-level detection — used by tail / backfill / rescan.
// ---------------------------------------------------------------------------

use crate::bchn::Tx;

/// One verified CRC-20 reveal observed in a transaction. Carries enough
/// context for the caller to upsert into `token_crc20` after looking up
/// `commit_block` (the height of the block that confirmed the prevout
/// transaction).
#[derive(Debug, Clone)]
pub struct Crc20Detection {
    /// New CashTokens category created by this genesis tx. By the
    /// CashTokens spec this equals the prevout txid (= commit txid).
    pub category_hex: String,
    /// Commit txid (= category id; kept as a separate field for clarity).
    pub commit_txid_hex: String,
    /// 0-based input index that holds the CRC-20 covenant reveal.
    pub reveal_input_index: u32,
    /// Decoded covenant fields.
    pub reveal: Crc20Reveal,
}

/// Scan one transaction for a CRC-20 covenant reveal in any genesis
/// input. A "genesis input" is one whose prevout's `vout` index is 0
/// AND whose prevout txid matches a CashTokens category appearing in
/// this transaction's outputs (by definition of CashTokens category
/// IDs).
///
/// Returns at most one detection per tx (CRC-20 covenants are
/// single-use; if multiple genesis inputs in one tx revealed CRC-20
/// covenants, the first one wins — vanishingly rare in practice).
pub fn detect_in_tx(tx: &Tx) -> Option<Crc20Detection> {
    use std::collections::HashSet;

    let mut tx_categories: HashSet<&str> = HashSet::new();
    for vout in &tx.vout {
        if let Some(td) = &vout.token_data {
            tx_categories.insert(td.category.as_str());
        }
    }
    if tx_categories.is_empty() {
        return None;
    }

    for (input_idx, vin) in tx.vin.iter().enumerate() {
        let Some(prev_vout) = vin.vout else { continue };
        if prev_vout != 0 {
            continue;
        }
        let Some(prev_txid) = vin.txid.as_deref() else {
            continue;
        };
        if !tx_categories.contains(prev_txid) {
            continue;
        }
        let Some(script_sig) = vin.script_sig.as_ref() else {
            continue;
        };
        let Ok(scriptsig_bytes) = hex::decode(&script_sig.hex) else {
            continue;
        };
        let Some((_sig, redeem)) = parse_p2sh_unlock(&scriptsig_bytes) else {
            continue;
        };
        let Some(reveal) = parse_crc20_redeem(&redeem) else {
            continue;
        };
        // Verify marker output: vout[0] must be P2PKH(hash160(symbol)).
        let Some(vout0) = tx.vout.first() else {
            continue;
        };
        let Ok(vout0_script) = hex::decode(&vout0.script_pub_key.hex) else {
            continue;
        };
        if !verify_marker_output(&reveal.symbol_bytes, &vout0_script) {
            continue;
        }

        return Some(Crc20Detection {
            category_hex: prev_txid.to_string(),
            commit_txid_hex: prev_txid.to_string(),
            reveal_input_index: input_idx as u32,
            reveal,
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Live CRC20-BCH redeem-script bytes, extracted from the genesis tx
    /// `a145e4692d5877df270518971f0b7a93fbf27a0475c2a3933e973c531ab48ebd`
    /// at block 792,772. 105 bytes total.
    ///
    /// Layout:
    ///   53                                  OP_3                    (symbolLength = 3)
    ///   10 42 43 48 08 42 69 74 63 6f 69 6e
    ///      20 63 61 73 68                   OP_PUSHBYTES_16 metadata  ("BCH" || 0x08 || "Bitcoin cash")
    ///   41 04 8b f0 ... (65 bytes pubkey)   OP_PUSHBYTES_65 pubkey
    ///   53 7a 7c ad 7c 7f 75 a9 03 76 a9 14
    ///      7c 7e 02 88 ac 7e 00 cd 87       21-byte contract tail
    fn crc20_bch_redeem() -> Vec<u8> {
        let mut v = vec![
            0x53, // OP_3 (symbolLength = 3)
            0x10, // OP_PUSHBYTES_16
            // "BCH" || 0x08 (decimals) || "Bitcoin cash"
            b'B', b'C', b'H', 0x08, b'B', b'i', b't', b'c', b'o', b'i', b'n', b' ', b'c', b'a',
            b's', b'h',
            0x41, // OP_PUSHBYTES_65
        ];
        // 65 bytes of pubkey — synthetic but well-formed (uncompressed: 0x04 prefix + 64 random).
        v.push(0x04);
        for i in 0..64 {
            v.push(i as u8);
        }
        v.extend_from_slice(&CRC20_CONTRACT_TAIL);
        v
    }

    #[test]
    fn parses_crc20_bch_golden_vector() {
        let redeem = crc20_bch_redeem();
        let reveal = parse_crc20_redeem(&redeem).expect("must parse");
        assert_eq!(reveal.symbol_bytes, b"BCH");
        assert_eq!(reveal.symbol, "BCH");
        assert!(!reveal.symbol_is_hex);
        assert_eq!(reveal.decimals, 8);
        assert_eq!(reveal.name_bytes, b"Bitcoin cash");
        assert_eq!(reveal.name.as_deref(), Some("Bitcoin cash"));
        assert_eq!(reveal.recipient_pubkey.len(), 65);
        assert_eq!(reveal.recipient_pubkey[0], 0x04);
    }

    #[test]
    fn rejects_truncated_tail() {
        let mut redeem = crc20_bch_redeem();
        // Drop the last byte of the tail.
        redeem.pop();
        assert!(parse_crc20_redeem(&redeem).is_none());
    }

    #[test]
    fn rejects_extra_bytes_between_pubkey_and_tail() {
        let mut redeem = crc20_bch_redeem();
        // Insert a stray byte right before the tail.
        let tail_start = redeem.len() - CRC20_CONTRACT_TAIL.len();
        redeem.insert(tail_start, 0x00);
        assert!(parse_crc20_redeem(&redeem).is_none());
    }

    #[test]
    fn rejects_pubkey_wrong_size() {
        // 32-byte pubkey (neither 33 nor 65) — invalid.
        let mut v = vec![0x53, 0x10];
        v.extend_from_slice(b"BCH\x08Bitcoin cash");
        v.push(0x20); // OP_PUSHBYTES_32
        v.extend_from_slice(&[0u8; 32]);
        v.extend_from_slice(&CRC20_CONTRACT_TAIL);
        assert!(parse_crc20_redeem(&v).is_none());
    }

    #[test]
    fn rejects_metadata_too_short_for_decimals() {
        // symbolLength = 3 but metadata = 3 bytes (no decimals byte).
        let mut v = vec![0x53, 0x03, b'B', b'C', b'H', 0x21];
        v.extend_from_slice(&[0u8; 33]);
        v.extend_from_slice(&CRC20_CONTRACT_TAIL);
        assert!(parse_crc20_redeem(&v).is_none());
    }

    #[test]
    fn handles_empty_symbol() {
        // symbolLength = 0; metadata = 0x00 (decimals only, empty name).
        let mut v = vec![0x00, 0x01, 0x00, 0x21];
        v.extend_from_slice(&[0u8; 33]);
        v.extend_from_slice(&CRC20_CONTRACT_TAIL);
        let r = parse_crc20_redeem(&v).expect("empty symbol is valid");
        assert_eq!(r.symbol_bytes, b"");
        assert_eq!(r.symbol, "");
        assert!(!r.symbol_is_hex);
        assert_eq!(r.decimals, 0);
        assert!(r.name_bytes.is_empty());
    }

    #[test]
    fn handles_non_utf8_symbol_as_hex() {
        // Symbol bytes 0xff 0xff 0xff (invalid UTF-8 start sequence).
        let mut v = vec![0x53, 0x05, 0xff, 0xff, 0xff, 0x02, b'X', 0x21];
        v.extend_from_slice(&[0u8; 33]);
        v.extend_from_slice(&CRC20_CONTRACT_TAIL);
        let r = parse_crc20_redeem(&v).expect("must parse");
        assert_eq!(r.symbol_bytes, vec![0xff, 0xff, 0xff]);
        assert_eq!(r.symbol, "0xffffff");
        assert!(r.symbol_is_hex);
        assert_eq!(r.decimals, 2);
    }

    #[test]
    fn rejects_random_bytes() {
        let r = parse_crc20_redeem(&[0u8; 100]);
        assert!(r.is_none());
    }

    #[test]
    fn rejects_too_short() {
        assert!(parse_crc20_redeem(&[]).is_none());
        assert!(parse_crc20_redeem(&[0x53]).is_none());
        // Just the tail with no pushes — still too short for our ≥3-push requirement.
        assert!(parse_crc20_redeem(&CRC20_CONTRACT_TAIL).is_none());
    }

    #[test]
    fn parse_p2sh_unlock_two_pushes() {
        // <push 65 sig><push 105 redeem> — synthetic but valid layout.
        let mut sig = vec![0u8; 65];
        sig[0] = 0x30; // DER seq tag
        let redeem = crc20_bch_redeem();

        let mut scriptsig = vec![0x41]; // OP_PUSHBYTES_65 for sig
        scriptsig.extend_from_slice(&sig);
        scriptsig.push(0x4c); // OP_PUSHDATA1 for redeem
        scriptsig.push(redeem.len() as u8);
        scriptsig.extend_from_slice(&redeem);

        let (got_sig, got_redeem) = parse_p2sh_unlock(&scriptsig).expect("must parse");
        assert_eq!(got_sig, sig);
        assert_eq!(got_redeem, redeem);
    }

    #[test]
    fn parse_p2sh_unlock_rejects_one_push() {
        let scriptsig = vec![0x01, 0xaa];
        assert!(parse_p2sh_unlock(&scriptsig).is_none());
    }

    #[test]
    fn parse_p2sh_unlock_rejects_three_pushes() {
        let scriptsig = vec![0x01, 0xaa, 0x01, 0xbb, 0x01, 0xcc];
        assert!(parse_p2sh_unlock(&scriptsig).is_none());
    }

    #[test]
    fn hash160_matches_crc20_bch_marker() {
        // hash160("BCH") = 19a291607c61b5afd8e2aea357c6c0e3b0918422 per the
        // CRC-20 reference guide.
        let h = hash160(b"BCH");
        let expected =
            hex::decode("19a291607c61b5afd8e2aea357c6c0e3b0918422").unwrap();
        assert_eq!(h.to_vec(), expected);
    }

    #[test]
    fn verify_marker_output_accepts_canonical_p2pkh() {
        let mut script = vec![0x76, 0xa9, 0x14];
        script.extend_from_slice(&hash160(b"BCH"));
        script.extend_from_slice(&[0x88, 0xac]);
        assert!(verify_marker_output(b"BCH", &script));
    }

    #[test]
    fn verify_marker_output_rejects_wrong_hash() {
        let mut script = vec![0x76, 0xa9, 0x14];
        script.extend_from_slice(&hash160(b"NOT-BCH"));
        script.extend_from_slice(&[0x88, 0xac]);
        assert!(!verify_marker_output(b"BCH", &script));
    }

    #[test]
    fn verify_marker_output_rejects_non_p2pkh() {
        // P2SH (0xa9 0x14 ... 0x87) — wrong shape.
        let mut script = vec![0xa9, 0x14];
        script.extend_from_slice(&[0u8; 20]);
        script.push(0x87);
        assert!(!verify_marker_output(b"BCH", &script));
    }

    #[test]
    fn decode_script_num_matches_op_n_encodings() {
        assert_eq!(decode_script_num(&[]), Some(0));
        assert_eq!(decode_script_num(&[1]), Some(1));
        assert_eq!(decode_script_num(&[16]), Some(16));
        assert_eq!(decode_script_num(&[0x81]), Some(-1));
        assert_eq!(decode_script_num(&[0x7f]), Some(127));
        assert_eq!(decode_script_num(&[0x80, 0x80]), Some(-128));
    }
}
