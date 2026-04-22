//! bcmr — hydrate `token_metadata` from Paytaca's BCMR HTTP indexer.
//!
//! Phase 4b. Runs on `sync-bcmr.timer` every 4h. Picks categories with
//! no `token_metadata` row (or stale), fetches `<BCMR_URL>/api/tokens/<cat>`
//! for each, upserts. 404s record an empty row with
//! `bcmr_source='paytaca-missing'` so subsequent batches skip them until
//! the stale window elapses and we try again.
//!
//! Backfill does NOT call this inline — keeping ~90 min backfill fast and
//! robust against Paytaca outages. Post-backfill, the operator kicks off a
//! one-shot `systemctl start sync-bcmr.service` with `BCMR_BATCH=5000` to
//! hydrate everything, then enables the timer for ongoing refresh.
//!
//! Env vars:
//! - BCMR_URL           default https://bcmr.paytaca.com
//! - BCMR_MAX_RPS       default 5 (shared public service — be polite)
//! - BCMR_BATCH         default 200
//! - BCMR_STALE_HOURS   default 168 (one week)
//! - DATABASE_URL
//! - RUST_LOG

use std::time::Instant;

use anyhow::{Context, Result};
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

use workers::bcmr::BcmrClient;
use workers::env::parse_or_default;
use workers::pg::{
    self, TokenMetadataWrite, bytes_to_hex, mark_bcmr_run, pick_bcmr_batch, pool_from_env,
    upsert_token_metadata,
};

const DEFAULT_BATCH: i32 = 200;
const DEFAULT_STALE_HOURS: i32 = 168; // 1 week

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

async fn hydrate_one(
    pool: &pg::PgPool,
    bcmr: &BcmrClient,
    category: &[u8],
) -> Result<&'static str> {
    let category_hex = bytes_to_hex(category);
    match bcmr.get_token_metadata(&category_hex).await? {
        Some(raw) => {
            let flat = raw.into_flat(&category_hex);
            let w = TokenMetadataWrite {
                category: category.to_vec(),
                name: flat.name,
                symbol: flat.symbol,
                decimals: flat.decimals,
                description: flat.description,
                icon_uri: flat.icon_uri,
                bcmr_source: "paytaca",
            };
            upsert_token_metadata(pool, &w).await?;
            Ok("paytaca")
        }
        None => {
            // 404: record an empty row so we skip until the stale window
            // elapses, then try again in case the project publishes BCMR later.
            let w = TokenMetadataWrite {
                category: category.to_vec(),
                name: None,
                symbol: None,
                decimals: 0,
                description: None,
                icon_uri: None,
                bcmr_source: "paytaca-missing",
            };
            upsert_token_metadata(pool, &w).await?;
            Ok("paytaca-missing")
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let bcmr = BcmrClient::from_env().context("building BCMR client")?;
    let pool = pool_from_env().await.context("connecting to Postgres")?;

    let batch_size: i32 = parse_or_default("BCMR_BATCH", DEFAULT_BATCH);
    let stale_hours: i32 = parse_or_default("BCMR_STALE_HOURS", DEFAULT_STALE_HOURS);

    let batch = pick_bcmr_batch(&pool, stale_hours, batch_size).await?;
    if batch.is_empty() {
        info!("nothing stale; exiting");
        mark_bcmr_run(&pool).await?;
        pg::shutdown(pool).await;
        return Ok(());
    }
    info!(
        n = batch.len(),
        stale_hours,
        "hydrating categories from Paytaca BCMR"
    );

    let started = Instant::now();
    let mut found: usize = 0;
    let mut missing: usize = 0;
    let mut errors: usize = 0;

    for category in &batch {
        match hydrate_one(&pool, &bcmr, category).await {
            Ok("paytaca") => found += 1,
            Ok("paytaca-missing") => missing += 1,
            Ok(_) => {}
            Err(e) => {
                errors += 1;
                error!(
                    category = %bytes_to_hex(category),
                    error = %e,
                    "bcmr fetch failed"
                );
            }
        }
    }

    mark_bcmr_run(&pool).await?;
    let elapsed = started.elapsed().as_secs_f64();
    info!(
        total = batch.len(),
        found,
        missing,
        errors,
        elapsed_s = format!("{:.1}", elapsed),
        "bcmr run complete"
    );

    pg::shutdown(pool).await;
    Ok(())
}
