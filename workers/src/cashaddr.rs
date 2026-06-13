//! CashAddr encoder (BCH mainnet). Produces the address body *without* the
//! `bitcoincash:` prefix, matching exactly how `token_holders.address` and
//! `nft_instances.owner_address` are stored (see [`crate::blockbook::normalize_address`],
//! which strips the same prefix off BlockBook-supplied addresses).
//!
//! ## Why this exists
//!
//! The periodic `enrich` worker got holder/owner addresses *pre-decoded* from
//! BlockBook's `/api/v2/address` walk. The event-driven replacement
//! ([`crate::enrich_walker`]) derives enrichment from BCHN block data directly,
//! where each output exposes only its raw `scriptPubKey` bytes — no decoded
//! address. We encode the owner cashaddr locally from the locking bytecode so
//! the persisted holder/NFT attribution is byte-identical to what the
//! BlockBook path produced. (We only ever encode *new* outputs; spent outputs
//! reuse the address already stored on the `live_token_utxo` row.)
//!
//! Scope: the three standard, address-bearing locking templates — P2PKH,
//! P2SH20, P2SH32 — in both their raw and CashToken-prefixed (`0xef…`) forms.
//! Anything else (bare pubkey, OP_RETURN, nonstandard) returns `None`, which
//! mirrors BlockBook surfacing no address: the UTXO's amount still counts
//! toward supply, but it attributes to no holder.

use crate::tapswap::extract_p2pkh_pkh;

/// Base32 alphabet used by CashAddr (NOT RFC4648 — bech32 ordering).
const CHARSET: &[u8; 32] = b"qpzry9x8gf2tvdw0s3jn54khce6mua7l";

/// Mainnet human-readable prefix. The checksum is computed over this prefix
/// even though we strip it from the stored form.
const PREFIX: &str = "bitcoincash";

/// CashTokens locking-bytecode marker. A token-bearing UTXO prefixes the
/// standard locking script with `0xef` + category/commitment/amount; the
/// standard script is always the *suffix* (same convention
/// [`extract_p2pkh_pkh`] relies on).
const PREFIX_TOKEN: u8 = 0xef;

// CashAddr version byte = (type << 3) | size-code. Top bit always 0.
//   type: 0 = P2PKH, 1 = P2SH.   size-code: 0 = 160-bit, 3 = 256-bit.
const VER_P2PKH: u8 = 0x00; // type 0, 20-byte hash
const VER_P2SH20: u8 = 0x08; // type 1, 20-byte hash
const VER_P2SH32: u8 = 0x0b; // type 1, 32-byte hash

/// CashAddr checksum polymod over 5-bit symbols (BCH spec constants).
fn polymod(values: &[u8]) -> u64 {
    let mut c: u64 = 1;
    for &d in values {
        let c0 = (c >> 35) as u8;
        c = ((c & 0x07ff_ffff_ff) << 5) ^ u64::from(d);
        if c0 & 0x01 != 0 {
            c ^= 0x98f2_bc8e_61;
        }
        if c0 & 0x02 != 0 {
            c ^= 0x79b7_6d99_e2;
        }
        if c0 & 0x04 != 0 {
            c ^= 0xf33e_5fb3_c4;
        }
        if c0 & 0x08 != 0 {
            c ^= 0xae2e_abe2_a8;
        }
        if c0 & 0x10 != 0 {
            c ^= 0x1e4f_43e4_70;
        }
    }
    c ^ 1
}

/// Repack 8-bit bytes into 5-bit groups, zero-padding the final partial
/// group. CashAddr payload sizes (21 or 33 bytes) always pad cleanly.
fn convert_bits_8_to_5(data: &[u8]) -> Vec<u8> {
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    let mut out = Vec::with_capacity(data.len() * 8 / 5 + 1);
    for &b in data {
        acc = (acc << 8) | u32::from(b);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(((acc >> bits) & 0x1f) as u8);
        }
    }
    if bits > 0 {
        out.push(((acc << (5 - bits)) & 0x1f) as u8);
    }
    out
}

/// Encode `version` + `hash` into the prefix-less CashAddr body.
fn encode_body(version: u8, hash: &[u8]) -> String {
    let mut payload = Vec::with_capacity(1 + hash.len());
    payload.push(version);
    payload.extend_from_slice(hash);
    let payload5 = convert_bits_8_to_5(&payload);

    // checksum input = prefix(low 5 bits each) ++ 0(separator) ++ payload ++ 8 zero placeholders
    let mut checksum_input: Vec<u8> = PREFIX.bytes().map(|c| c & 0x1f).collect();
    checksum_input.push(0);
    checksum_input.extend_from_slice(&payload5);
    checksum_input.extend_from_slice(&[0u8; 8]);
    let modulus = polymod(&checksum_input);

    let mut out = String::with_capacity(payload5.len() + 8);
    for &d in &payload5 {
        out.push(CHARSET[d as usize] as char);
    }
    for i in 0..8 {
        let symbol = ((modulus >> (5 * (7 - i))) & 0x1f) as usize;
        out.push(CHARSET[symbol] as char);
    }
    out
}

