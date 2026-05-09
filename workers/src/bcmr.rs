//! BCMR (Bitcoin Cash Metadata Registry) data types + flatten helpers.
//!
//! Originally housed a Paytaca HTTP indexer client (Phase 4b). The on-chain
//! authchain walker (Phase 4c, [crate::bcmr_onchain]) replaced that as the
//! canonical source of BCMR metadata; the Paytaca dependency was retired
//! 2026-05-04 along with `bin/bcmr.rs` and `sync-bcmr.{service,timer}`.
//! What remains here is the JSON wire-shape (matching the BCMR CHIP) and
//! the field flatteners — both still used by the on-chain walker to
//! normalise a fetched + sha256-verified body into the columns
//! `token_metadata` exposes (name / symbol / decimals / description /
//! icon_uri).

use std::collections::HashMap;

use serde::Deserialize;
use tracing::warn;

// ---------------------------------------------------------------------------
// Wire shape — only the fields the on-chain walker reads. Extra keys in the
// publisher's BCMR JSON (status, splitId, uris.*, tags, extensions, NFT
// types, etc.) are ignored at this layer; they ride along verbatim in the
// raw `serde_json::Value` the walker also caches in
// `token_metadata.bcmr_body` for the detail-page rich card.
//
// The BCMR v2 spec wraps per-token data inside
// `identities[<category-hex>][<revision-iso-timestamp>]`, with a sibling
// `latestRevision` pointer at the top level naming the canonical revision.
// Our pre-Phase-4c Paytaca worker received pre-flattened blobs (no
// `identities` envelope), so legacy callers may pass the flat shape too —
// the flattener tries the v2 navigation first and falls back to the
// top-level fields for backwards compatibility.
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct BcmrToken {
    /// Per-token data nested under `identities[<cat-hex>][<revision>]` per
    /// BCMR v2 spec. Optional because legacy / Paytaca-flattened bodies may
    /// not carry this envelope.
    #[serde(default)]
    pub identities: Option<HashMap<String, HashMap<String, BcmrIdentitySnapshot>>>,
    /// ISO-8601 timestamp pointing at the canonical revision inside
    /// `identities[<cat-hex>]`. Falls back to a max-by-key sort if absent.
    #[serde(default, rename = "latestRevision")]
    pub latest_revision: Option<String>,

    // Backwards-compat: top-level fields for non-spec / legacy bodies.
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub token: Option<BcmrTokenInner>,
    #[serde(default)]
    pub uris: Option<BcmrUris>,
}

