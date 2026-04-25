//! Shared modules for the tokenstork CashToken indexer binaries.
//!
//! The binaries under `src/bin/` — `backfill`, `tail`, `enrich`, `verify` —
//! import these via `use workers::{bchn, pg}`.
//!
//! See [`docs/cashtoken-index-plan.md`] in the repo root for the design.

pub mod bchn;
pub mod bcmr;
pub mod blockbook;
pub mod cauldron;
pub mod env;
pub mod fex;
pub mod pg;
pub mod tapswap;
