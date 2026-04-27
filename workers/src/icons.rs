//! Icon safety pipeline — pure logic.
//!
//! Reusable building blocks for the periodic `sync-icons` worker and the
//! one-shot `sync-icons-backfill`. Everything here is IO-light or
//! IO-free so it's exhaustively unit-testable.
//!
//! Plan reference: docs/icon-safety-plan.md (Phase A, step 2).

use anyhow::{Context, Result, anyhow};
use image::{DynamicImage, ImageFormat, ImageReader, Limits};
use sha2::{Digest, Sha256};
use std::io::Cursor;
use std::time::Duration;

/// Hard cap on icon bytes. Anything larger is presumed adversarial and
/// short-circuits to a `blocked / oversize` decision before any CPU is
/// spent decoding it.
pub const ICON_SIZE_CAP_BYTES: usize = 2 * 1024 * 1024;

/// Decoded-image allocation cap. A 2 MiB highly-compressible PNG (e.g.
/// 30k×30k indexed-color all-zeros) decodes to ~3.6 GB; the byte cap above
/// only protects the network path. 64 MiB is generous for a UI thumbnail
/// and aborts decompression bombs hard.
pub const DECODED_ALLOC_CAP_BYTES: u64 = 64 * 1024 * 1024;

/// HTTP timeout per icon fetch. Generous because IPFS gateways can be slow
/// on first-byte; tighter than this and we'd false-fail healthy icons.
pub const FETCH_TIMEOUT: Duration = Duration::from_secs(20);

/// WebP encode quality (0-100). 80 strikes a clean tradeoff between size
/// and visual quality for small UI icons; the perceptual loss on a 64×64
/// thumbnail is invisible.
pub const WEBP_QUALITY: u8 = 80;

/// Public IPFS gateway used to dereference `ipfs://` URIs. Mirrors the
/// hard-coded gateway in [`src/lib/format.ts#getIPFSUrl`] — keep in sync
/// if either side changes.
pub const IPFS_GATEWAY: &str = "https://ipfs.io/ipfs/";

#[derive(Debug)]
pub enum FetchOutcome {
    /// Bytes fetched, hashed, within the size cap.
    Ok { bytes: Vec<u8>, sha256: [u8; 32] },
    /// Content-Length header (or actual body) exceeded `ICON_SIZE_CAP_BYTES`.
    Oversize { observed_bytes: usize },
    /// Network/HTTP failure, OR the URI scheme couldn't be resolved to a
    /// safe `https://` URL (e.g., `data:`, `file:`, unknown scheme).
    /// Caller will retry on a future tick; the URL row records the error
    /// string for operator visibility.
    NetworkError(String),
}

/// Resolve a BCMR-style icon URI to a fetchable `https://` URL, mirroring
/// the TS-side [`src/lib/format.ts#getIPFSUrl`] resolver. Returns `None`
/// for URIs we can't (or won't) fetch:
///
/// - `ipfs://<cid>` → `https://ipfs.io/ipfs/<cid>` (canonical BCMR form)
/// - `https://<cid>.ipfs.nftstorage.link/...` → unchanged (already a
///   resolved CID-on-subdomain URL — pass through)
/// - `https://<cid>.ipfs.nftstorage.link/` (no path) → `https://ipfs.io/ipfs/<cid>`
/// - `https://...` → unchanged
/// - `http://...` → **rejected** (we don't fetch insecure schemes; an
///   on-chain BCMR pointing at `http://` is either user error or attacker
///   probing for SSRF gadgets)
/// - `data:image/...` → rejected (we don't re-upload data URIs; the entire
///   point of this pipeline is content-addressed re-hosting)
/// - Anything else → rejected
///
/// The defense-in-depth point is twofold:
///   1. Without resolution, ~80% of BCMR icons (which use `ipfs://`) would
///      fail to fetch via reqwest (which doesn't speak `ipfs://`).
///   2. The `https://`-only floor is an SSRF guard against issuer-controlled
///      `http://127.0.0.1:5432/`, `file:///etc/passwd`, etc.
pub fn resolve_icon_url(uri: &str) -> Option<String> {
    // Strip whitespace; some BCMR docs include accidental leading/trailing
    // newlines in JSON string fields.
    let uri = uri.trim();
    if uri.is_empty() {
        return None;
    }

    // ipfs://<cid>... — the canonical BCMR form.
    if let Some(rest) = uri.strip_prefix("ipfs://") {
        if rest.is_empty() {
            return None;
        }
        return Some(format!("{}{}", IPFS_GATEWAY, rest));
    }

    // Already-https NFT.Storage CID-on-subdomain. Two shapes:
    //   https://<cid>.ipfs.nftstorage.link/<path>   ← pass through, has content
    //   https://<cid>.ipfs.nftstorage.link/         ← rewrite to gateway form
    // (The TS helper does the same dance.)
    if let Some(rest) = uri.strip_prefix("https://")
        && let Some(dot_idx) = rest.find(".ipfs.nftstorage.link")
    {
        let cid = &rest[..dot_idx];
        let after = &rest[dot_idx + ".ipfs.nftstorage.link".len()..];
        if after.is_empty() || after == "/" {
            // Bare subdomain — rewrite to gateway form.
            return Some(format!("{}{}", IPFS_GATEWAY, cid));
        }
        // Has a content path — pass the original URI through.
        return Some(uri.to_string());
    }

    // Plain `https://`. Pass-through, but reject `http://` (no-`s`).
    if uri.starts_with("https://") {
        return Some(uri.to_string());
    }

    // `data:`, `file:`, `http:`, `ftp:`, javascript:, anything weird → reject.
    None
}

