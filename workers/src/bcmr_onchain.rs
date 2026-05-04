//! On-chain BCMR walker (Phase 4c).
//!
//! Walks the CashTokens authchain forward from each category's genesis tx via
//! BlockBook's `/api/v2/tx/{txid}` endpoint, parses the on-chain
//! `OP_RETURN BCMR <hash> <URI>` locator at each hop, and surfaces the latest
//! verified publication.
//!
//! Replaces (does not supplement) reliance on Paytaca's HTTP indexer for any
//! category that has an on-chain authchain. The Paytaca worker (Phase 4b)
//! stays as a fallback for brand-new categories the on-chain walker hasn't
//! visited yet.
//!
//! ## BCMR locator shape
//!
//! Per the CashTokens BCMR CHIP (<https://github.com/bitjson/chip-bcmr>):
//!
//! ```text
//! OP_RETURN
//!   <push 0x04> "BCMR"
//!   <push 0x20> <32-byte sha256 of the BCMR JSON body>
//!   <push N>    <UTF-8 URI string>
//! ```
//!
//! The hash bytes are stored in **natural** (big-endian) order — the bytes as
//! `sha2::Sha256::digest` produces. NOT reversed à la Bitcoin txid display.
//! If a real on-chain run shows systematic mismatches, flip and add a
//! regression test.

use anyhow::{Context, Result, anyhow};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::blockbook::{BlockbookClient, BlockbookTx};
use crate::icons::resolve_icon_url;
use crate::safe_http::{read_body_capped, validate_url_scheme};

// ---------------------------------------------------------------------------
// Locator parser
// ---------------------------------------------------------------------------

const OP_RETURN: u8 = 0x6a;
const OP_PUSHDATA1: u8 = 0x4c;
const OP_PUSHDATA2: u8 = 0x4d;
const OP_PUSHDATA4: u8 = 0x4e;
const BCMR_MAGIC: [u8; 4] = *b"BCMR";

/// A parsed `OP_RETURN BCMR <hash> <uri>` locator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BcmrLocator {
    /// SHA-256 of the BCMR JSON body, natural byte order (32 bytes).
    pub content_hash: [u8; 32],
    /// UTF-8 URI string. Raw — the publisher's exact bytes, not gateway-rewritten.
    pub uri: String,
}

/// Parse a single output's scriptPubKey hex. Returns `Some(BcmrLocator)` iff
/// the script matches the BCMR locator shape exactly. Any deviation
/// (truncation, wrong magic, wrong hash length, non-UTF-8 URI) returns None;
/// the caller logs and skips.
pub fn parse_bcmr_locator(script_hex: &str) -> Option<BcmrLocator> {
    let bytes = hex::decode(script_hex.trim()).ok()?;
    parse_bcmr_locator_bytes(&bytes)
}

/// Same as [`parse_bcmr_locator`] but takes raw script bytes.
pub fn parse_bcmr_locator_bytes(bytes: &[u8]) -> Option<BcmrLocator> {
    let mut cur = 0usize;

    // 1. OP_RETURN.
    if bytes.get(cur).copied() != Some(OP_RETURN) {
        return None;
    }
    cur += 1;

    // 2. Push of "BCMR" (4 bytes). Direct push 0x04 on the wire.
    let magic = read_push(bytes, &mut cur)?;
    if magic != BCMR_MAGIC {
        return None;
    }

    // 3. Push of 32-byte sha256 content hash.
    let hash_bytes = read_push(bytes, &mut cur)?;
    if hash_bytes.len() != 32 {
        return None;
    }
    let mut content_hash = [0u8; 32];
    content_hash.copy_from_slice(hash_bytes);

    // 4. Push of UTF-8 URI string. Cap at 2 KB defense-in-depth — BCH
    //    consensus already caps OP_RETURN to 223 bytes total, so a real
    //    confirmed locator's URI is well under 200 bytes. The 2 KB ceiling
    //    is generous against future consensus relaxation and rejects any
    //    malformed mempool tx BlockBook might return during transient
    //    inconsistency.
    let uri_bytes = read_push(bytes, &mut cur)?;
    if uri_bytes.is_empty() || uri_bytes.len() > 2048 {
        return None;
    }
    let uri = std::str::from_utf8(uri_bytes).ok()?.to_string();
    if uri.is_empty() {
        return None;
    }

    Some(BcmrLocator { content_hash, uri })
}

