//! BCMR-watchdog change events (M2): the pure domain logic that classifies a
//! walker observation into change events, plus the event/severity types.
//!
//! The DB I/O (insert, prior-version lookup, dedup, epoch bump) lives in
//! [`crate::pg`]; the walker (`bin/bcmr-onchain.rs`) wires the two together.
//! Keeping the *decisions* pure makes the rug-detection rules — which are the
//! whole point, and the easiest place to introduce a false positive or a
//! swallowed alert — unit-testable without a database.

use serde::Serialize;

/// What kind of metadata mutation an event records.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventType {
    /// A new verified BCMR version was published (its fields may differ from the
    /// prior version — see the diff `detail`).
    NewVersion,
    /// A freshly-seen publication whose body never matched its on-chain hash, or
    /// could not be fetched at all on first sight — the rug signature.
    VersionMismatch,
    /// The current head's previously-verified body is now unfetchable/mismatching
    /// and has been so past the wall-clock threshold — a live rug in progress.
    VersionPulled,
    /// A previously-pulled head re-verified.
    VersionRestored,
    /// The controlling authority address changed between versions.
    AuthorityMoved,
    /// The authchain walk hit its hop bound without observing the head (a
    /// publisher may be extending the chain to hide the head).
    MaxHopsHit,
}

impl EventType {
    pub fn as_str(self) -> &'static str {
        match self {
            EventType::NewVersion => "new_version",
            EventType::VersionMismatch => "version_mismatch",
            EventType::VersionPulled => "version_pulled",
            EventType::VersionRestored => "version_restored",
            EventType::AuthorityMoved => "authority_moved",
            EventType::MaxHopsHit => "max_hops_hit",
        }
    }

    /// Intrinsic severity. `authority_moved` escalates to `Critical` when it
    /// coincides with a new version in the same walk — that escalation is the
    /// caller's call (see [`authority_moved_severity`]).
    pub fn default_severity(self) -> Severity {
        match self {
            EventType::NewVersion | EventType::VersionRestored => Severity::Info,
            EventType::AuthorityMoved | EventType::MaxHopsHit => Severity::Warning,
            EventType::VersionMismatch | EventType::VersionPulled => Severity::Critical,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Info,
    Warning,
    Critical,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Severity::Info => "info",
            Severity::Warning => "warning",
            Severity::Critical => "critical",
        }
    }
}

/// The flat identity fields of one BCMR version, as stored in
/// `token_metadata_history`. Used to diff consecutive versions.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct VersionFields {
    pub name: Option<String>,
    pub symbol: Option<String>,
    pub decimals: Option<i16>,
    pub icon_uri: Option<String>,
    pub description: Option<String>,
}

/// One changed field, old → new (stringified for a uniform JSON shape).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FieldChange {
    pub field: &'static str,
    pub old: Option<String>,
    pub new: Option<String>,
}

/// Per-field diff between two consecutive versions. Returns only the fields that
/// actually changed (in a stable order).
pub fn field_diff(prev: &VersionFields, new: &VersionFields) -> Vec<FieldChange> {
    let mut out = Vec::new();
    macro_rules! diff_field {
        ($f:ident, $label:literal) => {
            if prev.$f != new.$f {
                out.push(FieldChange {
                    field: $label,
                    old: prev.$f.clone().map(|v| v.to_string()),
                    new: new.$f.clone().map(|v| v.to_string()),
                });
            }
        };
    }
    diff_field!(name, "name");
    diff_field!(symbol, "symbol");
    diff_field!(decimals, "decimals");
    diff_field!(icon_uri, "icon_uri");
    diff_field!(description, "description");
    out
}

/// Build the `detail` JSONB payload for a version event from a field diff.
pub fn diff_detail(changes: &[FieldChange]) -> serde_json::Value {
    serde_json::json!({
        "changed": changes.iter().map(|c| c.field).collect::<Vec<_>>(),
        "fields": changes,
    })
}

/// Whether a currently-failing head has been failing long enough to declare a
/// `version_pulled` (wall-clock hysteresis, R1).
///
/// True iff the head's body is **not** currently verified AND its last
/// successful verify is at least `threshold_secs` ago. A `None` age (the body
/// was never verified) is NOT a pull — you can't pull a body that was never
/// live; that's a `version_mismatch` instead. Using wall-clock age (not a tick
/// count) is load-bearing: the walker's re-walk cadence is non-uniform, so a
/// tick-based threshold would fire days late or not at all.
pub fn pull_threshold_crossed(
    now_verified: bool,
    last_verified_age_secs: Option<i64>,
    threshold_secs: i64,
) -> bool {
    !now_verified && matches!(last_verified_age_secs, Some(age) if age >= threshold_secs)
}

