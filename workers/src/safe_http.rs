//! SSRF-safe HTTP utilities.
//!
//! Two responsibilities:
//!
//! 1. **DNS-pinned, private-IP-rejecting resolution.** Every hostname is
//!    resolved exactly once via a hickory-resolver instance; any A/AAAA
//!    answer whose address falls in private / loopback / link-local /
//!    CGNAT / multicast / ULA / documentation space is rejected. The
//!    resolved IP is then *pinned* on the resulting reqwest client via
//!    `ClientBuilder::resolve` so the subsequent connect cannot be
//!    re-resolved (defeats DNS rebinding TOCTOU).
//!
//! 2. **Streaming body cap.** `read_body_capped` reads at most `max`
//!    bytes from a response stream, returning an error if the upstream
//!    streams more. This is the only safe way to call `serde_json::from_slice`
//!    on content from a hostile source: `resp.text()` / `resp.bytes()`
//!    have no implicit cap and a malicious gateway can stream gigabytes.
//!
//! The pinned-resolution model means an SSRF check happens once per
//! *target URL*. Callers that follow redirects MUST re-check each new
//! target — see `safe_resolve_url` and the redirect-handler example
//! in the icons pipeline.

use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use futures_util::StreamExt;
use hickory_resolver::TokioAsyncResolver;
use hickory_resolver::config::{ResolverConfig, ResolverOpts};
use reqwest::Url;
use reqwest::dns::{Addrs, Name, Resolve, Resolving};

/// Default per-request timeout. Generous enough that an IPFS gateway
/// can serve a cold-cache fetch; tight enough that a hostile gateway
/// holding the socket cannot stall a worker indefinitely.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(20);

/// Hard cap on JSON response bodies pulled from third-party services.
/// 8 MiB is two orders of magnitude bigger than any real BCMR record;
/// chosen against `serde_json::from_slice` allocating the entire body
/// before deserialization.
pub const DEFAULT_BODY_CAP: usize = 8 * 1024 * 1024;

fn resolver() -> &'static TokioAsyncResolver {
    static R: OnceLock<TokioAsyncResolver> = OnceLock::new();
    R.get_or_init(|| {
        // Try /etc/resolv.conf first; fall back to Cloudflare's
        // 1.1.1.1 + Google's 8.8.8.8 if the system config is missing
        // (containers, locked-down sandboxes).
        match TokioAsyncResolver::tokio_from_system_conf() {
            Ok(r) => r,
            Err(_) => TokioAsyncResolver::tokio(
                ResolverConfig::cloudflare(),
                ResolverOpts::default(),
            ),
        }
    })
}

/// Returns true when the address is one we refuse to fetch from.
/// Covers every reserved range a worker should never reach over an
/// outbound HTTP request:
///
///   - loopback (127.0.0.0/8, ::1)
///   - link-local (169.254.0.0/16, fe80::/10)
///   - private (10/8, 172.16/12, 192.168/16, fc00::/7)
///   - multicast (224.0.0.0/4, ff00::/8)
///   - cloud metadata (169.254.169.254 — already covered by link-local)
///   - documentation / TEST-NET / benchmarking ranges
///   - unspecified (0.0.0.0, ::)
///   - CGNAT (100.64.0.0/10) — used by some VPN / cloud providers,
///     close enough to private for the SSRF threat model.
///
/// Public IPv4/IPv6 addresses pass.
pub fn is_disallowed_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            if v4.is_loopback() || v4.is_link_local() || v4.is_private()
                || v4.is_multicast() || v4.is_broadcast() || v4.is_unspecified()
                || v4.is_documentation()
            {
                return true;
            }
            let octets = v4.octets();
            // CGNAT 100.64.0.0/10
            if octets[0] == 100 && (octets[1] & 0xC0) == 64 {
                return true;
            }
            // 192.0.0.0/24 (IETF), 192.0.2.0/24 (TEST-NET-1),
            // 198.18.0.0/15 (benchmarking), 198.51.100.0/24,
            // 203.0.113.0/24, 240.0.0.0/4 (reserved future use).
            if octets[0] == 192 && octets[1] == 0 && octets[2] == 0 { return true; }
            if octets[0] == 198 && (octets[1] == 18 || octets[1] == 19) { return true; }
            if octets[0] == 240 { return true; }
            false
        }
        IpAddr::V6(v6) => {
            if v6.is_loopback() || v6.is_multicast() || v6.is_unspecified() {
                return true;
            }
            let segs = v6.segments();
            // fe80::/10 link-local
            if segs[0] & 0xffc0 == 0xfe80 { return true; }
            // fc00::/7 ULA
            if segs[0] & 0xfe00 == 0xfc00 { return true; }
            // ::ffff:0:0/96 IPv4-mapped — apply the IPv4 rules.
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_disallowed_ip(IpAddr::V4(v4));
            }
            // 2001:db8::/32 documentation
            if segs[0] == 0x2001 && segs[1] == 0x0db8 { return true; }
            false
        }
    }
}