/// Per-revision snapshot inside `identities[<cat-hex>][<revision>]`. Same
/// shape as the legacy top-level fields on `BcmrToken`, just nested.
#[derive(Debug, Deserialize)]
pub struct BcmrIdentitySnapshot {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub token: Option<BcmrTokenInner>,
    #[serde(default)]
    pub uris: Option<BcmrUris>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct BcmrTokenInner {
    #[serde(default)]
    pub symbol: Option<String>,
    #[serde(default)]
    pub decimals: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct BcmrUris {
    #[serde(default)]
    pub icon: Option<String>,
}

impl BcmrToken {
    /// Flatten the BCMR-CHIP shape into the column layout the
    /// `token_metadata` table expects.
    ///
    /// Resolution order:
    ///   1. `identities[lowercase(category_hex)][latestRevision]` — the
    ///      canonical BCMR v2 path.
    ///   2. `identities[lowercase(category_hex)][max-by-key]` — fallback
    ///      when `latestRevision` is missing or doesn't resolve.
    ///   3. Top-level `{name, token, uris, description}` — backwards-compat
    ///      for legacy / Paytaca-flattened bodies.
    ///
    /// `category_hex` is also used as context for any `warn!` emitted during
    /// decimals validation — so an operator correlating a clamped-decimals
    /// warning can identify the offending token.
    pub fn into_flat(self, category_hex: &str) -> BcmrFlat {
        let cat_lc = category_hex.to_ascii_lowercase();
        if let Some(identities) = self.identities.as_ref()
            && let Some(revisions) = identities.get(&cat_lc)
        {
            let snapshot = self
                .latest_revision
                .as_deref()
                .and_then(|r| revisions.get(r))
                .or_else(|| {
                    // ISO-8601 timestamps sort lexicographically the same
                    // as chronologically, so max-by-key picks the newest.
                    revisions.iter().max_by(|a, b| a.0.cmp(b.0)).map(|(_, v)| v)
                });
            if let Some(snap) = snapshot {
                let (symbol, decimals_raw) = match snap.token.as_ref() {
                    Some(t) => (t.symbol.clone(), t.decimals.clone()),
                    None => (None, None),
                };
                let icon_uri = snap.uris.as_ref().and_then(|u| u.icon.clone());
                return BcmrFlat {
                    name: nonempty_capped(snap.name.clone(), MAX_NAME_LEN),
                    symbol: nonempty_capped(symbol, MAX_SYMBOL_LEN),
                    decimals: validate_decimals(decimals_raw, category_hex),
                    description: nonempty_capped(snap.description.clone(), MAX_DESC_LEN),
                    icon_uri: nonempty_capped(icon_uri, MAX_ICON_URI_LEN),
                };
            }
        }

        // Top-level fallback (backwards-compat / non-spec). Normalize
        // "" / "   " upstream values to None so the DB sees a clean
        // Option<String>: present-and-meaningful or NULL.
        let (symbol, decimals_raw) = match self.token {
            Some(t) => (t.symbol, t.decimals),
            None => (None, None),
        };
        let icon_uri = self.uris.and_then(|u| u.icon);
        BcmrFlat {
            name: nonempty_capped(self.name, MAX_NAME_LEN),
            symbol: nonempty_capped(symbol, MAX_SYMBOL_LEN),
            decimals: validate_decimals(decimals_raw, category_hex),
            description: nonempty_capped(self.description, MAX_DESC_LEN),
            icon_uri: nonempty_capped(icon_uri, MAX_ICON_URI_LEN),
        }
    }
}

/// Trim whitespace, cap length, and collapse empty results to None.
/// `Some("")`, `Some("   ")`, `Some("\t\n")` all become `None`. Strings
/// that exceed `max` chars (UTF-8 char count, not bytes) are truncated
/// at a char boundary so we never cut mid-codepoint.
fn nonempty_capped(s: Option<String>, max: usize) -> Option<String> {
    s.and_then(|v| {
        let t = v.trim();
        if t.is_empty() {
            return None;
        }
        if t.chars().count() <= max {
            return if t.len() == v.len() { Some(v) } else { Some(t.to_string()) };
        }
        // Truncate at the char boundary nearest `max` codepoints.
        let cut: String = t.chars().take(max).collect();
        Some(cut)
    })
}

// Defense-in-depth caps. BCMR is publisher-controlled; an issuer can
// publish a 100 KB name / description and the worker would dutifully
// store it, after which every SSR for that token bloats. Same caps
// the SvelteKit side applies when reading bcmr_body.
const MAX_NAME_LEN: usize = 200;
const MAX_SYMBOL_LEN: usize = 32;
const MAX_DESC_LEN: usize = 4000;
const MAX_ICON_URI_LEN: usize = 1024;

#[derive(Debug, Clone)]
pub struct BcmrFlat {
    pub name: Option<String>,
    pub symbol: Option<String>,
    /// Clamped to 0..=8 per CashToken spec. Defaults to 0 when missing or
    /// malformed upstream.
    pub decimals: i16,
    pub description: Option<String>,
    pub icon_uri: Option<String>,
}

/// Coerce whatever the publisher emitted into a `SMALLINT` that fits the
/// `token_metadata.decimals` column. Clamps to `0` for anything outside the
/// CashToken-spec range `[0..=8]` and emits a `warn!` with the category so
/// the operator can track down the malformed upstream value. A genuinely
/// absent field (e.g., `token: {}` with no `decimals` key) does **not** log —
/// zero is the legitimate default.
fn validate_decimals(raw: Option<serde_json::Value>, category_hex: &str) -> i16 {
    use serde_json::Value;
    let (present, parsed) = match &raw {
        None | Some(Value::Null) => (false, None),
        Some(Value::Number(n)) => (true, n.as_f64()),
        Some(Value::String(s)) => (true, s.parse().ok()),
        _ => (true, None),
    };
    match parsed {
        Some(v) if v.is_finite() && (0.0..=8.0).contains(&v) => v.floor() as i16,
        _ if present => {
            warn!(
                category = category_hex,
                raw = ?raw,
                "BCMR decimals out of range or unparseable; clamping to 0",
            );
            0
        }
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const DUMMY_CAT: &str = "00000000000000000000000000000000000000000000000000000000000000ab";

    #[test]
    fn flatten_typical_bcmr_response() {
        let raw = json!({
            "name": "TestToken",
            "description": "A test token",
            "token": { "symbol": "TST", "decimals": 2 },
            "uris": { "icon": "ipfs://abc/logo.png" }
        });
        let t: BcmrToken = serde_json::from_value(raw).unwrap();
        let f = t.into_flat(DUMMY_CAT);
        assert_eq!(f.name.as_deref(), Some("TestToken"));
        assert_eq!(f.symbol.as_deref(), Some("TST"));
        assert_eq!(f.decimals, 2);
        assert_eq!(f.description.as_deref(), Some("A test token"));
        assert_eq!(f.icon_uri.as_deref(), Some("ipfs://abc/logo.png"));
    }

    #[test]
    fn flatten_normalizes_empty_strings_to_none() {
        // Upstream sometimes emits "" / "   " for fields that were left
        // blank rather than omitted. We collapse those to None so the
        // DB sees a clean Option<String> and the directory's ranking +
        // grouping logic doesn't have to defend against blank-but-present
        // names everywhere.
        let raw = json!({
            "name": "",
            "description": "   ",
            "token": { "symbol": "\t\n", "decimals": 0 },
            "uris": { "icon": "" }
        });
        let t: BcmrToken = serde_json::from_value(raw).unwrap();
        let f = t.into_flat(DUMMY_CAT);
        assert_eq!(f.name, None);
        assert_eq!(f.symbol, None);
        assert_eq!(f.description, None);
        assert_eq!(f.icon_uri, None);
    }

    #[test]
    fn flatten_trims_padded_strings_but_preserves_meaningful_content() {
        let raw = json!({
            "name": "  Padded Name  ",
            "token": { "symbol": "TST", "decimals": 0 }
        });
        let t: BcmrToken = serde_json::from_value(raw).unwrap();
        let f = t.into_flat(DUMMY_CAT);
        assert_eq!(f.name.as_deref(), Some("Padded Name"));
        assert_eq!(f.symbol.as_deref(), Some("TST"));
    }

    #[test]
    fn flatten_missing_token_block() {
        let raw = json!({ "name": "X" });
        let t: BcmrToken = serde_json::from_value(raw).unwrap();
        let f = t.into_flat(DUMMY_CAT);
        assert_eq!(f.name.as_deref(), Some("X"));
        assert_eq!(f.symbol, None);
        assert_eq!(f.decimals, 0);
        assert_eq!(f.icon_uri, None);
    }

    #[test]
    fn flatten_bcmr_v2_nested_shape() {
        // The shape every spec-conformant BCMR uses: top-level metadata
        // plus a per-category, per-revision identity tree. Pulled from the
        // OLANDO token's actual on-chain publication that surfaced the
        // Phase 4c launch regression.
        let cat = "7fa887fd4eac015478b95392c4984721fbe3060223c30b342d43cc06817f07f6";
        let raw = json!({
            "$schema": "https://cashtokens.org/bcmr-v2.schema.json",
            "version": { "major": 0, "minor": 1, "patch": 0 },
            "extensions": {},
            "identities": {
                cat: {
                    "2025-02-26T15:21:59.543Z": {
                        "name": "olando",
                        "uris": { "icon": "ipfs://bafy.../icon.png" },
                        "token": { "symbol": "OLANDO", "decimals": 2 },
                        "description": "EVIMA community token"
                    }
                }
            },
            "latestRevision": "2025-02-26T15:21:59.543Z",
            "registryIdentity": cat
        });
        let t: BcmrToken = serde_json::from_value(raw).unwrap();
        let f = t.into_flat(cat);
        assert_eq!(f.name.as_deref(), Some("olando"));
        assert_eq!(f.symbol.as_deref(), Some("OLANDO"));
        assert_eq!(f.decimals, 2);
        assert_eq!(f.description.as_deref(), Some("EVIMA community token"));
        assert_eq!(f.icon_uri.as_deref(), Some("ipfs://bafy.../icon.png"));
    }

    #[test]
    fn flatten_bcmr_v2_uppercase_category_lookup() {
        // BCMR keys are spec-required lowercase, but we lowercase the
        // lookup defensively in case a caller passes an uppercase
        // category_hex.
        let cat_lc = "00000000000000000000000000000000000000000000000000000000000000ab";
        let raw = json!({
            "identities": {
                cat_lc: {
                    "2025-01-01T00:00:00Z": {
                        "name": "Lowercase",
                        "token": { "symbol": "LC" }
                    }
                }
            },
            "latestRevision": "2025-01-01T00:00:00Z"
        });
        let t: BcmrToken = serde_json::from_value(raw).unwrap();
        let f = t.into_flat("00000000000000000000000000000000000000000000000000000000000000AB");
        assert_eq!(f.name.as_deref(), Some("Lowercase"));
        assert_eq!(f.symbol.as_deref(), Some("LC"));
    }

    #[test]
    fn flatten_bcmr_v2_picks_latest_when_revision_pointer_missing() {
        // No `latestRevision` field — fall back to max-by-key (ISO-8601
        // sorts lexicographically the same as chronologically).
        let cat = "00000000000000000000000000000000000000000000000000000000000000ab";
        let raw = json!({
            "identities": {
                cat: {
                    "2024-01-01T00:00:00Z": {
                        "name": "Old",
                        "token": { "symbol": "OLD", "decimals": 0 }
                    },
                    "2026-05-09T15:00:00Z": {
                        "name": "New",
                        "token": { "symbol": "NEW", "decimals": 4 }
                    }
                }
            }
            // latestRevision intentionally omitted
        });
        let t: BcmrToken = serde_json::from_value(raw).unwrap();
        let f = t.into_flat(cat);
        assert_eq!(f.name.as_deref(), Some("New"));
        assert_eq!(f.symbol.as_deref(), Some("NEW"));
        assert_eq!(f.decimals, 4);
    }

    #[test]
    fn flatten_bcmr_v2_unknown_revision_pointer_falls_back_to_max_key() {
        // `latestRevision` points at a key that doesn't exist (publisher
        // bug). We fall back to max-by-key rather than producing empty
        // fields — the publication still represents real metadata.
        let cat = "00000000000000000000000000000000000000000000000000000000000000ab";
        let raw = json!({
            "identities": {
                cat: {
                    "2025-01-01T00:00:00Z": {
                        "name": "Real",
                        "token": { "symbol": "RL" }
                    }
                }
            },
            "latestRevision": "2099-12-31T23:59:59Z"
        });
        let t: BcmrToken = serde_json::from_value(raw).unwrap();
        let f = t.into_flat(cat);
        assert_eq!(f.name.as_deref(), Some("Real"));
        assert_eq!(f.symbol.as_deref(), Some("RL"));
    }

    #[test]
    fn flatten_bcmr_v2_category_not_in_identities_falls_back_to_top_level() {
        // Multi-token registry where our category isn't published in the
        // identities tree, but top-level fields are present (legacy /
        // non-spec shape). Top-level wins over emptiness.
        let our_cat = "11000000000000000000000000000000000000000000000000000000000000ab";
        let other_cat = "22000000000000000000000000000000000000000000000000000000000000cd";
        let raw = json!({
            "identities": {
                other_cat: {
                    "2025-01-01T00:00:00Z": {
                        "name": "OtherToken",
                        "token": { "symbol": "OT" }
                    }
                }
            },
            "latestRevision": "2025-01-01T00:00:00Z",
            // Top-level fallback shape (legacy / Paytaca-flat).
            "name": "FallbackName",
            "token": { "symbol": "FB" },
            "uris": { "icon": "ipfs://fallback" }
        });
        let t: BcmrToken = serde_json::from_value(raw).unwrap();
        let f = t.into_flat(our_cat);
        assert_eq!(f.name.as_deref(), Some("FallbackName"));
        assert_eq!(f.symbol.as_deref(), Some("FB"));
        assert_eq!(f.icon_uri.as_deref(), Some("ipfs://fallback"));
    }

    #[test]
    fn decimals_clamping() {
        use serde_json::Value;
        assert_eq!(validate_decimals(Some(Value::from(5)), DUMMY_CAT), 5);
        assert_eq!(validate_decimals(Some(Value::from(8)), DUMMY_CAT), 8);
        // Out of range / negative / unparseable string → clamp to 0 (with warn!).
        assert_eq!(validate_decimals(Some(Value::from(9)), DUMMY_CAT), 0);
        assert_eq!(validate_decimals(Some(Value::from(-1)), DUMMY_CAT), 0);
        assert_eq!(validate_decimals(Some(Value::from("bad")), DUMMY_CAT), 0);
        // Valid string form → parses.
        assert_eq!(validate_decimals(Some(Value::from("3")), DUMMY_CAT), 3);
        // Genuinely absent / null field → silent 0 (no warn, no ambiguity).
        assert_eq!(validate_decimals(None, DUMMY_CAT), 0);
        assert_eq!(validate_decimals(Some(Value::Null), DUMMY_CAT), 0);
    }
}
