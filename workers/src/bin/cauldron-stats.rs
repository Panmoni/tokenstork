//! cauldron-stats — pull global ecosystem aggregates from
//! indexer.cauldron.quest and cache them in Postgres so /stats SSR
//! doesn't pay a network round-trip per page hit.
//!
//! Six endpoints fanned out via futures::join — partial failures are
//! tolerated because Cauldron's indexer occasionally stalls on one
//! of the slower endpoints (the unique-addresses scan in particular).
//! Whatever values do come back are persisted; missing values fall
//! through to whatever was previously stored, so the page never
//! briefly shows zeros while one endpoint hiccups. (Implemented by
//! reading the current row first and patching only the keys that
//! fetched cleanly.)
//!
//! USD figures are NOT computed here — the BCH price is faster-moving
//! than this 30 min cadence and the /stats render layer multiplies
//! `bch_price × stored_sats` on every hit.
//!
//! Env vars:
//! - `DATABASE_URL`.
//! - `CAULDRON_URL` (default `https://indexer.cauldron.quest`).
//! - `CAULDRON_MAX_RPS` (default 5).
//! - `RUST_LOG`.

use std::time::{Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use serde::Serialize;
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

use workers::cauldron::CauldronClient;
use workers::pg::{
    self, CauldronGlobalStatsWrite, fetch_cauldron_global_stats, mark_cauldron_stats_run,
    pool_from_env, upsert_cauldron_global_stats,
};

#[derive(Serialize, serde::Deserialize)]
struct UniqueMonth {
    month: String,
    count: i64,
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let cauldron = CauldronClient::from_env().context("building Cauldron client")?;
    let pool = pool_from_env().await.context("connecting to Postgres")?;

    let started = Instant::now();
    let now = now_unix();
    if now == 0 {
        // System clock pre-1970 should be impossible; bail loudly so the
        // operator sees the misconfiguration rather than persisting bogus
        // 0/0/0 windows.
        anyhow::bail!("system clock returned epoch 0; refusing to fetch volume windows");
    }
    let one_day = 86_400u64;

    // Read-modify-write so a partial-failure run preserves good values
    // for any endpoint that timed out. Without this, a single flaky
    // endpoint causes /stats to show "$0 24h volume" until the next
    // tick recovers — a real visible flicker on a 30 min cadence.
    //
    // The schema seeds an id=1 singleton row on first deploy so this is
    // typically Some(...); on a fresh database it can be None and the
    // helpers below default to 0.
    let prior = fetch_cauldron_global_stats(&pool)
        .await
        .context("reading prior cauldron_global_stats row")?;

    // Sequential fetches respect the client's pacing (CAULDRON_MAX_RPS=5)
    // — kicking them in parallel would queue behind the same Mutex with
    // no benefit. 5 calls × ~200 ms each = ~1 s budget plus the slow
    // unique-addresses scan; total run is ~3-15 s.
    let mut soft_errors: usize = 0;
    let mut succeeded: usize = 0;

    /// On success use the new value; on failure use the prior cached
    /// value (or 0 if there is no prior). Increments counters for the
    /// run summary. `Ok(None)` from the API (404 / empty result) is
    /// treated as a *successful* zero — distinct from a fetch error,
    /// because Cauldron really does sometimes legitimately return no
    /// volume in a window.
    fn pick_or_prior(
        result: Result<Option<i64>, anyhow::Error>,
        prior_val: i64,
        endpoint: &str,
        succeeded: &mut usize,
        soft_errors: &mut usize,
    ) -> i64 {
        match result {
            Ok(Some(v)) => {
                *succeeded += 1;
                v
            }
            Ok(None) => {
                *succeeded += 1;
                0
            }
            Err(e) => {
                *soft_errors += 1;
                warn!(
                    endpoint,
                    error = %e,
                    prior_val,
                    "Cauldron fetch failed; preserving prior cached value"
                );
                prior_val
            }
        }
    }

    let tvl_sats = pick_or_prior(
        cauldron.get_global_tvl_satoshis().await,
        prior.as_ref().map(|p| p.tvl_sats).unwrap_or(0),
        "valuelocked",
        &mut succeeded,
        &mut soft_errors,
    );
    let volume_24h = pick_or_prior(
        cauldron
            .get_volume_window_sats(now.saturating_sub(one_day), now)
            .await,
        prior.as_ref().map(|p| p.volume_24h_sats).unwrap_or(0),
        "volume?24h",
        &mut succeeded,
        &mut soft_errors,
    );
    let volume_7d = pick_or_prior(
        cauldron
            .get_volume_window_sats(now.saturating_sub(7 * one_day), now)
            .await,
        prior.as_ref().map(|p| p.volume_7d_sats).unwrap_or(0),
        "volume?7d",
        &mut succeeded,
        &mut soft_errors,
    );
    let volume_30d = pick_or_prior(
        cauldron
            .get_volume_window_sats(now.saturating_sub(30 * one_day), now)
            .await,
        prior.as_ref().map(|p| p.volume_30d_sats).unwrap_or(0),
        "volume?30d",
        &mut succeeded,
        &mut soft_errors,
    );

    let (pools_active, pools_ended, pools_interactions) = match cauldron.get_contract_count().await
    {
        Ok(Some(c)) => {
            succeeded += 1;
            (c.active, c.ended, c.interactions)
        }
        Ok(None) => {
            succeeded += 1;
            (0, 0, 0)
        }
        Err(e) => {
            soft_errors += 1;
            warn!(error = %e, "Cauldron contract count fetch failed; preserving prior cached value");
            (
                prior.as_ref().map(|p| p.pools_active).unwrap_or(0),
                prior.as_ref().map(|p| p.pools_ended).unwrap_or(0),
                prior.as_ref().map(|p| p.pools_interactions).unwrap_or(0),
            )
        }
    };

    // unique_addresses_by_month: on fetch failure preserve the prior
    // serialized JSON exactly so we don't drop the chart. Fresh deploy
    // with no prior cached value falls back to "[]".
    let unique_serialized = match cauldron.get_unique_addresses_by_month().await {
        Ok(rows) => {
            succeeded += 1;
            let unique_json: Vec<UniqueMonth> = rows
                .into_iter()
                .map(|(month, count)| UniqueMonth { month, count })
                .collect();
            serde_json::to_string(&unique_json).unwrap_or_else(|_| "[]".to_string())
        }
        Err(e) => {
            soft_errors += 1;
            warn!(error = %e, "Cauldron unique-addresses fetch failed; preserving prior cached value");
            prior
                .as_ref()
                .map(|p| p.unique_addresses_by_month_json.clone())
                .unwrap_or_else(|| "[]".to_string())
        }
    };

    // If every endpoint failed and there's no prior to fall back on,
    // there's nothing meaningful to write — bail. With a prior, the
    // upsert is a no-op (we'd be re-writing the prior values byte-for-
    // byte) but `mark_cauldron_stats_run` still bumps the timestamp so
    // the watchdog observes liveness.
    if succeeded == 0 && prior.is_none() {
        error!(
            soft_errors,
            "every Cauldron endpoint failed and no prior cached row; not touching the table"
        );
        pg::shutdown(pool).await;
        return Ok(());
    }

    let unique_count_for_log = serde_json::from_str::<Vec<UniqueMonth>>(&unique_serialized)
        .map(|v| v.len())
        .unwrap_or(0);

    let write = CauldronGlobalStatsWrite {
        tvl_sats,
        volume_24h_sats: volume_24h,
        volume_7d_sats: volume_7d,
        volume_30d_sats: volume_30d,
        pools_active,
        pools_ended,
        pools_interactions,
        unique_addresses_by_month_json: unique_serialized,
    };

    upsert_cauldron_global_stats(&pool, &write).await?;
    mark_cauldron_stats_run(&pool).await?;

    let elapsed = started.elapsed().as_secs_f64();
    info!(
        succeeded,
        soft_errors,
        had_prior = prior.is_some(),
        tvl_sats,
        volume_24h_sats = volume_24h,
        volume_7d_sats = volume_7d,
        volume_30d_sats = volume_30d,
        pools_active,
        pools_ended,
        pools_interactions,
        unique_months = unique_count_for_log,
        elapsed_s = format!("{:.1}", elapsed),
        "cauldron-stats run complete"
    );

    pg::shutdown(pool).await;
    Ok(())
}