/// Read one Bitcoin Script push opcode + its data. Advances `cur`.
/// Returns the data slice. None on truncation or invalid opcode.
fn read_push<'a>(bytes: &'a [u8], cur: &mut usize) -> Option<&'a [u8]> {
    let op = *bytes.get(*cur)?;
    *cur += 1;

    let len: usize = match op {
        // Direct push of 1..=75 bytes.
        n if (0x01..=0x4b).contains(&n) => n as usize,
        OP_PUSHDATA1 => {
            let n = *bytes.get(*cur)? as usize;
            *cur += 1;
            n
        }
        OP_PUSHDATA2 => {
            let lo = *bytes.get(*cur)? as usize;
            let hi = *bytes.get(*cur + 1)? as usize;
            *cur += 2;
            (hi << 8) | lo
        }
        OP_PUSHDATA4 => {
            let b0 = *bytes.get(*cur)? as usize;
            let b1 = *bytes.get(*cur + 1)? as usize;
            let b2 = *bytes.get(*cur + 2)? as usize;
            let b3 = *bytes.get(*cur + 3)? as usize;
            *cur += 4;
            (b3 << 24) | (b2 << 16) | (b1 << 8) | b0
        }
        _ => return None,
    };

    let end = cur.checked_add(len)?;
    if end > bytes.len() {
        return None;
    }
    let data = &bytes[*cur..end];
    *cur = end;
    Some(data)
}

