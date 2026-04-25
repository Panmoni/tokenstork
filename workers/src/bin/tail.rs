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
use chrono::TimeZone;
use sd_notify::NotifyState;
use tokio::signal;
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

use workers::bchn::{BchnClient, Block, HashBlockSubscriber, zmq_url_from_env};
use workers::pg::{
    self, FoundCategory, OfferWrite, TokenType, load_sync_state, mark_tail_run,
    apply_tapswap_closes, find_open_tapswap_offers_by_id, mark_tapswap_run, pool_from_env,
    save_tail_last_block, upsert_tapswap_offers_batch, OfferCloseWrite,
    upsert_tokens,
};
use workers::tapswap::{
    classify_close, is_mpsw_spend_candidate, try_decode_tx, CloseStatus,
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

/// Per-block counts returned by `process_block` so the caller can log
/// each walker's contribution separately.
struct BlockStats {
    tokens_touched: usize,
    tapswap_written: usize,
    tapswap_closed: usize,
}

/// Walk one block's transactions three times:
///  1. Collect distinct token categories (existing behaviour) → `tokens`.
///  2. Detect MPSW Tapswap listings → `tapswap_offers`.
///  3. Detect Tapswap closes (taken / cancelled) → updates the same table.
///
/// Order matters: pass 2 must precede pass 3 so a listing minted and
/// closed in the same block (rare but legal) gets inserted before the
/// close-walker tries to update it.
///
/// One block fetch per tail tick; the extra walkers are cheap because
/// we're already iterating every output for the token walker.
async fn process_block(pool: &pg::PgPool, block: &Block) -> Result<BlockStats> {
    let height: i32 = block
        .height
        .try_into()
        .context("block.height does not fit in i32")?;
    let time = block.time;

    // --- Pass 1: tokens ---
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

    let tokens_touched = if found.is_empty() {
        0
    } else {
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
        upsert_tokens(pool, &rows).await?
    };

    // --- Pass 2: Tapswap listings ---
    let mut tapswap_batch: Vec<OfferWrite> = Vec::new();
    for tx in &block.tx {
        match try_decode_tx(tx, height, time) {
            Ok(Some(offer)) => tapswap_batch.push(offer),
            Ok(None) => {}
            Err(e) => {
                warn!(
                    tx = %tx.txid,
                    height,
                    error = %e,
                    "Tapswap listing decode failed; skipping"
                );
            }
        }
    }
    // If the Tapswap batch upsert errors we propagate rather than logging +
    // continuing. `save_tail_last_block` in the caller only runs after
    // `process_block` returns Ok, so a Tapswap failure leaves the checkpoint
    // un-advanced and the next tick re-processes this block. The tokens
    // upsert from Pass 1 is already committed — re-running it is idempotent
    // (ON CONFLICT DO NOTHING). Silently dropping offers here would cause
    // permanent data loss: `sync-tail` never revisits past blocks, and
    // `tapswap-backfill` is a manual operator action.
    let tapswap_written = if tapswap_batch.is_empty() {
        0
    } else {
        let n = upsert_tapswap_offers_batch(pool, &tapswap_batch)
            .await
            .with_context(|| format!("tapswap batch upsert at height {height}"))?;
        // Observability timestamp — the staleness watchdog uses this to
        // distinguish "tail processing blocks, no Tapswap activity" from
        // "tail stopped".
        if let Err(e) = mark_tapswap_run(pool).await {
            warn!(error = %e, "mark_tapswap_run failed; observability only");
        }
        n
    };

    // --- Pass 3: Tapswap closes (taken / cancelled) ---
    //
    // Two-step: collect spend candidates from the block (cheap byte-level
    // filter on each tx's input[0]), then bulk-look-up the matching open
    // listings from the DB. Most blocks have zero candidates; the early
    // return keeps the path zero-cost in the common case.
    //
    // We keep an in-flight `Vec<(spending_tx, listing_id)>` rather than
    // building OfferCloseWrites up front because the classify_close()
    // call needs the listing's stored maker_pkh, which we haven't fetched
    // yet. Two passes — one to collect, one to classify-and-stage — avoid
    // ordering dependencies.
    struct CloseCandidate<'a> {
        listing_id: [u8; 32],
        spending_tx: &'a workers::bchn::Tx,
    }
    let mut candidates: Vec<CloseCandidate> = Vec::new();
    for tx in &block.tx {
        let Some(input0) = tx.vin.first() else {
            continue;
        };
        // Coinbase has no txid / vout; can't spend a Tapswap listing.
        let (Some(prev_txid_hex), Some(prev_vout)) = (input0.txid.as_ref(), input0.vout) else {
            continue;
        };
        // Tapswap listings always live at outputs[0] of the listing tx,
        // so a close MUST spend vout=0 of some prior tx. Skip anything
        // else without paying for hex decode + marker check.
        if prev_vout != 0 {
            continue;
        }
        // Fast script-side filter: length floor + spend marker presence.
        let Some(script_sig) = input0.script_sig.as_ref() else {
            continue;
        };
        let Ok(unlocking_bytes) = hex::decode(&script_sig.hex) else {
            continue;
        };
        if !is_mpsw_spend_candidate(&unlocking_bytes) {
            continue;
        }
        // Decode the spent listing's txid (which is the tapswap_offers.id
        // we're trying to match).
        let Ok(prev_txid_bytes) = hex::decode(prev_txid_hex) else {
            continue;
        };
        let Ok(listing_id) = <[u8; 32]>::try_from(prev_txid_bytes.as_slice()) else {
            continue;
        };
        candidates.push(CloseCandidate {
            listing_id,
            spending_tx: tx,
        });
    }

    let tapswap_closed = if candidates.is_empty() {
        0
    } else {
        // Bulk DB lookup — only the candidates whose listing is still
        // open + ours.
        let candidate_ids: Vec<[u8; 32]> = candidates.iter().map(|c| c.listing_id).collect();
        let open_offers = find_open_tapswap_offers_by_id(pool, &candidate_ids)
            .await
            .with_context(|| format!("lookup open tapswap offers at height {height}"))?;
        let by_id: std::collections::HashMap<[u8; 32], [u8; 20]> = open_offers
            .into_iter()
            .map(|r| (r.id, r.maker_pkh))
            .collect();

        let block_time_ts = chrono::Utc
            .timestamp_opt(time, 0)
            .single()
            .ok_or_else(|| anyhow::anyhow!("invalid block.time {} at height {}", time, height))?;

        let mut close_batch: Vec<OfferCloseWrite> = Vec::new();
        for c in candidates {
            let Some(maker_pkh) = by_id.get(&c.listing_id) else {
                // Spend candidate but not an open listing of ours — could
                // be an unrelated tx that happens to embed the platform
                // PKH bytes, or a re-process of an already-closed listing.
                // Skip silently.
                continue;
            };
            // outputs[0]'s locking bytecode tells us who's getting the
            // listed asset. classify_close() handles non-P2PKH outputs
            // (rare) by classifying as Taken with no taker_pkh.
            let Some(out0) = c.spending_tx.vout.first() else {
                warn!(
                    spending_tx = %c.spending_tx.txid,
                    listing_id = %hex::encode(c.listing_id),
                    "spend candidate has no outputs[0]; skipping"
                );
                continue;
            };
            // Malformed script_pub_key hex from BCHN should never happen
            // with a healthy node, so log loudly + skip instead of
            // silently classifying with empty bytes (which would degrade
            // to Taken / no-taker — masking the BCHN-side issue).
            let out0_bytes = match hex::decode(&out0.script_pub_key.hex) {
                Ok(b) => b,
                Err(e) => {
                    warn!(
                        spending_tx = %c.spending_tx.txid,
                        listing_id = %hex::encode(c.listing_id),
                        error = %e,
                        "spending tx vout[0] hex decode failed; skipping close classification"
                    );
                    continue;
                }
            };
            let decoded = classify_close(&out0_bytes, maker_pkh);

            // Decode the spending tx's txid for the closed_tx column.
            let Ok(closed_tx_bytes) = hex::decode(&c.spending_tx.txid) else {
                warn!(
                    spending_tx = %c.spending_tx.txid,
                    "spending tx txid hex invalid; skipping"
                );
                continue;
            };
            let Ok(closed_tx) = <[u8; 32]>::try_from(closed_tx_bytes.as_slice()) else {
                continue;
            };

            close_batch.push(OfferCloseWrite {
                id: c.listing_id,
                status: decoded.status.as_db_str(),
                taker_pkh: match decoded.status {
                    CloseStatus::Taken => decoded.taker_pkh,
                    CloseStatus::Cancelled => None,
                },
                closed_tx,
                closed_at: block_time_ts,
            });
        }

        if close_batch.is_empty() {
            0
        } else {
            apply_tapswap_closes(pool, &close_batch)
                .await
                .with_context(|| format!("apply tapswap closes at height {height}"))?
        }
    };

    Ok(BlockStats {
        tokens_touched,
        tapswap_written,
        tapswap_closed,
    })
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
        let stats = process_block(pool, &block).await?;
        save_tail_last_block(pool, h).await?;
        if stats.tokens_touched > 0 || stats.tapswap_written > 0 || stats.tapswap_closed > 0 {
            info!(
                height = h,
                touched = stats.tokens_touched,
                tapswap_written = stats.tapswap_written,
                tapswap_closed = stats.tapswap_closed,
                "block processed"
            );
        } else {
            info!(height = h, "block processed (no tokens, no listings, no closes)");
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
    // Touch last_tail_run_at regardless of outcome so a staleness watchdog
    // sees the tail is alive even during a long quiet stretch on BCH.
    if let Err(e) = mark_tail_run(pool).await {
        warn!(error = %e, "mark_tail_run failed; observability only, continuing");
    }

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
