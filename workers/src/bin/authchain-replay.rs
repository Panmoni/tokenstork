//! authchain-replay — re-derive `authchain_edge` from BCHN block history.
//!
//! Before 2026-11-21, sync-tail Pass 7 walked a block's vout[0] spends once,
//! in block order. BCH blocks are txid-sorted, so a child that spends a
//! same-block parent could come first and its edge was skipped, cutting the
//! chain for bcmr-onchain. Pass 7 now iterates to a fixpoint
//! (`extend_authchain`); this one-shot backfills the edges the old pass missed.
//!
//! Insert-only (`ON CONFLICT DO NOTHING`), so it can run alongside sync-tail.
//! Restart sync-tail afterwards so its in-memory member set picks up the
//! repaired chains. Re-runnable.
//!
//! Env vars: BCHN_RPC_URL / BCHN_RPC_AUTH, DATABASE_URL, RUST_LOG.

use std::time::Instant;

use anyhow::{Context, Result};
use tracing::info;
use tracing_subscriber::EnvFilter;

use workers::bchn::BchnClient;
use workers::blocks::ACTIVATION_HEIGHT;
use workers::enrich_walker::{derive_block_deltas, extend_authchain};
use workers::pg::{self, load_authchain_members, pool_from_env, record_authchain_edges};

const PROGRESS_EVERY: i32 = 5000;

#[tokio::main]
async fn main() -> Result<()> {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt().with_env_filter(filter).with_target(false).try_init();

    let bchn = BchnClient::from_env().context("building BCHN client")?;
    let pool = pool_from_env().await.context("connecting to Postgres")?;
    let tip: i32 = bchn
        .get_block_count()
        .await
        .context("fetching BCHN tip")?
        .try_into()
        .context("BCHN tip doesn't fit i32")?;

    let mut members = load_authchain_members(&pool).await?;
    info!(from = ACTIVATION_HEIGHT, to = tip, members = members.len(), "authchain-replay starting");

    let started = Instant::now();
    let mut added: usize = 0;
    for h in ACTIVATION_HEIGHT..=tip {
        let block = bchn
            .get_block_by_height(h as u64)
            .await
            .with_context(|| format!("fetching block {h}"))?;
        let deltas = derive_block_deltas(&block).with_context(|| format!("deltas at {h}"))?;
        let edges = extend_authchain(&mut members, &deltas.vout0_spends);
        if !edges.is_empty() {
            added += record_authchain_edges(&pool, &edges)
                .await
                .with_context(|| format!("record edges at {h}"))?;
        }
        if (h - ACTIVATION_HEIGHT) % PROGRESS_EVERY == 0 {
            info!(height = h, to = tip, added, elapsed_s = started.elapsed().as_secs(), "replay progress");
        }
    }

    info!(to = tip, added, elapsed_s = started.elapsed().as_secs(), "authchain-replay complete");
    pg::shutdown(pool).await;
    Ok(())
}
