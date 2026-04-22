//! Small env-var parsing helpers shared across the binaries.
//!
//! Existed once per binary as an inline `.ok().and_then(parse).unwrap_or(...)`
//! chain that swallowed parse errors silently. Now centralized so operator
//! typos (`BCMR_BATCH=two-hundred`) surface as a `warn!` instead of a quiet
//! fallback.

use std::fmt::Display;
use std::str::FromStr;

use tracing::warn;

/// Parse `name` out of the process environment into `T`, falling back to
/// `default` if unset or unparseable. Logs `warn!` on parse failure so the
/// operator sees the mismatch in `journalctl`.
pub fn parse_or_default<T>(name: &str, default: T) -> T
where
    T: FromStr + Display + Copy,
    T::Err: Display,
{
    match std::env::var(name) {
        Err(_) => default,
        Ok(raw) => match raw.parse::<T>() {
            Ok(v) => v,
            Err(e) => {
                warn!(
                    var = name,
                    value = %raw,
                    error = %e,
                    default = %default,
                    "failed to parse env var; using default",
                );
                default
            }
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // SAFETY for the tests below: each test sets a uniquely-named env var so
    // tests don't race each other through shared process state. std::env::set_var
    // is `unsafe` under Rust 1.92's `edition = "2024"` because it's
    // process-global and not thread-safe; the uniqueness is what keeps it safe
    // here.

    #[test]
    fn unset_returns_default() {
        // SAFETY: unique var name per test.
        unsafe { std::env::remove_var("TOKENSTORK_ENV_TEST_MISSING") };
        let v: i32 = parse_or_default("TOKENSTORK_ENV_TEST_MISSING", 42);
        assert_eq!(v, 42);
    }

    #[test]
    fn valid_int_parses() {
        // SAFETY: unique var name per test.
        unsafe { std::env::set_var("TOKENSTORK_ENV_TEST_VALID", "100") };
        let v: i32 = parse_or_default("TOKENSTORK_ENV_TEST_VALID", 42);
        assert_eq!(v, 100);
        unsafe { std::env::remove_var("TOKENSTORK_ENV_TEST_VALID") };
    }

    #[test]
    fn garbage_falls_back_to_default() {
        // SAFETY: unique var name per test.
        unsafe { std::env::set_var("TOKENSTORK_ENV_TEST_GARBAGE", "two-hundred") };
        let v: i32 = parse_or_default("TOKENSTORK_ENV_TEST_GARBAGE", 42);
        assert_eq!(v, 42);
        unsafe { std::env::remove_var("TOKENSTORK_ENV_TEST_GARBAGE") };
    }
}