/// Whether the controlling authority address moved between versions. Both
/// addresses must be known (BlockBook rendered them) and different. An unknown
/// address on either side is treated as "no detectable move" rather than a
/// false alarm.
pub fn authority_moved(prev: Option<&str>, new: Option<&str>) -> bool {
    matches!((prev, new), (Some(p), Some(n)) if p != n)
}

/// Severity for an `authority_moved` event: `Critical` when the key handoff
/// coincides with a new publication in the same walk (the classic
/// compromise/rug pattern), else `Warning`.
pub fn authority_moved_severity(coincides_with_new_version: bool) -> Severity {
    if coincides_with_new_version {
        Severity::Critical
    } else {
        Severity::Warning
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vf(name: &str, symbol: &str, decimals: i16) -> VersionFields {
        VersionFields {
            name: Some(name.into()),
            symbol: Some(symbol.into()),
            decimals: Some(decimals),
            icon_uri: None,
            description: None,
        }
    }

    #[test]
    fn field_diff_empty_when_identical() {
        let a = vf("Acme", "ACME", 2);
        assert!(field_diff(&a, &a.clone()).is_empty());
    }

    #[test]
    fn field_diff_reports_only_changed_fields() {
        let prev = vf("Acme", "ACME", 2);
        let mut next = prev.clone();
        next.name = Some("Rugged".into());
        next.icon_uri = Some("ipfs://new".into());
        let d = field_diff(&prev, &next);
        let fields: Vec<_> = d.iter().map(|c| c.field).collect();
        assert_eq!(fields, vec!["name", "icon_uri"]);
        assert_eq!(d[0].old.as_deref(), Some("Acme"));
        assert_eq!(d[0].new.as_deref(), Some("Rugged"));
        // icon went from absent → present.
        assert_eq!(d[1].old, None);
        assert_eq!(d[1].new.as_deref(), Some("ipfs://new"));
    }

    #[test]
    fn field_diff_detects_decimals_and_null_transitions() {
        let prev = vf("Acme", "ACME", 2);
        let mut next = prev.clone();
        next.decimals = Some(8);
        next.symbol = None; // present → absent
        let d = field_diff(&prev, &next);
        let fields: Vec<_> = d.iter().map(|c| c.field).collect();
        assert_eq!(fields, vec!["symbol", "decimals"]);
        assert_eq!(d[1].old.as_deref(), Some("2"));
        assert_eq!(d[1].new.as_deref(), Some("8"));
    }

    #[test]
    fn diff_detail_lists_changed_field_names() {
        let prev = vf("Acme", "ACME", 2);
        let mut next = prev.clone();
        next.name = Some("X".into());
        let detail = diff_detail(&field_diff(&prev, &next));
        assert_eq!(detail["changed"][0], "name");
    }

    #[test]
    fn pull_threshold_respects_wall_clock_and_verification() {
        let day = 24 * 3600;
        // Currently failing, last verified just over a day ago → pulled.
        assert!(pull_threshold_crossed(false, Some(day + 1), day));
        // Exactly at threshold → pulled (>=).
        assert!(pull_threshold_crossed(false, Some(day), day));
        // Failing but only briefly → NOT yet (hysteresis kills gateway blips).
        assert!(!pull_threshold_crossed(false, Some(60), day));
        // Currently verified → never a pull regardless of age.
        assert!(!pull_threshold_crossed(true, Some(day * 10), day));
        // Never verified → not a pull (it's a mismatch, handled elsewhere).
        assert!(!pull_threshold_crossed(false, None, day));
    }

    #[test]
    fn authority_moved_needs_two_known_distinct_addrs() {
        assert!(authority_moved(Some("qa"), Some("qb")));
        assert!(!authority_moved(Some("qa"), Some("qa")));
        assert!(!authority_moved(None, Some("qb")));
        assert!(!authority_moved(Some("qa"), None));
        assert!(!authority_moved(None, None));
    }

    #[test]
    fn severities_match_expectations() {
        assert_eq!(EventType::NewVersion.default_severity(), Severity::Info);
        assert_eq!(EventType::VersionMismatch.default_severity(), Severity::Critical);
        assert_eq!(EventType::VersionPulled.default_severity(), Severity::Critical);
        assert_eq!(authority_moved_severity(true), Severity::Critical);
        assert_eq!(authority_moved_severity(false), Severity::Warning);
    }
}
