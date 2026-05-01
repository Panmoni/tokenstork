//! Shared modules for the tokenstork CashToken indexer binaries.
//!
//! The binaries under `src/bin/` — `backfill`, `tail`, `enrich`, `verify` —
//! import these via `use workers::{bchn, pg}`.
//!
//! See [`docs/cashtoken-index-plan.md`] in the repo root for the design.

pub mod bchn;
pub mod bcmr;
pub mod blockbook;
pub mod blocks;
pub mod cauldron;
pub mod crc20;
pub mod env;
pub mod fex;
pub mod google_vision;
pub mod icons;
pub mod pg;
pub mod safe_http;
pub mod sync_icons;
pub mod tapswap;
pub mod tapswap_walker;