/// GET an icon URL with the configured size cap + timeout.
///
/// Resolves the URI through [`resolve_icon_url`] first, so callers can
/// pass raw BCMR-supplied URIs (including `ipfs://<cid>`) directly. Any
/// URI that doesn't resolve to a safe `https://` URL returns
/// [`FetchOutcome::NetworkError`] with a descriptive message.
///
/// We DO NOT trust the server's `Content-Length` — we apply the cap to the
/// actually-received bytes. That way an attacker that lies in the header
/// (e.g. claims 1 KB then streams a 1 GB blob) can't bypass the cap.
pub async fn fetch_and_hash(client: &reqwest::Client, uri: &str) -> FetchOutcome {
    // 1. Resolve the URI to a safe https:// URL. This is also the point at
    //    which `ipfs://` becomes fetchable and `http://` / `file://` /
    //    `data:` are refused.
    let url = match resolve_icon_url(uri) {
        Some(u) => u,
        None => {
            return FetchOutcome::NetworkError(format!("unresolvable URI scheme: {}", uri));
        }
    };

    // Caller's reqwest client should already restrict redirects (the
    // bootstrap binary sets Policy::limited(2)). The .timeout() here
    // belt-and-braces the per-request limit even if a future caller
    // forgets to set a client-level timeout.
    let resp = match client.get(&url).timeout(FETCH_TIMEOUT).send().await {
        Ok(r) => r,
        Err(e) => return FetchOutcome::NetworkError(format!("send: {}", e)),
    };

    if !resp.status().is_success() {
        return FetchOutcome::NetworkError(format!("HTTP {}", resp.status().as_u16()));
    }

    // Defensive content-length precheck. If the server declares more than
    // the cap upfront, bail before reading the body. Doesn't replace the
    // post-read check below.
    if let Some(cl) = resp.content_length()
        && cl as usize > ICON_SIZE_CAP_BYTES
    {
        return FetchOutcome::Oversize { observed_bytes: cl as usize };
    }

    let bytes = match resp.bytes().await {
        Ok(b) => b,
        Err(e) => return FetchOutcome::NetworkError(format!("body: {}", e)),
    };

    if bytes.len() > ICON_SIZE_CAP_BYTES {
        return FetchOutcome::Oversize { observed_bytes: bytes.len() };
    }

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let sha256: [u8; 32] = hasher.finalize().into();

    FetchOutcome::Ok { bytes: bytes.to_vec(), sha256 }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NsfwOutcome {
    /// Score >= block threshold. Bytes deleted, state='blocked' reason='adult'.
    Block,
    /// review_threshold <= score < block_threshold. Operator decides via
    /// the runbook query. Renders as placeholder until then.
    Review,
    /// Score < review_threshold. Transcode + serve.
    Clear,
}

/// Classify a normalised SafeSearch score against env-driven thresholds.
///
/// Boundary semantics — explicit so the unit tests pin them:
///   score >= block_threshold              → Block
///   review_threshold <= score < block_th  → Review
///   score < review_threshold              → Clear
pub fn classify_nsfw(score: f32, block_threshold: f32, review_threshold: f32) -> NsfwOutcome {
    if score >= block_threshold {
        NsfwOutcome::Block
    } else if score >= review_threshold {
        NsfwOutcome::Review
    } else {
        NsfwOutcome::Clear
    }
}

/// Decode bytes into a `DynamicImage`, applying a strict allocation cap to
/// short-circuit decompression bombs.
///
/// Failure here means the bytes are NOT a valid still raster (or are an
/// image bomb). The caller should treat decode failures as a permanent
/// `state='blocked' reason='unsupported_format'` decision — re-trying
/// won't help; the bytes won't suddenly become valid.
///
/// Animated inputs (multi-frame GIF / APNG) are accepted by the decoder
/// but decode to the FIRST frame only — which is what we want (no
/// animation served). The animated-format extension filter in
/// `src/lib/format.ts` already rejects most of these at URL parse time.
pub fn decode_image(bytes: &[u8]) -> Result<DynamicImage> {
    // Sniff format from the bytes (don't trust `Content-Type` or extension).
    let format = image::guess_format(bytes).context("could not guess image format")?;

    // Reject formats we don't want to serve. SVG is not supported by the
    // `image` crate at all so it'd fail at decode anyway, but this gives
    // us a clear error message.
    let supported = matches!(
        format,
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP | ImageFormat::Gif
    );
    if !supported {
        return Err(anyhow!("unsupported image format: {:?}", format));
    }

    // Apply the decompression-bomb cap. `image` 0.25's Limits struct gates
    // BOTH the dimensions AND the total allocation (which is what we
    // actually care about — a 30k×30k indexed-color PNG passes any
    // reasonable dimension cap but allocates GBs).
    let mut limits = Limits::default();
    limits.max_alloc = Some(DECODED_ALLOC_CAP_BYTES);

    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(limits);
    let img = reader.decode().context("decode failed")?;
    Ok(img)
}

/// Encode a decoded image to a static WebP. Failure here means the
/// `image` crate's WebP encoder couldn't serialize a successfully-decoded
/// image — almost always a transient library bug, NOT a property of the
/// input bytes. The caller should leave the URL pending so a future
/// library version can retry.
pub fn encode_to_webp(img: &DynamicImage) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    img.write_to(&mut Cursor::new(&mut out), ImageFormat::WebP)
        .context("WebP encode failed")?;
    Ok(out)
}

