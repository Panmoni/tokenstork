//! Shared modules for the tokenstork CashToken indexer binaries.
//!
//! The binaries under `src/bin/` — `backfill`, `tail`, `enrich`, `verify` —
//! import these via `use workers::{bchn, pg}`.
//!
//! See [`docs/cashtoken-index-plan.md`] in the repo root for the design.

pub mod bchn;
pub mod blockbook;
pub mod pg;