/// Recognize a P2SH locking script (raw or CashToken-prefixed) and return
/// its `(version_byte, hash)`. The standard script is the suffix in both
/// forms, exactly as in [`extract_p2pkh_pkh`].
fn extract_p2sh(script: &[u8]) -> Option<(u8, &[u8])> {
    let len = script.len();
    let token_prefixed = script.first() == Some(&PREFIX_TOKEN);

    // P2SH20: OP_HASH160 <push-20> <hash> OP_EQUAL  =  a9 14 .. 87  (23 bytes)
    if len == 23 || (token_prefixed && len > 23) {
        let s = &script[len - 23..];
        if s[0] == 0xa9 && s[1] == 0x14 && s[22] == 0x87 {
            return Some((VER_P2SH20, &s[2..22]));
        }
    }
    // P2SH32: OP_HASH256 <push-32> <hash> OP_EQUAL  =  aa 20 .. 87  (35 bytes)
    if len == 35 || (token_prefixed && len > 35) {
        let s = &script[len - 35..];
        if s[0] == 0xaa && s[1] == 0x20 && s[34] == 0x87 {
            return Some((VER_P2SH32, &s[2..34]));
        }
    }
    None
}

/// Encode a locking script to its CashAddr body (no `bitcoincash:` prefix),
/// or `None` for non-address-bearing / nonstandard scripts.
pub fn script_to_cashaddr_body(script: &[u8]) -> Option<String> {
    if let Some(pkh) = extract_p2pkh_pkh(script) {
        return Some(encode_body(VER_P2PKH, &pkh));
    }
    if let Some((version, hash)) = extract_p2sh(script) {
        return Some(encode_body(version, hash));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p2pkh_script(pkh: &[u8; 20]) -> Vec<u8> {
        let mut s = vec![0x76, 0xa9, 0x14];
        s.extend_from_slice(pkh);
        s.extend_from_slice(&[0x88, 0xac]);
        s
    }

    /// Canonical CashAddr spec vector (Bitcoin ABC): P2PKH hash
    /// 76a04053bda0a88bda5177b86a15c3b29f559873 →
    /// bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a
    #[test]
    fn p2pkh_matches_canonical_spec_vector() {
        let pkh: [u8; 20] =
            hex::decode("76a04053bda0a88bda5177b86a15c3b29f559873")
                .unwrap()
                .try_into()
                .unwrap();
        let body = script_to_cashaddr_body(&p2pkh_script(&pkh)).expect("p2pkh decodes");
        assert_eq!(body, "qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a");
    }

    /// A CashToken-prefixed P2PKH must encode to the same address as the raw
    /// form — the token data is irrelevant to ownership.
    #[test]
    fn token_prefixed_p2pkh_equals_raw() {
        let pkh = [0x11u8; 20];
        let raw = script_to_cashaddr_body(&p2pkh_script(&pkh)).unwrap();

        // 0xef + 32-byte category + (no commitment) + the 25-byte P2PKH suffix.
        let mut prefixed = vec![PREFIX_TOKEN];
        prefixed.extend_from_slice(&[0xab; 32]);
        prefixed.extend_from_slice(&p2pkh_script(&pkh));
        let got = script_to_cashaddr_body(&prefixed).unwrap();

        assert_eq!(got, raw);
        assert!(raw.starts_with('q'), "P2PKH body starts with q");
        assert_eq!(raw.len(), 42, "20-byte payload encodes to 42 chars");
    }

    /// P2SH20 encodes to a 42-char body beginning with `p` (the version-byte
    /// high bits select 'p' for type-1/160-bit).
    #[test]
    fn p2sh20_structural() {
        let mut s = vec![0xa9, 0x14];
        s.extend_from_slice(&[0x22; 20]);
        s.push(0x87);
        let body = script_to_cashaddr_body(&s).expect("p2sh20 decodes");
        assert!(body.starts_with('p'), "P2SH body starts with p, got {body}");
        assert_eq!(body.len(), 42);
    }

    /// P2SH32 (256-bit) encodes to a longer body, also beginning with `p`.
    #[test]
    fn p2sh32_structural() {
        let mut s = vec![0xaa, 0x20];
        s.extend_from_slice(&[0x33; 32]);
        s.push(0x87);
        let body = script_to_cashaddr_body(&s).expect("p2sh32 decodes");
        assert!(body.starts_with('p'));
        assert!(body.len() > 42, "32-byte payload is longer than 20-byte");
    }

    #[test]
    fn nonstandard_scripts_have_no_address() {
        assert!(script_to_cashaddr_body(&[0x6a, 0x04, 1, 2, 3, 4]).is_none()); // OP_RETURN
        assert!(script_to_cashaddr_body(&[]).is_none());
        assert!(script_to_cashaddr_body(&[0x00; 10]).is_none());
    }
}
