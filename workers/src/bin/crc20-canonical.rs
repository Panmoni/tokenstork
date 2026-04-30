//! crc20-canonical — recompute the `is_canonical` flag on every
//! `token_crc20` row. Pure SQL, no BCHN. Hourly belt-and-braces backstop
//! for the inline resolver that runs in `sync-tail` after every detected
//! covenant; also the resolver of choice after a manual reorg or after
//! the one-shot `crc20-rescan` populates a backlog.
//!
//! Env vars:
//! - DATABASE_URL
//! - RUST_LOG

use anyhow::{Context, Result};
use tracing::info;
use tracing_subscriber::EnvFilter;

use workers::pg::{self, crc20_canonical_resolve, pool_from_env};

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
    let pool = pool_from_env().await.context("connecting to Postgres")?;

    let started = std::time::Instant::now();
    let updated = crc20_canonical_resolve(&pool).await?;
    info!(
        rows_updated = updated,
        elapsed_ms = started.elapsed().as_millis() as u64,
        "crc20 canonical resolve complete"
    );

    pg::shutdown(pool).await;
    Ok(())
}
