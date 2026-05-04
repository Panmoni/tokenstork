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

use serde::Deserialize;
use tracing::warn;

// ---------------------------------------------------------------------------
// Wire shape — only the fields the on-chain walker reads. Extra keys in the
// publisher's BCMR JSON (status, splitId, uris.*, tags, extensions, NFT
// types, etc.) are ignored at this layer; they ride along verbatim in the
// raw `serde_json::Value` the walker also caches in
// `token_metadata.bcmr_body` for the detail-page rich card.
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct BcmrToken {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub token: Option<BcmrTokenInner>,
    #[serde(default)]
    pub uris: Option<BcmrUris>,
}

#[derive(Debug, Deserialize)]
pub struct BcmrTokenInner {
    #[serde(default)]
    pub symbol: Option<String>,
    #[serde(default)]
    pub decimals: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct BcmrUris {
    #[serde(default)]
    pub icon: Option<String>,
}

impl BcmrToken {
    /// Flatten the nested BCMR-CHIP shape into the column layout the
    /// `token_metadata` table expects.
    ///
    /// `category_hex` is used only as context for any `warn!` emitted during
    /// decimals validation — so an operator correlating a clamped-decimals
    /// warning can identify the offending token.
    pub fn into_flat(self, category_hex: &str) -> BcmrFlat {
        let (symbol, decimals_raw) = match self.token {
            Some(t) => (t.symbol, t.decimals),
            None => (None, None),
        };
        let icon_uri = self.uris.and_then(|u| u.icon);
        // Normalize "" / "   " upstream values to None so the DB sees a
        // clean Option<String>: present-and-meaningful or NULL. Without
        // this, every read path has to defend against empty strings via
        // NULLIF(BTRIM(name), '') etc. — those defenses stay in place
        // (idempotent), but new code can rely on Option semantics.
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
