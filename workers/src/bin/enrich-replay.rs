//! enrich-replay — rebuild `live_token_utxo` and `token_state` exactly from
//! BCHN block history. No BlockBook.
//!
//! `enrich-seed` bootstrapped `live_token_utxo` from BlockBook, but a full
//! BlockBook sweep is too heavy for carson and both attempts stalled near
//! ~97%, so the table is not trustworthy as a base for the authoritative
//! sync-tail Pass 6. This binary replaces that bootstrap:
//!
//!   1. TRUNCATE `live_token_utxo`.
//!   2. Replay every block from CashTokens activation through
//!      `sync_state.tail_last_block`, applying the same per-block deltas
//!      sync-tail applies (`derive_block_deltas` + `apply_live_utxo_deltas`).
//!   3. Re-aggregate every category in `tokens` into `token_state` /
//!      `token_holders` / `nft_instances`.
//!
//! Stops exactly at the tail's checkpoint, so sync-tail resumes at the next
//! block with no gap and no overlap. sync-tail MUST be stopped while this
//! runs (the systemd unit declares `Conflicts=sync-tail.service`); the replay
//! re-reads the checkpoint before step 3 and aborts if it moved.
//!
//! Not resumable: a re-run truncates and starts over. The site keeps serving
//! the old `token_state` until step 3 overwrites it per category.
//!
//! Env vars: BCHN_RPC_URL / BCHN_RPC_AUTH, DATABASE_URL, RUST_LOG.

use std::time::Instant;

use anyhow::{Context, Result, bail};
use tracing::info;
use tracing_subscriber::EnvFilter;

use workers::bchn::BchnClient;
use workers::blocks::ACTIVATION_HEIGHT;
use workers::enrich_walker::derive_block_deltas;
use workers::pg::{
    self, apply_live_utxo_deltas, load_sync_state, mark_enrich_run, pick_categories_after,
    pool_from_env, rewrite_token_state_from_live,
};

const PROGRESS_EVERY: i32 = 5000;
const CATEGORY_PAGE: i64 = 500;

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let bchn = BchnClient::from_env().context("building BCHN client")?;
    let pool = pool_from_env().await.context("connecting to Postgres")?;

    let target = load_sync_state(&pool)
        .await?
        .tail_last_block
        .context("sync_state.tail_last_block is NULL; nothing to replay to")?;

    info!(from = ACTIVATION_HEIGHT, to = target, "enrich-replay: truncating live_token_utxo");
    sqlx::query("TRUNCATE live_token_utxo")
        .execute(&pool)
        .await
        .context("truncate live_token_utxo")?;

    let started = Instant::now();
    for h in ACTIVATION_HEIGHT..=target {
        let block = bchn
            .get_block_by_height(h as u64)
            .await
            .with_context(|| format!("fetching block {h}"))?;
        let deltas = derive_block_deltas(&block).with_context(|| format!("deltas at {h}"))?;
        apply_live_utxo_deltas(&pool, &deltas)
            .await
            .with_context(|| format!("apply deltas at {h}"))?;
        if (h - ACTIVATION_HEIGHT) % PROGRESS_EVERY == 0 {
            info!(height = h, to = target, elapsed_s = started.elapsed().as_secs(), "replay progress");
        }
    }
    info!(to = target, elapsed_s = started.elapsed().as_secs(), "block replay complete");

    let now = load_sync_state(&pool).await?.tail_last_block;
    if now != Some(target) {
        bail!("tail_last_block moved from {target} to {now:?} during replay — sync-tail was running; re-run with it stopped");
    }

    let mut cursor: Vec<u8> = Vec::new();
    let mut rebuilt: u64 = 0;
    loop {
        let page = pick_categories_after(&pool, &cursor, CATEGORY_PAGE).await?;
        let Some(last) = page.last() else { break };
        cursor = last.clone();
        for category in &page {
            rewrite_token_state_from_live(&pool, category).await?;
            rebuilt += 1;
        }
        info!(rebuilt, "token_state rebuild progress");
    }
    mark_enrich_run(&pool).await?;

    info!(rebuilt, through = target, elapsed_s = started.elapsed().as_secs(), "enrich-replay complete");
    pg::shutdown(pool).await;
    Ok(())
}
