//! tail — permanent BCHN listener. Waits for new blocks via ZMQ, walks the
//! delta, and inserts any new CashToken categories into `tokens`.
//!
//! Port of `scripts/tail-from-bchn.ts`. Refuses to start until
//! `sync_state.backfill_complete = true` so we don't race the backfill worker.
//!
//! Dual-signal design:
//! - Primary: subscribe to BCHN's ZMQ `hashblock` topic.
//! - Fallback: 30 s polling loop. Fires regardless of ZMQ — if ZMQ is
//!   healthy it finds nothing new; if ZMQ is silent it catches the delta.
//! - ZMQ reconnect: on any recv error we close the socket, schedule a
//!   reconnect with exponential backoff (5 s → 15 s → 60 s → capped at 5
//!   min), and keep polling in the meantime. Once ZMQ is back, sub-second
//!   latency resumes without a process restart.
//!
//! systemd integration: `Type=notify`. Sends `READY=1` once the initial
//! catch-up is done, then `WATCHDOG=1` every half-WatchdogSec interval. If
//! the main loop hangs, systemd sees the missed ping and restarts us.
//!
//! Env vars:
//! - BCHN_RPC_URL / BCHN_RPC_AUTH  — RPC for block fetch + polling tip
//! - BCHN_ZMQ_URL                  — default `tcp://127.0.0.1:28332`
//! - DATABASE_URL                  — Postgres (Unix socket peer auth)
//! - RUST_LOG

use std::collections::HashMap;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use sd_notify::NotifyState;
use tokio::signal;
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

use workers::bchn::{BchnClient, Block, HashBlockSubscriber, zmq_url_from_env};
use workers::pg::{
    self, FoundCategory, TokenType, load_sync_state, pool_from_env, save_tail_last_block,
    upsert_tokens,
};

const POLL_FALLBACK: Duration = Duration::from_secs(30);
const ZMQ_BACKOFF_INITIAL: Duration = Duration::from_secs(5);
const ZMQ_BACKOFF_MAX: Duration = Duration::from_secs(300);

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

/// Walk one block's transactions, collect distinct categories, and upsert.
async fn process_block(pool: &pg::PgPool, block: &Block) -> Result<usize> {
    let mut found: HashMap<String, (TokenType, String)> = HashMap::new();
    for tx in &block.tx {
        let mut per_tx: HashMap<String, (bool, bool)> = HashMap::new();
        for vout in &tx.vout {
            let Some(td) = &vout.token_data else { continue };
            let entry = per_tx.entry(td.category.clone()).or_insert((false, false));
            if let Some(amt) = &td.amount
                && amt.is_positive()
            {
                entry.0 = true;
            }
            if td.nft.is_some() {
                entry.1 = true;
            }
        }
        merge_into_found(&mut found, &per_tx, &tx.txid);
    }

    if found.is_empty() {
        return Ok(0);
    }

    let height: i32 = block
        .height
        .try_into()
        .context("block.height does not fit in i32")?;
    let time = block.time;

    let mut rows: Vec<FoundCategory> = Vec::with_capacity(found.len());
    for (cat_hex, (token_type, txid_hex)) in found {
        rows.push(FoundCategory {
            category: pg::hex_to_bytes(&cat_hex)?,
            token_type,
            genesis_txid: pg::hex_to_bytes(&txid_hex)?,
            genesis_block: height,
            genesis_time: time,
        });
    }

    let written = upsert_tokens(pool, &rows).await?;
    Ok(written)
}

fn merge_into_found(
    acc: &mut HashMap<String, (TokenType, String)>,
    per_tx: &HashMap<String, (bool, bool)>,
    txid: &str,
) {
    for (cat, (has_ft, has_nft)) in per_tx {
        let new_type = TokenType::from_evidence(*has_ft, *has_nft);
        acc.entry(cat.clone())
            .and_modify(|entry| entry.0 = entry.0.merge(new_type))
            .or_insert_with(|| (new_type, txid.to_string()));
    }
}

