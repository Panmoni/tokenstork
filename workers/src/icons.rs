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

use crate::safe_http::{read_body_capped, validate_url_scheme};

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

/// Maximum render dimension (px) for rasterized SVG. An SVG can declare
/// a 100k×100k viewBox in a few hundred bytes, which would allocate ~40
/// GB of pixels. Cap each side proportionally so the largest output is
/// 1024 px — generous for any UI thumbnail use, hard limit on bombs.
pub const SVG_MAX_RENDER_DIM: u32 = 1024;

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
/// - `https://<cid>.ipfs.<gateway>/<path>` (any *.ipfs.* subdomain shape)
///   → `https://ipfs.io/ipfs/<cid>/<path>`. This pins every IPFS fetch
///   to the operator-controlled canonical gateway. Without this, an
///   attacker who acquires a discontinued gateway's domain (NftStorage
///   shut down in 2024; its old `nftstorage.link` URLs litter on-chain
///   BCMR records) would get to serve attacker-chosen bytes for any
///   record using it. CID-content-addressing is preserved: the canonical
///   gateway returns the same content the URL committed to.
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
///      `http://127.0.0.1:5432/`, `file:///etc/passwd`, etc. The actual
///      DNS-resolved-IP allowlist runs at fetch time in `safe_http`.
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

    // Any `https://<cid>.ipfs.<host>[/path]` form — rewrite to the canonical
    // pinned gateway. Catches nftstorage.link, w3s.link, dweb.link,
    // gateway.pinata.cloud subdomain shape, etc. The CID is the
    // first hostname label; any subsequent .ipfs.<host> means the path
    // following <host> is the in-CID path.
    if let Some(rest) = uri.strip_prefix("https://") {
        // Split host from path: the first `/` after the authority delimits.
        let (authority, path) = match rest.find('/') {
            Some(slash) => (&rest[..slash], &rest[slash..]),
            None => (rest, ""),
        };
        // Look for the `.ipfs.` infix in the authority portion only.
        if let Some(dot_idx) = authority.find(".ipfs.") {
            let cid = &authority[..dot_idx];
            // CIDs are alphanumeric (base32 / base58); require a sane
            // shape so we don't rewrite arbitrary non-CID subdomains.
            if !cid.is_empty() && cid.chars().all(|c| c.is_ascii_alphanumeric()) {
                let path_clean = if path.is_empty() || path == "/" { "" } else { path };
                return Some(format!("{}{}{}", IPFS_GATEWAY, cid, path_clean));
            }
        }
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
/// SSRF defenses, in layers:
///   1. [`resolve_icon_url`] rejects `http:`, `file:`, `data:`, etc. at
///      the scheme gate.
///   2. [`validate_url_scheme`] catches `https://127.0.0.1` literals.
///   3. The shared client is built via [`crate::safe_http::safe_client_builder`]
///      which installs a custom DNS resolver that drops every answer in
///      private / loopback / link-local space. The resolver runs on every
///      connect — including per-redirect re-resolution — so a hostile
///      302 to an internal host is refused at the connector layer.
///
/// We DO NOT trust the server's `Content-Length` — we apply the cap to the
/// actually-received bytes via streaming. That way an attacker that lies
/// in the header (claims 1 KB then streams a 1 GB blob) can't bypass it.
pub async fn fetch_and_hash(client: &reqwest::Client, uri: &str) -> FetchOutcome {
    // 1. Scheme + IPFS rewrite. Returns None for any URI we won't fetch.
    let url = match resolve_icon_url(uri) {
        Some(u) => u,
        None => {
            return FetchOutcome::NetworkError(format!("unresolvable URI scheme: {}", uri));
        }
    };
    // 2. Pre-flight literal-IP check. Cheap; saves a round-trip when
    //    a BCMR record points at an IP that's already disallowed.
    if let Err(e) = validate_url_scheme(&url, false) {
        return FetchOutcome::NetworkError(format!("refused: {}", e));
    }

    // Caller's reqwest client must be built via safe_client_builder so
    // the SSRF resolver applies. The .timeout() here belt-and-braces
    // the per-request limit.
    let resp = match client.get(&url).timeout(FETCH_TIMEOUT).send().await {
        Ok(r) => r,
        Err(e) => return FetchOutcome::NetworkError(format!("send: {}", e)),
    };

    if !resp.status().is_success() {
        return FetchOutcome::NetworkError(format!("HTTP {}", resp.status().as_u16()));
    }

    // Defensive content-length precheck. If the server declares more than
    // the cap upfront, bail before reading the body. Doesn't replace the
    // streaming check below.
    if let Some(cl) = resp.content_length()
        && cl > ICON_SIZE_CAP_BYTES as u64
    {
        return FetchOutcome::Oversize { observed_bytes: cl as usize };
    }

    // Streamed body read with a hard cap. read_body_capped returns Err
    // if the stream exceeds the cap; map that into Oversize so the
    // upstream policy is consistent with the content-length precheck.
    let bytes = match read_body_capped(resp, ICON_SIZE_CAP_BYTES).await {
        Ok(b) => b,
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("exceeds") {
                return FetchOutcome::Oversize { observed_bytes: ICON_SIZE_CAP_BYTES + 1 };
            }
            return FetchOutcome::NetworkError(format!("body: {}", msg));
        }
    };

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let sha256: [u8; 32] = hasher.finalize().into();

    FetchOutcome::Ok { bytes, sha256 }
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

/// Cheap pre-decode check: does this look like an SVG document?
///
/// `image::guess_format` only sniffs raster magic bytes, so SVG (an XML
/// text format) trips it. We do a tiny prefix probe instead — the bytes
/// must be valid UTF-8 and start with `<svg`, or with an XML / DOCTYPE /
/// comment prologue that contains `<svg` within the first ~2 KiB. That's
/// tight enough to avoid false positives on arbitrary text files.
fn looks_like_svg(bytes: &[u8]) -> bool {
    let head_len = bytes.len().min(2048);
    let head = match std::str::from_utf8(&bytes[..head_len]) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let trimmed = head.trim_start_matches('\u{FEFF}').trim_start();
    if trimmed.starts_with("<svg") {
        return true;
    }
    if trimmed.starts_with("<?xml") || trimmed.starts_with("<!DOCTYPE") || trimmed.starts_with("<!--") {
        return head.contains("<svg");
    }
    false
}

/// Rasterize SVG bytes to PNG via `resvg`.
///
/// Security model — what makes serving SVG-derived icons safe:
///   - `resvg` is a parser+renderer, not a browser. It does NOT execute
///     `<script>`, evaluate `on*` event handlers, or run CSS animations.
///   - We install a no-op `resolve_string` on the `image_href_resolver`
///     so a hostile `<image href="http://attacker/log">` (tracking),
///     `<image href="file:///etc/passwd">` (filesystem disclosure), or
///     any relative path resolved against the worker's CWD is *refused*
///     at parse time. The default `resolve_data` is kept so legitimately
///     embedded `data:image/png;base64,...` raster payloads still render.
///   - `<foreignObject>` (HTML-in-SVG) is not parsed by usvg at all —
///     the element is dropped during tree construction, so its contents
///     never reach the renderer.
///   - usvg uses `roxmltree` for XML parsing; `roxmltree` does not
///     support custom DTD entity declarations, so the classic
///     "billion laughs" entity-expansion bomb (`<!ENTITY lol ...>`)
///     fails to expand and the document is rejected.
///   - Output is a PNG. The browser only ever sees the static raster.
///
/// Decompression-bomb defenses:
///   - We refuse to allocate more than [`SVG_MAX_RENDER_DIM`] per side;
///     larger viewBoxes are scaled down to fit.
///   - [`ICON_SIZE_CAP_BYTES`] (applied in [`fetch_and_hash`]) caps the
///     SVG payload itself at 2 MiB, which transitively bounds the depth
///     of `<use>` chains and the size of `<filter>` kernel matrices.
///   - The output PNG flows back through [`decode_raster`] which applies
///     [`DECODED_ALLOC_CAP_BYTES`] — a second guard against pathological
///     intermediates.
fn rasterize_svg(bytes: &[u8]) -> Result<Vec<u8>> {
    let mut opt = usvg::Options::default();
    // Defense in depth: refuse every non-data href, regardless of
    // `resources_dir`. The default `resolve_string` would join the href
    // against `resources_dir` and try to read from the filesystem; we
    // never want that on a worker process. Data URIs (the only legitimate
    // way to embed a raster inside an SVG icon) are still decoded by the
    // unchanged `resolve_data`.
    opt.image_href_resolver = usvg::ImageHrefResolver {
        resolve_data: usvg::ImageHrefResolver::default_data_resolver(),
        resolve_string: Box::new(|_, _| None),
    };
    let tree = usvg::Tree::from_data(bytes, &opt).context("parse SVG")?;

    let size = tree.size().to_int_size();
    let (svg_w, svg_h) = (size.width(), size.height());
    if svg_w == 0 || svg_h == 0 {
        return Err(anyhow!("SVG has zero dimensions"));
    }

    let max_dim = svg_w.max(svg_h);
    let scale = if max_dim > SVG_MAX_RENDER_DIM {
        SVG_MAX_RENDER_DIM as f32 / max_dim as f32
    } else {
        1.0
    };
    let render_w = ((svg_w as f32 * scale).round() as u32).max(1);
    let render_h = ((svg_h as f32 * scale).round() as u32).max(1);

    let mut pixmap = tiny_skia::Pixmap::new(render_w, render_h)
        .ok_or_else(|| anyhow!("alloc {}x{} pixmap failed", render_w, render_h))?;

    let transform = tiny_skia::Transform::from_scale(scale, scale);
    resvg::render(&tree, transform, &mut pixmap.as_mut());

    // `Pixmap::encode_png` un-premultiplies alpha for us, so the PNG
    // output is straight RGBA — what every downstream consumer expects.
    pixmap.encode_png().context("PNG encode of rasterized SVG")
}

/// Result of [`decode_image`]. `vision_bytes` is `Some(png)` when the
/// caller MUST send these bytes to Cloud Vision instead of the original
/// (Vision returns `Bad image data` on SVG and other non-raster inputs);
/// `None` when the original bytes are themselves a Vision-acceptable
/// raster.
pub struct DecodedImage {
    pub image: DynamicImage,
    pub vision_bytes: Option<Vec<u8>>,
}

/// Decode bytes into a [`DecodedImage`], applying a strict allocation cap
/// to short-circuit decompression bombs. Transparently rasterizes SVG
/// inputs via `resvg` so the rest of the pipeline (Vision NSFW + CSAM +
/// WebP transcode) can treat them like any other still raster.
///
/// Failure here means the bytes are NOT a valid still raster, NOT a
/// parseable SVG, or are an image bomb. The caller should treat decode
/// failures as a permanent `state='blocked' reason='unsupported_format'`
/// decision — re-trying won't help; the bytes won't suddenly become
/// valid.
///
/// Animated inputs (multi-frame GIF / APNG) are accepted by the decoder
/// but decode to the FIRST frame only — which is what we want (no
/// animation served). The animated-format extension filter in
/// `src/lib/format.ts` already rejects most of these at URL parse time.
pub fn decode_image(bytes: &[u8]) -> Result<DecodedImage> {
    if looks_like_svg(bytes) {
        let png = rasterize_svg(bytes)?;
        let image = decode_raster(&png)?;
        return Ok(DecodedImage { image, vision_bytes: Some(png) });
    }
    let image = decode_raster(bytes)?;
    Ok(DecodedImage { image, vision_bytes: None })
}

fn decode_raster(bytes: &[u8]) -> Result<DynamicImage> {
    // Sniff format from the bytes (don't trust `Content-Type` or extension).
    let format = image::guess_format(bytes).context("could not guess image format")?;

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
    let decoded = decode_image(bytes)?;
    encode_to_webp(&decoded.image)
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
        let decoded = decode_image(&png).expect("decode");
        assert_eq!(decoded.image.width(), 4);
        assert_eq!(decoded.image.height(), 4);
        // Raster input → caller sends original bytes to Vision.
        assert!(decoded.vision_bytes.is_none(), "raster input should not need re-encoded vision bytes");
    }

    #[test]
    fn looks_like_svg_recognises_common_shapes() {
        assert!(looks_like_svg(b"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\"></svg>"));
        assert!(looks_like_svg(
            b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\"></svg>"
        ));
        // BOM + leading whitespace.
        assert!(looks_like_svg(b"\xEF\xBB\xBF\n  <svg></svg>"));
        // DOCTYPE prologue.
        assert!(looks_like_svg(b"<!DOCTYPE svg PUBLIC \"-//W3C//DTD SVG 1.1//EN\">\n<svg></svg>"));
    }

    #[test]
    fn looks_like_svg_rejects_non_svg() {
        assert!(!looks_like_svg(b"\x89PNG\r\n\x1a\n"));
        assert!(!looks_like_svg(b"<html><body>hi</body></html>"));
        assert!(!looks_like_svg(b"<?xml version=\"1.0\"?><rss></rss>"));
        // Non-UTF-8 — raster bytes never accidentally look like SVG.
        assert!(!looks_like_svg(&[0xff, 0xd8, 0xff, 0xe0]));
    }

    #[test]
    fn rasterize_svg_round_trips_via_decode() {
        // 32×32 red square — minimal SVG that resvg accepts.
        let svg = br##"<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" fill="#ff0000"/></svg>"##;
        let decoded = decode_image(svg).expect("svg decode");
        assert_eq!(decoded.image.width(), 32);
        assert_eq!(decoded.image.height(), 32);
        // SVG path MUST surface vision bytes — original SVG would crash Vision.
        let vision_bytes = decoded.vision_bytes.expect("svg path should produce vision_bytes");
        // Vision-side bytes are PNG (signature 89 50 4E 47 …).
        assert!(vision_bytes.starts_with(&[0x89, 0x50, 0x4e, 0x47]));
        // And the raster must transcode cleanly to WebP (the eventual served form).
        let webp = encode_to_webp(&decoded.image).expect("webp encode");
        assert!(webp.starts_with(b"RIFF"));
        assert_eq!(&webp[8..12], b"WEBP");
    }

    #[test]
    fn rasterize_svg_caps_oversized_viewbox() {
        // 100k × 50k declared viewBox — naive rendering would be ~20 GB.
        // Cap clamps the larger side to SVG_MAX_RENDER_DIM.
        let svg = br##"<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="50000" viewBox="0 0 100000 50000"><rect width="100000" height="50000" fill="#00ff00"/></svg>"##;
        let decoded = decode_image(svg).expect("oversized svg decode");
        assert!(decoded.image.width() <= SVG_MAX_RENDER_DIM);
        assert!(decoded.image.height() <= SVG_MAX_RENDER_DIM);
        // Aspect ratio preserved (within a px of rounding).
        assert_eq!(decoded.image.width(), SVG_MAX_RENDER_DIM);
        assert_eq!(decoded.image.height(), SVG_MAX_RENDER_DIM / 2);
    }

    #[test]
    fn rasterize_svg_refuses_external_image_href() {
        // An <image> with a remote / file:// / relative href would, under
        // usvg's default resolver, attempt to load bytes from disk. Our
        // override returns None for every non-data href, so the document
        // still rasterizes cleanly (the <image> element renders empty)
        // without any I/O — the rest of the SVG is unaffected.
        let svg = br##"<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
            <rect width="32" height="32" fill="#ff0000"/>
            <image href="file:///etc/passwd" x="0" y="0" width="32" height="32"/>
            <image href="http://attacker.example/log" x="0" y="0" width="32" height="32"/>
            <image href="../../../../etc/shadow" x="0" y="0" width="32" height="32"/>
        </svg>"##;
        let decoded = decode_image(svg).expect("svg-with-external-hrefs must still rasterize");
        assert_eq!(decoded.image.width(), 32);
        assert_eq!(decoded.image.height(), 32);
        assert!(decoded.vision_bytes.is_some());
    }

    #[test]
    fn rasterize_svg_with_script_tag_still_parses_inert() {
        // `resvg` parses but does not execute `<script>`. We just want to
        // confirm the document round-trips into a DynamicImage rather than
        // erroring out — proving that "SVG with script" is a valid input
        // we can safely rasterize.
        let svg = br##"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><script>alert(1)</script><rect width="16" height="16" fill="blue"/></svg>"##;
        let decoded = decode_image(svg).expect("svg-with-script decode");
        assert_eq!(decoded.image.width(), 16);
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
    fn resolver_rewrites_any_ipfs_subdomain_to_canonical_gateway() {
        // Bare subdomain → rewrite to gateway form.
        assert_eq!(
            resolve_icon_url("https://bafybeihash.ipfs.nftstorage.link/").as_deref(),
            Some("https://ipfs.io/ipfs/bafybeihash")
        );
        // Subdomain with path → pin to canonical gateway, preserve path.
        // Without this, an attacker who acquires a discontinued gateway
        // domain (e.g. nftstorage.link, shut down 2024) gets to serve
        // arbitrary bytes for any record using it.
        assert_eq!(
            resolve_icon_url("https://bafybeihash.ipfs.nftstorage.link/icon.png").as_deref(),
            Some("https://ipfs.io/ipfs/bafybeihash/icon.png")
        );
        // Same handling for any other subdomain gateway.
        assert_eq!(
            resolve_icon_url("https://bafybeihash.ipfs.dweb.link/icon.png").as_deref(),
            Some("https://ipfs.io/ipfs/bafybeihash/icon.png")
        );
        assert_eq!(
            resolve_icon_url("https://bafybeihash.ipfs.w3s.link/").as_deref(),
            Some("https://ipfs.io/ipfs/bafybeihash")
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