/// Convenience: decode then encode in one call. Used by the test suite
/// and by callers that don't need to distinguish the two failure modes.
/// Production callers (sync-icons-backfill) should use the split form so
/// they can apply different retry policies per failure type.
pub fn transcode_to_webp(bytes: &[u8]) -> Result<Vec<u8>> {
    let img = decode_image(bytes)?;
    encode_to_webp(&img)
}

// ---------------------------------------------------------------------------
// Tests — `cargo test --release --lib icons`
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a tiny in-memory PNG (4×4 solid color) for fixture use via the
    /// `image` crate's own encoder. Avoids embedding binary blobs and any
    /// risk of hand-rolled bytes drifting out of spec.
    fn make_png_fixture() -> Vec<u8> {
        use image::{ImageBuffer, Rgb};
        let img: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::from_fn(4, 4, |_, _| Rgb([200, 100, 50]));
        let mut out = Vec::new();
        img.write_to(&mut Cursor::new(&mut out), ImageFormat::Png)
            .expect("encode test PNG");
        out
    }

    #[test]
    fn classify_nsfw_at_thresholds() {
        // score == block threshold => Block (>= boundary)
        assert_eq!(classify_nsfw(0.9, 0.9, 0.6), NsfwOutcome::Block);
        // score just below block threshold => Review
        assert_eq!(classify_nsfw(0.899, 0.9, 0.6), NsfwOutcome::Review);
        // score == review threshold => Review
        assert_eq!(classify_nsfw(0.6, 0.9, 0.6), NsfwOutcome::Review);
        // score just below review threshold => Clear
        assert_eq!(classify_nsfw(0.599, 0.9, 0.6), NsfwOutcome::Clear);
        // 0.0 => Clear
        assert_eq!(classify_nsfw(0.0, 0.9, 0.6), NsfwOutcome::Clear);
        // 1.0 => Block
        assert_eq!(classify_nsfw(1.0, 0.9, 0.6), NsfwOutcome::Block);
    }

    #[test]
    fn sha256_stable_across_runs() {
        let bytes = make_png_fixture();
        let mut h1 = Sha256::new();
        h1.update(&bytes);
        let h1: [u8; 32] = h1.finalize().into();
        let mut h2 = Sha256::new();
        h2.update(&bytes);
        let h2: [u8; 32] = h2.finalize().into();
        assert_eq!(h1, h2);
    }

    #[test]
    fn transcode_static_png_to_webp() {
        let png = make_png_fixture();
        let webp = transcode_to_webp(&png).expect("transcode");
        // WebP files start with the RIFF header.
        assert!(webp.starts_with(b"RIFF"));
        // The 8th-12th bytes are "WEBP".
        assert_eq!(&webp[8..12], b"WEBP");
    }

    #[test]
    fn transcode_unsupported_format_rejects() {
        // Random non-image bytes.
        let bytes = b"not an image, just text";
        let result = transcode_to_webp(bytes);
        assert!(result.is_err(), "expected error on non-image bytes");
    }

    #[test]
    fn transcode_truncated_png_rejects() {
        // Just the signature, no IHDR/IDAT.
        let bytes = vec![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        let result = transcode_to_webp(&bytes);
        assert!(result.is_err(), "expected error on truncated PNG");
    }

    #[test]
    fn decode_image_round_trip() {
        let png = make_png_fixture();
        let img = decode_image(&png).expect("decode");
        assert_eq!(img.width(), 4);
        assert_eq!(img.height(), 4);
    }

    #[test]
    fn resolver_handles_ipfs_scheme() {
        assert_eq!(
            resolve_icon_url("ipfs://bafybeihash/icon.png").as_deref(),
            Some("https://ipfs.io/ipfs/bafybeihash/icon.png")
        );
    }

    #[test]
    fn resolver_passes_through_https() {
        assert_eq!(
            resolve_icon_url("https://example.com/icon.png").as_deref(),
            Some("https://example.com/icon.png")
        );
    }

    #[test]
    fn resolver_rewrites_nftstorage_subdomain() {
        // Bare subdomain → rewrite to gateway form.
        assert_eq!(
            resolve_icon_url("https://bafybeihash.ipfs.nftstorage.link/").as_deref(),
            Some("https://ipfs.io/ipfs/bafybeihash")
        );
        // With path → pass through unchanged (already a usable URL).
        assert_eq!(
            resolve_icon_url("https://bafybeihash.ipfs.nftstorage.link/icon.png").as_deref(),
            Some("https://bafybeihash.ipfs.nftstorage.link/icon.png")
        );
    }

    #[test]
    fn resolver_rejects_http_and_data_and_file() {
        // SSRF surface: insecure http, file://, data:, and unknown schemes.
        assert!(resolve_icon_url("http://example.com/icon.png").is_none());
        assert!(resolve_icon_url("file:///etc/passwd").is_none());
        assert!(resolve_icon_url("data:image/png;base64,iVBORw0KGgoA").is_none());
        assert!(resolve_icon_url("javascript:alert(1)").is_none());
        assert!(resolve_icon_url("ftp://example.com/icon.png").is_none());
        assert!(resolve_icon_url("gopher://example.com/icon").is_none());
    }

    #[test]
    fn resolver_handles_empty_and_whitespace() {
        assert!(resolve_icon_url("").is_none());
        assert!(resolve_icon_url("   ").is_none());
        assert!(resolve_icon_url("ipfs://").is_none()); // empty CID
        // Trim whitespace before resolving (BCMR JSON sometimes has stray newlines).
        assert_eq!(
            resolve_icon_url("  ipfs://x  ").as_deref(),
            Some("https://ipfs.io/ipfs/x")
        );
    }

    #[test]
    fn resolver_rejects_localhost_targets() {
        // SSRF defense — only `https://` schemes are accepted, so any
        // attempt to point at http://127.0.0.1 / http://169.254.169.254
        // (cloud metadata) is rejected at the scheme gate.
        assert!(resolve_icon_url("http://127.0.0.1:5432/").is_none());
        assert!(resolve_icon_url("http://169.254.169.254/latest/meta-data/").is_none());
        assert!(resolve_icon_url("http://localhost/admin").is_none());
        // Note: `https://127.0.0.1/` would PASS the scheme check. The redirect
        // policy on the reqwest Client (Policy::limited(2)) and the live
        // network path are responsible for enforcing this; the resolver only
        // gates schemes.
    }
}
