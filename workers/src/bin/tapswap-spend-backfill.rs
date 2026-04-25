//! tapswap-spend-backfill — oneshot cold walk from the Tapswap launch
//! floor (block 794,520) to the current chain tip, looking ONLY for
//! Tapswap close events (taken / cancelled). Closes pre-deploy listings
//! that the live `sync-tail` spend walker (shipped 2026-04-25) couldn't
//! retroactively detect.
//!
//! Background:
//!   `bin/tapswap-backfill.rs` runs once at install time to populate
//!   `tapswap_offers` from on-chain listings. That binary doesn't track
//!   spends. The forward-looking lifecycle walker added to
//!   `bin/tail.rs::process_block` only sees blocks ≥ tail_last_block, so
//!   every listing closed before the lifecycle deploy stays at
//!   `status='open'` forever — visibly inflating the per-token "open
//!   listings" counts. This binary fixes that, in one pass, by replaying
//!   the live walker's logic across every historical block.
//!
//! Reuses every helper from the live walker: `is_mpsw_spend_candidate`
//! (cheap byte-level filter on `vin[0]` length floor + 21-byte spend-
//! marker presence + `prev_vout=0`), `find_open_tapswap_offers_by_id`
//! (bulk DB lookup against `WHERE status='open'`), `classify_close`
//! (P2PKH-from-output-0 classification, including the CashToken-prefix
//! handling), `apply_tapswap_closes` (per-row guarded UPDATE).
//!
//! Idempotent: re-runnable from any state. The per-row WHERE
//! status='open' guard means already-closed offers no-op silently.
//! Resumable via `sync_state.last_tapswap_spend_backfill_through`,
//! advanced every CHECKPOINT_EVERY blocks.
//!
//! Expected runtime: ~30-60 min on a synced BCHN over localhost RPC for
//! a cold ~153k-block pass. Cheaper than the listing backfill because
//! most blocks have zero spend candidates — the byte-level filter
//! short-circuits before we touch the DB.
//!
//! Env vars:
//! - BCHN_RPC_URL      (default http://127.0.0.1:8332)
//! - BCHN_RPC_AUTH     "user:password" (required)
//! - DATABASE_URL      Postgres URL (required)
//! - RUST_LOG          log filter; defaults to `info` if unset

use std::time::Instant;

use anyhow::{Context, Result};
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

use workers::bchn::{BchnClient, Block};
use workers::pg::{
    self, load_tapswap_spend_backfill_through, mark_tapswap_run, pool_from_env,
    save_tapswap_spend_backfill_through,
};
use workers::tapswap_walker::process_block_spends;

/// First block we scan. Same floor as the listing backfill — no spends
/// can exist before any listings exist.
const TAPSWAP_FLOOR_BLOCK: i32 = 794_519;

const CHECKPOINT_EVERY: i32 = 1000;
const PROGRESS_EVERY: i32 = 5000;

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

/// Per-block counters. `closes_applied` is the number of rows that
/// transitioned in the DB. `db_errors` is how often the shared walker
/// returned an Err (DB hiccup or the rare malformed block timestamp).
/// `candidates_seen` is intentionally dropped from the previous draft
/// because the helper hides it — the metric is operationally low-value
/// (most blocks have zero matches; the walker logs at debug level when
/// something interesting fires).
#[derive(Default)]
struct BlockCounts {
    closes_applied: usize,
    db_errors: usize,
}

/// Thin wrapper around the shared spend walker. The shared helper
/// propagates errors via Result; backfill catches them and accumulates
/// `db_errors` so the run completes and a final summary surfaces the
/// failed-block count, rather than aborting on the first hiccup.
async fn process_block(pool: &pg::PgPool, block: &Block) -> BlockCounts {
    match process_block_spends(pool, block).await {
        Ok(closes) => BlockCounts {
            closes_applied: closes,
            db_errors: 0,
        },
        Err(e) => {
            // height isn't on `block` directly in a Result context —
            // best-effort decode for the log.
            let height_for_log: Option<i64> = block.height.try_into().ok();
            warn!(
                height = ?height_for_log,
                error = %e,
                "spend walker errored on block; will retry on next run via WHERE status='open' guard"
            );
            BlockCounts {
                closes_applied: 0,
                db_errors: 1,
            }
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let bchn = BchnClient::from_env().context("building BCHN client")?;
    let pool = pool_from_env().await.context("connecting to Postgres")?;

    let checkpoint = load_tapswap_spend_backfill_through(&pool).await?;
    let mut from = checkpoint.unwrap_or(TAPSWAP_FLOOR_BLOCK);
    if from < TAPSWAP_FLOOR_BLOCK {
        from = TAPSWAP_FLOOR_BLOCK;
    }

    let tip: i32 = bchn
        .get_block_count()
        .await
        .context("fetching BCHN tip")?
        .try_into()
        .context("BCHN tip doesn't fit i32")?;

    if tip <= from {
        info!(from, tip, "spend-backfill already at tip; nothing to do");
        pg::shutdown(pool).await;
        return Ok(());
    }

    info!(
        from = from + 1,
        to = tip,
        "Tapswap spend-backfill starting"
    );
    let started = Instant::now();
    let mut total_closes = 0usize;
    let mut total_db_errors = 0usize;
    let mut last_checkpoint = from;

    for h in (from + 1)..=tip {
        let block = match bchn.get_block_by_height(h as u64).await {
            Ok(b) => b,
            Err(e) => {
                error!(height = h, error = %e, "block fetch failed; aborting run");
                save_tapswap_spend_backfill_through(&pool, last_checkpoint).await?;
                pg::shutdown(pool).await;
                return Err(e).context(format!("fetching block {h}"));
            }
        };

        let counts = process_block(&pool, &block).await;
        total_closes += counts.closes_applied;
        total_db_errors += counts.db_errors;

        if h % CHECKPOINT_EVERY == 0 {
            save_tapswap_spend_backfill_through(&pool, h).await?;
            last_checkpoint = h;
        }
        if h % PROGRESS_EVERY == 0 {
            info!(
                height = h,
                scanned = h - from,
                closes = total_closes,
                db_errors = total_db_errors,
                "Tapswap spend-backfill progress"
            );
        }
    }

    save_tapswap_spend_backfill_through(&pool, tip).await?;
    // Touch the standard run timestamp so the staleness watchdog sees
    // this binary as a Tapswap-related run too.
    if let Err(e) = mark_tapswap_run(&pool).await {
        warn!(error = %e, "mark_tapswap_run failed; observability only");
    }

    let elapsed = started.elapsed().as_secs_f64();
    info!(
        scanned = tip - from,
        closes = total_closes,
        db_errors = total_db_errors,
        elapsed_s = format!("{:.1}", elapsed),
        "Tapswap spend-backfill complete"
    );

    pg::shutdown(pool).await;
    Ok(())
}