/// Catch up from `from` through `to` inclusive, one block at a time, with a
/// DB checkpoint after each. Logs per block.
async fn catch_up(pool: &pg::PgPool, bchn: &BchnClient, from: i32, to: i32) -> Result<()> {
    for h in from..=to {
        let block = bchn
            .get_block_by_height(h as u64)
            .await
            .with_context(|| format!("fetching block {h}"))?;
        let n = process_block(pool, &block).await?;
        save_tail_last_block(pool, h).await?;
        if n > 0 {
            info!(height = h, touched = n, "block processed");
        } else {
            info!(height = h, "block processed (no tokens)");
        }
    }
    Ok(())
}

/// Query BCHN tip and catch up our `tokens` state to it. Returns the new
/// last-seen height. Doesn't advance `last_seen` on fetch error — we'll
/// retry on the next signal.
async fn catch_up_to_tip(
    pool: &pg::PgPool,
    bchn: &BchnClient,
    last_seen: i32,
) -> i32 {
    let tip = match bchn.get_block_count().await {
        Ok(t) => t,
        Err(e) => {
            warn!(error = %e, "BCHN getblockcount failed; will retry on next signal");
            return last_seen;
        }
    };
    let tip_i = match i32::try_from(tip) {
        Ok(v) => v,
        Err(_) => {
            error!(tip, "tip does not fit in i32");
            return last_seen;
        }
    };
    if tip_i <= last_seen {
        return last_seen;
    }
    info!(from = last_seen + 1, to = tip_i, "delta detected");
    match catch_up(pool, bchn, last_seen + 1, tip_i).await {
        Ok(()) => tip_i,
        Err(e) => {
            error!(error = %e, "catch-up error; will retry on next signal");
            last_seen
        }
    }
}

/// Owned state around the ZMQ subscriber: `Some(..)` when connected, `None`
/// when disconnected with a scheduled reconnect attempt.
struct ZmqState {
    url: String,
    sub: Option<HashBlockSubscriber>,
    /// Current backoff window; only consulted while disconnected.
    backoff: Duration,
    /// Instant at which the next reconnect should be attempted (None while
    /// connected).
    reconnect_at: Option<Instant>,
}

impl ZmqState {
    async fn connect_initial(url: String) -> Self {
        match HashBlockSubscriber::connect(&url).await {
            Ok(s) => {
                info!(url = %url, "ZMQ subscribed");
                Self {
                    url,
                    sub: Some(s),
                    backoff: ZMQ_BACKOFF_INITIAL,
                    reconnect_at: None,
                }
            }
            Err(e) => {
                warn!(url = %url, error = %e, "ZMQ initial connect failed; scheduling reconnect");
                Self {
                    url,
                    sub: None,
                    backoff: ZMQ_BACKOFF_INITIAL,
                    reconnect_at: Some(Instant::now() + ZMQ_BACKOFF_INITIAL),
                }
            }
        }
    }

    fn mark_disconnected(&mut self) {
        self.sub = None;
        self.reconnect_at = Some(Instant::now() + self.backoff);
    }

