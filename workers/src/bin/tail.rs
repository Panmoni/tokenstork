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
//!
//! Reorg detection (Phase 4):
//! Before processing each block, compare BCHN's `getblockhash(height)` against
//! the hash stored in `blocks`. On mismatch, unwind `live_token_utxo` at/above
//! the forked height and `token_crc20` at the height, then re-process. This
//! keeps enrichment correct across 1-2 block reorgs (occasional on BCH).

use std::collections::HashMap;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use hex;
use sd_notify::NotifyState;
use tokio::signal;
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

use workers::bchn::{BchnClient, Block, HashBlockSubscriber, zmq_url_from_env};
use workers::blocks::{ACTIVATION_HEIGHT, summarize_block};
use workers::crc20::detect_in_tx;
use workers::enrich_core::aggregate;
use workers::enrich_walker::derive_block_deltas;
use workers::pg::{
    self, BlockWrite, FoundCategory, OfferWrite, TokenType,
    apply_live_utxo_deltas, crc20_canonical_resolve, delete_crc20_at_height,
    load_block_hash, load_live_utxos_for_category,
    load_sync_state, mark_blocks_run, mark_crc20_run, mark_tail_run, mark_tapswap_run,
    pool_from_env, read_token_state_summary, save_tail_last_block, unwind_live_utxo,
    upsert_block, upsert_tapswap_offers_batch, upsert_tokens, write_crc20_detection,
};
use workers::tapswap::try_decode_tx;
use workers::tapswap_walker::process_block_spends;

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
    /// 1 if the per-block economics row was written, 0 if Pass 4 soft-failed.
    /// (Per-block economics is observability data; a transient DB error
    /// shouldn't pin the tail's checkpoint.)
    blocks_written: usize,
    /// Count of CRC-20 reveals detected and upserted in this block.
    crc20_written: usize,
    /// Categories whose event-driven aggregate was checked this block (shadow
    /// mode only; 0 when ENRICH_SHADOW is unset).
    enrich_shadow_checked: usize,
}