/// Find the first BCMR locator across a transaction's outputs.
///
/// Per the CHIP, only one locator per tx is meaningful (the head update); if
/// a publisher includes more than one, the spec is silent on precedence.
/// We pick the first by output index — predictable, easy to reason about.
pub fn find_locator_in_tx(tx: &BlockbookTx) -> Option<BcmrLocator> {
    for vout in &tx.vout {
        if let Some(hex_script) = vout.hex.as_deref()
            && let Some(loc) = parse_bcmr_locator(hex_script)
        {
            return Some(loc);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Authchain walker
// ---------------------------------------------------------------------------

/// One step in the authchain: a tx that holds the identity output at index 0.
/// The `locator` is `Some` iff this tx ALSO carried a BCMR `OP_RETURN`
/// publication; many authchain hops don't (e.g. wallet moves of the identity
/// token without a metadata update).
#[derive(Debug, Clone)]
pub struct AuthchainHop {
    /// 32-byte txid of this hop's transaction.
    pub txid: [u8; 32],
    /// Block height of confirmation. None if the tx is in the mempool.
    pub block_height: Option<i64>,
    /// Block timestamp (Unix seconds). None if mempool.
    pub block_time: Option<i64>,
    /// BCMR locator if this hop carried one.
    pub locator: Option<BcmrLocator>,
    /// True iff this is the current authchain head (vout[0] is unspent).
    pub is_head: bool,
}

/// Result of a successful (non-error) authchain walk.
///
/// `hit_max_hops` is `true` iff the walk stopped at the configured bound
/// without observing the head (i.e. `vout[0]` of the last hop was spent).
/// Operators want this signal because a publisher can extend the chain
/// past the bound (each hop is cheap dust) to hide their current head;
/// the walker stays correct (uses the latest verified locator within the
/// bound) but the run summary needs to surface the hit so it can be
/// alerted on.
#[derive(Debug, Clone)]
pub struct WalkOutcome {
    pub hops: Vec<AuthchainHop>,
    pub hit_max_hops: bool,
}

/// Walk the authchain forward from `genesis_txid` via BlockBook, following
/// `vout[0].spent_tx_id` until None.
///
/// Returns the full ordered hop list (oldest first) plus a flag indicating
/// whether `max_hops` was hit. Legitimate authchains are very short (1-5
/// hops); the bound is a safety against runaway chains and dust-attacks
/// trying to push the head past the indexer's reach.
pub async fn walk_authchain(
    bb: &BlockbookClient,
    genesis_txid: &[u8; 32],
    max_hops: usize,
) -> Result<WalkOutcome> {
    let mut hops: Vec<AuthchainHop> = Vec::new();
    let mut cur_txid = hex::encode(genesis_txid);

    for hop_index in 0..max_hops {
        let tx = bb
            .get_tx(&cur_txid)
            .await
            .with_context(|| format!("walk hop {} txid {}", hop_index, &cur_txid[..16]))?;

        let mut txid_bytes = [0u8; 32];
        let raw = hex::decode(&tx.txid).with_context(|| format!("decode txid {}", &tx.txid[..16]))?;
        if raw.len() != 32 {
            return Err(anyhow!("BlockBook returned non-32-byte txid: {}", tx.txid));
        }
        txid_bytes.copy_from_slice(&raw);

        let locator = find_locator_in_tx(&tx);

        // The identity output is at vout[0] per the CashTokens BCMR CHIP.
        // If the tx has no vout[0] at all (corrupt response), bail.
        let v0 = tx
            .vout
            .iter()
            .find(|v| v.n == 0)
            .ok_or_else(|| anyhow!("tx {} has no vout[0]", &tx.txid[..16]))?;
        let is_head = v0.spent_tx_id.is_none();

        hops.push(AuthchainHop {
            txid: txid_bytes,
            block_height: tx.block_height,
            block_time: tx.block_time,
            locator,
            is_head,
        });

        if is_head {
            return Ok(WalkOutcome { hops, hit_max_hops: false });
        }

        // v0.spent_tx_id is Some at this point.
        cur_txid = v0
            .spent_tx_id
            .clone()
            .ok_or_else(|| anyhow!("unreachable: spent_tx_id None after is_head check"))?;
    }

    tracing::warn!(
        max_hops,
        last_txid = &cur_txid[..16.min(cur_txid.len())],
        "authchain walk hit max_hops bound; stopping"
    );
    Ok(WalkOutcome { hops, hit_max_hops: true })
}

// ---------------------------------------------------------------------------
// Body fetch + hash verify
// ---------------------------------------------------------------------------

/// Outcome of fetching + hashing a BCMR JSON body.
#[derive(Debug)]
pub enum FetchedBody {
    /// Fetch succeeded and sha256(body) matched the locator's content_hash.
    Verified { bytes: Vec<u8>, size: usize },
    /// Fetch succeeded but sha256(body) != content_hash. Bytes returned for
    /// debugging; caller MUST NOT trust them as canonical.
    Mismatch {
        bytes: Vec<u8>,
        size: usize,
        observed_sha256: [u8; 32],
    },
    /// Fetch failed (network, scheme rejection, oversize, HTTP error).
    Error(String),
}

/// Fetch the BCMR JSON pointed at by `uri` and verify its sha256 matches
/// `expected_hash` (natural byte order).
///
/// SSRF defenses inherited from the shared client + `resolve_icon_url`:
/// - `ipfs://<cid>` → canonical https IPFS gateway.
/// - `https://<cid>.ipfs.<host>/...` → re-pinned to canonical gateway.
/// - `http://`, `data:`, `file:`, etc. → rejected at the scheme gate.
/// - DNS-resolved-IP allowlist runs at the connector layer (private,
///   loopback, link-local, cloud metadata all dropped).
///
/// Caller's `client` MUST be built via `safe_http::safe_client_builder` so the
/// SSRF resolver applies on every connect AND every redirect.
pub async fn fetch_and_verify_bcmr(
    client: &reqwest::Client,
    uri: &str,
    expected_hash: &[u8; 32],
    max_body_bytes: usize,
) -> FetchedBody {
    let url = match resolve_icon_url(uri) {
        Some(u) => u,
        None => return FetchedBody::Error(format!("unresolvable URI scheme: {}", uri)),
    };
    if let Err(e) = validate_url_scheme(&url, false) {
        return FetchedBody::Error(format!("refused: {}", e));
    }

    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => return FetchedBody::Error(format!("send: {}", e)),
    };
    if !resp.status().is_success() {
        return FetchedBody::Error(format!("HTTP {}", resp.status().as_u16()));
    }
    if let Some(cl) = resp.content_length()
        && cl > max_body_bytes as u64
    {
        return FetchedBody::Error(format!(
            "content-length {} exceeds cap {}",
            cl, max_body_bytes
        ));
    }

    let bytes = match read_body_capped(resp, max_body_bytes).await {
        Ok(b) => b,
        Err(e) => return FetchedBody::Error(format!("body: {}", e)),
    };

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let observed: [u8; 32] = hasher.finalize().into();
    let size = bytes.len();

    if &observed == expected_hash {
        FetchedBody::Verified { bytes, size }
    } else {
        FetchedBody::Mismatch {
            bytes,
            size,
            observed_sha256: observed,
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: assemble a valid BCMR locator script with a direct-push URI.
    fn make_script(uri: &[u8], hash: &[u8; 32]) -> Vec<u8> {
        let mut s = vec![OP_RETURN, 0x04, b'B', b'C', b'M', b'R', 0x20];
        s.extend_from_slice(hash);
        // URI push — choose direct vs PUSHDATA1 vs PUSHDATA2 by length.
        if uri.len() <= 0x4b {
            s.push(uri.len() as u8);
        } else if uri.len() <= 0xff {
            s.push(OP_PUSHDATA1);
            s.push(uri.len() as u8);
        } else {
            s.push(OP_PUSHDATA2);
            s.push((uri.len() & 0xff) as u8);
            s.push(((uri.len() >> 8) & 0xff) as u8);
        }
        s.extend_from_slice(uri);
        s
    }

    fn dummy_hash() -> [u8; 32] {
        let mut h = [0u8; 32];
        for (i, b) in h.iter_mut().enumerate() {
            *b = i as u8;
        }
        h
    }

    #[test]
    fn parses_valid_short_uri() {
        let uri = b"https://example.com/bcmr.json";
        let script = make_script(uri, &dummy_hash());
        let parsed = parse_bcmr_locator_bytes(&script).expect("parses");
        assert_eq!(parsed.content_hash, dummy_hash());
        assert_eq!(parsed.uri, "https://example.com/bcmr.json");
    }

    #[test]
    fn parses_valid_pushdata1_uri() {
        // 100-byte URI exercises OP_PUSHDATA1.
        let uri = vec![b'a'; 100];
        let script = make_script(&uri, &dummy_hash());
        // Confirm the test helper actually emitted PUSHDATA1.
        // OP_RETURN(1) + push04+BCMR(5) + push20+hash(33) = byte 39 should be 0x4c.
        assert_eq!(script[39], OP_PUSHDATA1, "test helper emitted PUSHDATA1");
        let parsed = parse_bcmr_locator_bytes(&script).expect("parses");
        assert_eq!(parsed.uri.len(), 100);
        assert!(parsed.uri.chars().all(|c| c == 'a'));
    }

    #[test]
    fn parses_valid_pushdata2_uri() {
        // 300-byte URI exercises OP_PUSHDATA2.
        let uri = vec![b'b'; 300];
        let script = make_script(&uri, &dummy_hash());
        assert_eq!(script[39], OP_PUSHDATA2, "test helper emitted PUSHDATA2");
        let parsed = parse_bcmr_locator_bytes(&script).expect("parses");
        assert_eq!(parsed.uri.len(), 300);
    }

    #[test]
    fn parses_ipfs_uri() {
        let uri = b"ipfs://QmYZ4P5XzG6XjYj1nFmU3ZxKqYz7G6XjYj1nFmU3ZxKqYz";
        let script = make_script(uri, &dummy_hash());
        let parsed = parse_bcmr_locator_bytes(&script).expect("parses");
        assert!(parsed.uri.starts_with("ipfs://"));
    }

    #[test]
    fn rejects_wrong_magic() {
        // "BCMS" instead of "BCMR".
        let mut script = vec![OP_RETURN, 0x04, b'B', b'C', b'M', b'S', 0x20];
        script.extend_from_slice(&dummy_hash());
        script.push(0x10);
        script.extend_from_slice(b"https://x.io/y");
        assert!(parse_bcmr_locator_bytes(&script).is_none());
    }

    #[test]
    fn rejects_short_hash() {
        // Hash push declared as 31 bytes instead of 32.
        let mut script = vec![OP_RETURN, 0x04, b'B', b'C', b'M', b'R', 0x1f];
        script.extend_from_slice(&[0u8; 31]);
        script.push(0x10);
        script.extend_from_slice(b"https://x.io/y");
        assert!(parse_bcmr_locator_bytes(&script).is_none());
    }

    #[test]
    fn rejects_long_hash() {
        // Hash push declared as 33 bytes.
        let mut script = vec![OP_RETURN, 0x04, b'B', b'C', b'M', b'R', 0x21];
        script.extend_from_slice(&[0u8; 33]);
        script.push(0x10);
        script.extend_from_slice(b"https://x.io/y");
        assert!(parse_bcmr_locator_bytes(&script).is_none());
    }

    #[test]
    fn rejects_non_op_return() {
        // P2PKH-shaped script (OP_DUP OP_HASH160 <push20> ...). Not OP_RETURN.
        let mut script = vec![0x76, 0xa9, 0x14];
        script.extend_from_slice(&[0u8; 20]);
        script.extend_from_slice(&[0x88, 0xac]);
        assert!(parse_bcmr_locator_bytes(&script).is_none());
    }

    #[test]
    fn rejects_op_return_without_bcmr() {
        // OP_RETURN with some other payload.
        let script = vec![OP_RETURN, 0x04, b'D', b'A', b'T', b'A', 0x05, 1, 2, 3, 4, 5];
        assert!(parse_bcmr_locator_bytes(&script).is_none());
    }

    #[test]
    fn rejects_truncated_after_magic() {
        let script = vec![OP_RETURN, 0x04, b'B', b'C', b'M', b'R'];
        assert!(parse_bcmr_locator_bytes(&script).is_none());
    }

    #[test]
    fn rejects_truncated_mid_hash() {
        // Declares 32-byte push but only supplies 10.
        let mut script = vec![OP_RETURN, 0x04, b'B', b'C', b'M', b'R', 0x20];
        script.extend_from_slice(&[0u8; 10]);
        assert!(parse_bcmr_locator_bytes(&script).is_none());
    }

    #[test]
    fn rejects_truncated_mid_uri() {
        let mut script = vec![OP_RETURN, 0x04, b'B', b'C', b'M', b'R', 0x20];
        script.extend_from_slice(&dummy_hash());
        script.push(0x20); // declares 32-byte URI push
        script.extend_from_slice(b"only-five"); // supplies 9
        assert!(parse_bcmr_locator_bytes(&script).is_none());
    }

    #[test]
    fn rejects_empty_uri() {
        // Push declared as 0 bytes.
        let mut script = vec![OP_RETURN, 0x04, b'B', b'C', b'M', b'R', 0x20];
        script.extend_from_slice(&dummy_hash());
        script.push(0x00);
        assert!(parse_bcmr_locator_bytes(&script).is_none());
    }

    #[test]
    fn rejects_oversized_uri() {
        // 2049-byte URI exceeds the defense-in-depth cap. Uses
        // OP_PUSHDATA2 since the length doesn't fit in a single byte.
        let uri = vec![b'a'; 2049];
        let script = make_script(&uri, &dummy_hash());
        assert_eq!(script[39], OP_PUSHDATA2, "test helper emitted PUSHDATA2");
        assert!(parse_bcmr_locator_bytes(&script).is_none());

        // 2048-byte URI is exactly at the cap and accepted.
        let uri_at_cap = vec![b'b'; 2048];
        let script_at_cap = make_script(&uri_at_cap, &dummy_hash());
        let parsed = parse_bcmr_locator_bytes(&script_at_cap).expect("at-cap URI parses");
        assert_eq!(parsed.uri.len(), 2048);
    }

    #[test]
    fn rejects_invalid_utf8_uri() {
        // Push 4 bytes that aren't valid UTF-8 (lone continuation bytes).
        let mut script = vec![OP_RETURN, 0x04, b'B', b'C', b'M', b'R', 0x20];
        script.extend_from_slice(&dummy_hash());
        script.push(0x04);
        script.extend_from_slice(&[0xc0, 0xc1, 0xfe, 0xff]);
        assert!(parse_bcmr_locator_bytes(&script).is_none());
    }

    #[test]
    fn rejects_unknown_opcode_in_push_position() {
        // 0x5a is not a push opcode (it's OP_PICK).
        let script = vec![OP_RETURN, 0x5a];
        assert!(parse_bcmr_locator_bytes(&script).is_none());
    }

    #[test]
    fn parses_from_hex_string_with_whitespace() {
        let uri = b"https://x.io/y";
        let mut script = make_script(uri, &dummy_hash());
        // hex_to_bytes accepts trim()'d input — pad with whitespace.
        let hex_padded = format!("  {}  ", hex::encode(&script));
        let parsed = parse_bcmr_locator(&hex_padded).expect("parses");
        assert_eq!(parsed.uri, "https://x.io/y");
        // Mutate to ensure local variable wasn't optimized away.
        script[0] = 0x00;
        assert_eq!(script[0], 0x00);
    }

    #[test]
    fn parses_from_hex_string_invalid_hex_returns_none() {
        assert!(parse_bcmr_locator("not-hex-bytes!!!").is_none());
    }

    #[test]
    fn empty_input_returns_none() {
        assert!(parse_bcmr_locator_bytes(&[]).is_none());
    }

    /// Real-shape sanity test: scriptPubKey hex captured by hand from a
    /// hypothetical BCMR-bearing tx. If a real on-chain example becomes
    /// available, replace the hash with the actual sha256 of a checked-in
    /// fixture body and add a fetch-and-verify test against it.
    #[test]
    fn parses_realistic_full_locator() {
        // OP_RETURN | <push BCMR> | <push 32-byte hash> | <push 73-byte URI>
        let uri = b"https://raw.githubusercontent.com/Panmoni/bcmrs/main/SAMPLE/token.json";
        assert!(uri.len() <= 0x4b, "test uses direct-push URI");
        let script = make_script(uri, &dummy_hash());
        let parsed = parse_bcmr_locator_bytes(&script).expect("parses");
        assert_eq!(parsed.uri, std::str::from_utf8(uri).unwrap());
        assert_eq!(parsed.content_hash, dummy_hash());
    }
}