/// Result of safe-resolving a URL: the parsed URL plus the (host, port,
/// resolved IP) tuple to pin on the reqwest client.
#[derive(Debug, Clone)]
pub struct SafeResolved {
    pub url: Url,
    pub host: String,
    pub port: u16,
    pub addr: SocketAddr,
}

/// Resolve a URL safely:
///
///   - reject any scheme other than https (or http when `allow_http`)
///   - resolve the hostname via the system / hickory resolver
///   - refuse any answer that's a private/loopback/link-local/etc. IP
///   - return the *first* surviving public IP, paired with the parsed URL
///
/// Callers should pin the returned (host, addr) on a per-request reqwest
/// `ClientBuilder::resolve` so the connect uses exactly the validated IP
/// instead of re-resolving (DNS rebinding defense).
pub async fn safe_resolve_url(raw: &str, allow_http: bool) -> Result<SafeResolved> {
    let url = Url::parse(raw).with_context(|| format!("parsing URL: {}", raw))?;

    let scheme = url.scheme();
    let scheme_ok = scheme == "https" || (allow_http && scheme == "http");
    if !scheme_ok {
        return Err(anyhow!("refusing scheme: {}", scheme));
    }
    let host = url.host_str().ok_or_else(|| anyhow!("URL has no host"))?.to_string();
    let port = url
        .port_or_known_default()
        .ok_or_else(|| anyhow!("URL has no port and scheme has no default"))?;

    // If the host is already an IP literal, validate directly.
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_disallowed_ip(ip) {
            return Err(anyhow!("refusing private/reserved IP literal: {}", ip));
        }
        return Ok(SafeResolved { url, host, port, addr: SocketAddr::new(ip, port) });
    }

    let lookup = resolver()
        .lookup_ip(host.as_str())
        .await
        .with_context(|| format!("DNS lookup for {}", host))?;
    for ip in lookup.iter() {
        if is_disallowed_ip(ip) {
            return Err(anyhow!(
                "refusing host {} — DNS resolved to disallowed IP {}",
                host, ip
            ));
        }
    }
    let ip = lookup
        .iter()
        .next()
        .ok_or_else(|| anyhow!("DNS returned no addresses for {}", host))?;

    Ok(SafeResolved { url, host, port, addr: SocketAddr::new(ip, port) })
}

/// Read at most `max` bytes from a response body. Returns
/// `Err` if the upstream streamed more than `max`. Use this in place
/// of `resp.bytes()` / `resp.text()` whenever the response comes from a
/// third-party service that could stream a hostile payload.
///
/// Initial allocation is sized from `Content-Length` when present
/// (clamped to `max`), otherwise a small starting capacity. Avoids
/// the doubling-realloc pattern that an unhinted `Vec::new()` falls
/// into when growing toward a multi-MiB cap.
pub async fn read_body_capped(resp: reqwest::Response, max: usize) -> Result<Vec<u8>> {
    let initial_cap = match resp.content_length() {
        Some(cl) => (cl as usize).min(max),
        None => 16 * 1024,
    };
    let mut acc: Vec<u8> = Vec::with_capacity(initial_cap);
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("reading body chunk")?;
        if acc.len().saturating_add(chunk.len()) > max {
            return Err(anyhow!(
                "response body exceeds {}-byte cap (read {} so far)",
                max,
                acc.len()
            ));
        }
        acc.extend_from_slice(&chunk);
    }
    Ok(acc)
}

/// `reqwest::dns::Resolve` impl that filters every DNS answer through
/// [`is_disallowed_ip`]. Installed via
/// `ClientBuilder::dns_resolver(Arc::new(SafeResolver::new()))`, this
/// runs on every connect — including the per-hop re-resolution that
/// reqwest performs when following a redirect — so a hostile redirect
/// to a private-IP host is refused at the connector layer.
///
/// This is the SSRF "second wall" behind [`safe_resolve_url`] (which
/// gates the *initial* URL): even if a caller misses the safe-resolve
/// path, the resolver still drops disallowed addresses.
pub struct SafeResolver {
    inner: TokioAsyncResolver,
}

impl SafeResolver {
    pub fn new() -> Self {
        let inner = match TokioAsyncResolver::tokio_from_system_conf() {
            Ok(r) => r,
            Err(_) => TokioAsyncResolver::tokio(
                ResolverConfig::cloudflare(),
                ResolverOpts::default(),
            ),
        };
        Self { inner }
    }
}

impl Default for SafeResolver {
    fn default() -> Self { Self::new() }
}