/// Walk one block's transactions:
///  1. Collect distinct token categories (existing behaviour) → `tokens`.
///  2. Detect MPSW Tapswap listings → `tapswap_offers`.
///  3. Detect Tapswap closes (taken / cancelled) → updates the same table.
///  4. Summarize per-block economics (tx count, coinbase, fees, size,
///     subsidy) → `blocks`.
///  5. Detect CRC-20 covenant reveals on genesis inputs → `token_crc20`,
///     followed by canonical-winner re-resolution if any rows were
///     written.
///
/// Order matters: pass 2 must precede pass 3 so a listing minted and
/// closed in the same block (rare but legal) gets inserted before the
/// close-walker tries to update it. Passes 4 + 5 are independent and
/// run last.
///
/// One block fetch per tail tick; the extra walkers are cheap because
/// we're already iterating every output for the token walker. CRC-20
/// detection adds at most one BCHN RPC per detected covenant (to look
/// up `H_commit`), and CRC-20 reveals are rare (~hundreds since
/// activation), so the per-block overhead is essentially zero.
async fn process_block(
    pool: &pg::PgPool,
    bchn: &BchnClient,
    block: &Block,
) -> Result<BlockStats> {
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
    // The walker logic lives in `workers::tapswap_walker` because it's
    // shared with the one-shot `tapswap-spend-backfill` binary. Errors
    // are propagated so the tail's checkpoint doesn't advance on a DB
    // failure — the next tick re-processes this block and the per-row
    // `WHERE status='open'` guard makes the retry idempotent.
    let tapswap_closed = process_block_spends(pool, block).await?;

    // --- Pass 4: per-block economics row ---
    //
    // Written ONLY for blocks ≥ CashTokens activation (792,772) — pre-
    // activation history is out of /blocks scope. Errors are soft-failed
    // (warn + continue) because:
    //   1. The schema is upsert-on-conflict (height PK), so a re-run
    //      after a transient DB hiccup overwrites cleanly.
    //   2. /blocks is a dashboard, not a correctness path — a 1-row gap
    //      is visible in the UI but doesn't break anything else.
    //   3. The blocks-backfill binary independently fills any gaps a
    //      future operator-triggered run picks up.
    // The previous Tapswap upsert already committed Pass 1-3 results, so
    // returning Err here would re-run the upsert (idempotent) on the next
    // tick — visible as duplicate-write log noise but not data loss.
    // Soft-failing avoids that noise.
    let blocks_written = if height < ACTIVATION_HEIGHT {
        0
    } else {
        match summarize_block(block) {
            Ok(summary) => {
                let write = BlockWrite {
                    height: summary.height,
                    hash: summary.hash.to_vec(),
                    time_unix: summary.time,
                    tx_count: summary.tx_count,
                    total_output_sats: summary.total_output_sats,
                    coinbase_sats: summary.coinbase_sats,
                    fees_sats: summary.fees_sats,
                    subsidy_sats: summary.subsidy_sats,
                    size_bytes: summary.size_bytes,
                    coinbase_script_sig: summary.coinbase_script_sig,
                    token_tx_count: summary.token_tx_count,
                    genesis_tx_count: summary.genesis_tx_count,
                };
                match upsert_block(pool, &write).await {
                    Ok(()) => {
                        if let Err(e) = mark_blocks_run(pool).await {
                            warn!(error = %e, "mark_blocks_run failed; observability only");
                        }
                        1
                    }
                    Err(e) => {
                        warn!(height, error = %e, "blocks upsert failed; soft-skipping");
                        0
                    }
                }
            }
            Err(e) => {
                warn!(height, error = %e, "block summary failed; soft-skipping");
                0
            }
        }
    };

    // --- Pass 5: CRC-20 detection ---
    //
    // Walk every tx that creates a category, parse the genesis input's
    // scriptSig against the CRC-20 covenant pattern, and on a match
    // write a row into `token_crc20`. After any successful detection
    // re-run the canonical-winner resolver so readers see a consistent
    // view.
    //
    // Errors here are HARD-failed (propagated) for the same reason as
    // Pass 2 (Tapswap): tail never revisits past blocks once
    // save_tail_last_block advances the checkpoint, so silently
    // dropping a CRC-20 row would be permanent data loss until an
    // operator runs `crc20-rescan`. Re-processing the block on the
    // next tick is fine — upsert_token_crc20 is idempotent on the
    // category PK and preserves is_canonical / detected_at on conflict.
    let mut crc20_written = 0;
    for tx in &block.tx {
        let Some(d) = detect_in_tx(tx) else { continue };
        write_crc20_detection(pool, bchn, &d, height)
            .await
            .with_context(|| format!("crc20 write at height {height} category={}", d.category_hex))?;
        crc20_written += 1;
    }
    if crc20_written > 0 {
        crc20_canonical_resolve(pool)
            .await
            .with_context(|| format!("crc20 canonical resolve at height {height}"))?;
        if let Err(e) = mark_crc20_run(pool).await {
            warn!(error = %e, "mark_crc20_run failed; observability only");
        }
    }

    // --- Pass 6: event-driven enrichment (SHADOW, gated by ENRICH_SHADOW) ---
    //
    // Maintains `live_token_utxo` from this block's token-UTXO deltas and, for
    // each touched category, re-aggregates and compares against the current
    // `token_state` (written by the legacy `enrich` path) WITHOUT writing
    // token_state/holders/nfts — validating the event-driven model before
    // cutover (docs/enrich-event-driven-design.md).
    //
    // SOFT-failed: this is experimental observability. A bug here must never
    // pin the tail checkpoint or drop a block. (At cutover this becomes the
    // authoritative writer and flips to hard-fail, like Pass 5.)
    //
    // NOTE: comparison only means anything once `live_token_utxo` is seeded by
    // the one-shot bootstrap — until then a touched category's historical
    // UTXOs are absent and a mismatch is expected, not a bug.
    let enrich_shadow_checked = if std::env::var("ENRICH_SHADOW").is_ok() {
        match run_enrich_shadow(pool, block).await {
            Ok(n) => n,
            Err(e) => {
                warn!(height, error = %e, "enrich shadow pass failed; soft-skipping");
                0
            }
        }
    } else {
        0
    };

    Ok(BlockStats {
        tokens_touched,
        tapswap_written,
        tapswap_closed,
        blocks_written,
        crc20_written,
        enrich_shadow_checked,
    })
}