    /// Try to reconnect if it's time. Called every poll tick while
    /// disconnected. Applies exponential backoff on failure.
    async fn maybe_reconnect(&mut self) {
        if self.sub.is_some() {
            return;
        }
        let now = Instant::now();
        if self.reconnect_at.is_some_and(|t| now < t) {
            return;
        }
        match HashBlockSubscriber::connect(&self.url).await {
            Ok(s) => {
                info!(url = %self.url, "ZMQ reconnected");
                self.sub = Some(s);
                self.backoff = ZMQ_BACKOFF_INITIAL;
                self.reconnect_at = None;
            }
            Err(e) => {
                warn!(
                    url = %self.url,
                    error = %e,
                    backoff_s = self.backoff.as_secs(),
                    "ZMQ reconnect failed"
                );
                self.backoff = (self.backoff * 2).min(ZMQ_BACKOFF_MAX);
                self.reconnect_at = Some(now + self.backoff);
            }
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let bchn = BchnClient::from_env().context("building BCHN client")?;
    let pool = pool_from_env().await.context("connecting to Postgres")?;

    let state = load_sync_state(&pool).await?;
    if !state.backfill_complete {
        error!(
            "backfill_complete = false; refusing to start. Run the backfill binary first."
        );
        pg::shutdown(pool).await;
        std::process::exit(2);
    }

    let mut last_seen: i32 = state
        .tail_last_block
        .or(state.backfill_through)
        .unwrap_or(0);
    if last_seen == 0 {
        bail!("neither tail_last_block nor backfill_through is set in sync_state");
    }

    // Initial catch-up in case we were offline.
    let tip_now: i32 = bchn
        .get_block_count()
        .await?
        .try_into()
        .context("tip does not fit in i32")?;
    if tip_now > last_seen {
        info!(from = last_seen + 1, to = tip_now, "initial catch-up");
        catch_up(&pool, &bchn, last_seen + 1, tip_now).await?;
        last_seen = tip_now;
    } else {
        info!(height = last_seen, "at tip; waiting for new blocks");
    }

    // Tell systemd we're ready (no-op if not under Type=notify).
    let _ = sd_notify::notify(false, &[NotifyState::Ready]);

    // Watchdog ping: if systemd's WatchdogSec is set, pong at half the interval.
    let mut watchdog_usec: u64 = 0;
    let watchdog_enabled = sd_notify::watchdog_enabled(false, &mut watchdog_usec);
    let watchdog_period = if watchdog_enabled && watchdog_usec > 0 {
        Duration::from_micros(watchdog_usec / 2)
    } else {
        Duration::from_secs(3600) // effectively off; interval still needs a value
    };
    let mut watchdog_tick = tokio::time::interval(watchdog_period);
    watchdog_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    watchdog_tick.tick().await; // burn the immediate first tick

    // Connect the ZMQ subscriber. If connection fails, the state machine
    // schedules reconnects with exponential backoff.
    let mut zmq = ZmqState::connect_initial(zmq_url_from_env()).await;

    // Main loop: select across ZMQ events, poll ticks, watchdog, and signals.
    let mut poll = tokio::time::interval(POLL_FALLBACK);
    poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    poll.tick().await;

    loop {
        tokio::select! {
            _ = signal::ctrl_c() => {
                info!("SIGINT received; shutting down");
                break;
            }
            // ZMQ arm — only active while connected. `Option::as_mut()` lets
            // us poll the real subscriber without the infinite-pending hack.
            res = async { zmq.sub.as_mut().unwrap().next_hash().await }, if zmq.sub.is_some() => {
                match res {
                    Ok(Some(_hash)) => {
                        last_seen = catch_up_to_tip(&pool, &bchn, last_seen).await;
                    }
                    Ok(None) => {
                        warn!("ZMQ stream ended; scheduling reconnect");
                        zmq.mark_disconnected();
                    }
                    Err(e) => {
                        warn!(error = %e, "ZMQ recv error; scheduling reconnect");
                        zmq.mark_disconnected();
                    }
                }
            }
            _ = poll.tick() => {
                // Poll fires regardless of ZMQ state. Try reconnect first
                // (cheap if already connected or not yet due), then catch up.
                zmq.maybe_reconnect().await;
                last_seen = catch_up_to_tip(&pool, &bchn, last_seen).await;
            }
            _ = watchdog_tick.tick(), if watchdog_enabled => {
                let _ = sd_notify::notify(false, &[NotifyState::Watchdog]);
            }
        }
    }

    let _ = sd_notify::notify(false, &[NotifyState::Stopping]);
    pg::shutdown(pool).await;
    Ok(())
}