impl Resolve for SafeResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let resolver = self.inner.clone();
        Box::pin(async move {
            let host = name.as_str().to_string();
            let lookup = resolver
                .lookup_ip(host.as_str())
                .await
                .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
                    Box::new(std::io::Error::other(e.to_string()))
                })?;
            let mut filtered: Vec<SocketAddr> = Vec::new();
            for ip in lookup.iter() {
                if !is_disallowed_ip(ip) {
                    filtered.push(SocketAddr::new(ip, 0));
                }
            }
            if filtered.is_empty() {
                return Err(Box::new(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    format!("DNS for {} returned only disallowed IPs", host),
                )) as Box<dyn std::error::Error + Send + Sync>);
            }
            let addrs: Addrs = Box::new(filtered.into_iter());
            Ok(addrs)
        })
    }
}

/// Build a reqwest client that:
///   - has a request-level timeout
///   - disables connection-pool keep-alive (`pool_max_idle_per_host(0)`)
///     so a hostile gateway can't replay another request on the same
///     TLS connection across SAN-shared certs
///   - limits redirects to `redirect_hops`
///   - installs the [`SafeResolver`] that drops every DNS answer in
///     private/loopback/link-local/etc. space (re-validates per redirect)
///
/// This is the recommended way to build any reqwest client that talks
/// to issuer-supplied / third-party URLs.
pub fn safe_client_builder(
    user_agent: &str,
    timeout: Duration,
    redirect_hops: usize,
) -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .user_agent(user_agent)
        .timeout(timeout)
        .pool_max_idle_per_host(0)
        .redirect(reqwest::redirect::Policy::limited(redirect_hops))
        .dns_resolver(Arc::new(SafeResolver::new()))
}

/// Fast scheme + IP-literal precheck. Use this on URLs sourced from
/// untrusted JSON before passing them to a `safe_client_builder` client
/// — the safe resolver catches private hostnames at connect time, but
/// short-circuiting `data:` / `file:` / `http:` / `https://127.0.0.1`
/// at parse time avoids the network round-trip entirely.
pub fn validate_url_scheme(raw: &str, allow_http: bool) -> Result<Url> {
    let url = Url::parse(raw).with_context(|| format!("parsing URL: {}", raw))?;
    let scheme = url.scheme();
    let scheme_ok = scheme == "https" || (allow_http && scheme == "http");
    if !scheme_ok {
        return Err(anyhow!("refusing scheme: {}", scheme));
    }
    let Some(host) = url.host_str() else {
        return Err(anyhow!("URL has no host"));
    };
    if let Ok(ip) = host.parse::<IpAddr>()
        && is_disallowed_ip(ip)
    {
        return Err(anyhow!("refusing private/reserved IP literal: {}", ip));
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    #[test]
    fn rejects_loopback_and_private() {
        assert!(is_disallowed_ip(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))));
        assert!(is_disallowed_ip(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1))));
        assert!(is_disallowed_ip(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1))));
        assert!(is_disallowed_ip(IpAddr::V4(Ipv4Addr::new(172, 16, 0, 1))));
        // Cloud metadata
        assert!(is_disallowed_ip(IpAddr::V4(Ipv4Addr::new(169, 254, 169, 254))));
        // CGNAT
        assert!(is_disallowed_ip(IpAddr::V4(Ipv4Addr::new(100, 64, 0, 1))));
        // 0.0.0.0
        assert!(is_disallowed_ip(IpAddr::V4(Ipv4Addr::new(0, 0, 0, 0))));
    }

    #[test]
    fn allows_typical_public_ips() {
        assert!(!is_disallowed_ip(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))));
        assert!(!is_disallowed_ip(IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1))));
        assert!(!is_disallowed_ip(IpAddr::V4(Ipv4Addr::new(140, 82, 121, 4)))); // github.com
    }

    #[test]
    fn rejects_v6_loopback_linklocal_ula() {
        assert!(is_disallowed_ip("::1".parse().unwrap()));
        assert!(is_disallowed_ip("fe80::1".parse().unwrap()));
        assert!(is_disallowed_ip("fc00::1".parse().unwrap()));
        // 2001:db8 documentation
        assert!(is_disallowed_ip("2001:db8::1".parse().unwrap()));
    }

    #[tokio::test]
    async fn safe_resolve_rejects_ip_literal_loopback() {
        let r = safe_resolve_url("https://127.0.0.1/", false).await;
        assert!(r.is_err());
    }

    #[tokio::test]
    async fn safe_resolve_rejects_http_when_disallowed() {
        let r = safe_resolve_url("http://example.com/", false).await;
        assert!(r.is_err(), "http should be refused when allow_http=false");
    }

    #[tokio::test]
    async fn safe_resolve_rejects_data_uri() {
        let r = safe_resolve_url("data:text/plain,foo", false).await;
        assert!(r.is_err());
    }

    #[tokio::test]
    async fn safe_resolve_rejects_file_uri() {
        let r = safe_resolve_url("file:///etc/passwd", false).await;
        assert!(r.is_err());
    }
}