/// Shadow-mode event-driven enrichment for one block: apply the token-UTXO
/// deltas to `live_token_utxo`, then for each touched category re-aggregate
/// from the live set and log any divergence from the stored `token_state`.
/// Read-only w.r.t. token_state/token_holders/nft_instances. Returns the
/// number of categories checked.
async fn run_enrich_shadow(pool: &pg::PgPool, block: &Block) -> Result<usize> {
    let deltas = derive_block_deltas(block)?;
    let touched = apply_live_utxo_deltas(pool, &deltas).await?;

    for category in &touched {
        let inputs = load_live_utxos_for_category(pool, category).await?;
        let agg = aggregate(&inputs);
        let derived_supply = agg.current_supply.to_string();
        let derived_holders = agg.holders.len() as i32;

        match read_token_state_summary(pool, category).await? {
            Some(state) => {
                let mismatch = state.current_supply != derived_supply
                    || state.live_utxo_count != agg.live_utxo_count
                    || state.live_nft_count != agg.live_nft_count
                    || state.holder_count != derived_holders;
                if mismatch {
                    warn!(
                        category = %pg::bytes_to_hex(category),
                        stored_supply = %state.current_supply,
                        derived_supply = %derived_supply,
                        stored_utxos = state.live_utxo_count,
                        derived_utxos = agg.live_utxo_count,
                        stored_nfts = state.live_nft_count,
                        derived_nfts = agg.live_nft_count,
                        stored_holders = state.holder_count,
                        derived_holders,
                        "enrich shadow mismatch (expected pre-bootstrap)"
                    );
                }
            }
            None => {
                // No token_state row yet (brand-new category this block) —
                // nothing to compare against.
            }
        }
    }

    Ok(touched.len())
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
/// DB checkpoint after each. Before processing each block, compares BCHN's
/// `getblockhash(height)` against the hash stored in `blocks`; on mismatch
/// (reorg), unwinds `live_token_utxo` and `token_crc20` at the forked height
/// before re-processing. Logs per block.
async fn catch_up(pool: &pg::PgPool, bchn: &BchnClient, from: i32, to: i32) -> Result<()> {
    for h in from..=to {
        // Reorg detection: if a block hash is already stored for this height
        // and BCHN now serves a different one, a fork occurred. Unwind the
        // stale event-driven state before re-processing the new branch.
        // `load_block_hash` returns `None` when no row exists (fresh catch-up
        // or pre-activation height) — skip the check in that case.
        if let Some(stored) = load_block_hash(pool, h).await? {
            let bchn_hash_hex = bchn
                .get_block_hash(h as u64)
                .await
                .with_context(|| format!("getblockhash {h} for reorg check"))?;
            let bchn_hash = hex::decode(&bchn_hash_hex)
                .with_context(|| format!("decoding block hash at {h}"))?;
            if stored != bchn_hash {
                warn!(
                    height = h,
                    stored = %hex::encode(&stored),
                    bchn = %bchn_hash_hex,
                    "reorg detected — unwinding live_token_utxo and CRC-20 at this height"
                );
                let utxo_deleted = unwind_live_utxo(pool, h).await?;
                let crc20_deleted = delete_crc20_at_height(pool, h).await?;
                info!(
                    height = h,
                    utxo_deleted,
                    crc20_deleted,
                    "reorg unwind complete; re-processing from height"
                );
            }
        }

        let block = bchn
            .get_block_by_height(h as u64)
            .await
            .with_context(|| format!("fetching block {h}"))?;
        let stats = process_block(pool, bchn, &block).await?;
        save_tail_last_block(pool, h).await?;
        if stats.tokens_touched > 0
            || stats.tapswap_written > 0
            || stats.tapswap_closed > 0
            || stats.crc20_written > 0
            || stats.enrich_shadow_checked > 0
        {
            info!(
                height = h,
                touched = stats.tokens_touched,
                tapswap_written = stats.tapswap_written,
                tapswap_closed = stats.tapswap_closed,
                crc20_written = stats.crc20_written,
                blocks_written = stats.blocks_written,
                enrich_shadow_checked = stats.enrich_shadow_checked,
                "block processed"
            );
        } else {
            info!(
                height = h,
                blocks_written = stats.blocks_written,
                "block processed (no tokens, no listings, no closes, no CRC-20)"
            );
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
