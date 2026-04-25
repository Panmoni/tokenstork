//! Postgres access layer for the workers.
//!
//! - Single `PgPool` per binary, configured from `DATABASE_URL`.
//! - Runtime queries (no `sqlx::query!` macros) so the crate compiles without
//!   a live database at build time.
//! - Hex <-> `Vec<u8>` helpers at the API boundary (BYTEA columns in schema).
//! - Typed helpers for the `sync_state` singleton + a batch upsert into
//!   `tokens` that mirrors the `ON CONFLICT` logic of
//!   `scripts/backfill-from-bchn.ts`.

use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use chrono::{DateTime, TimeZone, Utc};
use sqlx::postgres::PgPoolOptions;
pub use sqlx::{PgPool, Postgres, Transaction};

/// Build a pool from `DATABASE_URL`.
///
/// Production form (Unix socket + peer auth, no password):
/// ```text
/// postgresql://tokenstork@localhost/tokenstork?host=/var/run/postgresql
/// ```
///
/// **Note on URL form.** The shorter empty-host variant
/// `postgresql://tokenstork@/tokenstork?host=/var/run/postgresql` is accepted
/// by node-postgres (what the SvelteKit app uses) but rejected by sqlx with
/// `"empty host"`. Use the `@localhost` form above — it works in both tools.
/// The `?host=/var/run/postgresql` query param overrides the TCP host and
/// tells libpq/sqlx to connect via the Unix socket instead.
pub async fn pool_from_env() -> Result<PgPool> {
    let url = std::env::var("DATABASE_URL").context("DATABASE_URL not set")?;
    PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(5))
        .idle_timeout(Duration::from_secs(30))
        .connect(&url)
        .await
        .context("connecting to Postgres")
}

// ---------------------------------------------------------------------------
// Hex <-> BYTEA helpers. Category ids are 32 bytes; commitments up to 40.
// Accept optional `0x` / `\x` prefixes (we sometimes see them in logs).
// ---------------------------------------------------------------------------

pub fn hex_to_bytes(hex: &str) -> Result<Vec<u8>> {
    let stripped = hex
        .strip_prefix("0x")
        .or_else(|| hex.strip_prefix("\\x"))
        .unwrap_or(hex);
    hex::decode(stripped).with_context(|| format!("invalid hex string: {}…", short(hex)))
}

pub fn bytes_to_hex(bytes: &[u8]) -> String {
    hex::encode(bytes)
}

fn short(s: &str) -> &str {
    &s[..s.len().min(16)]
}

// ---------------------------------------------------------------------------
// sync_state — the singleton bookkeeping row.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, sqlx::FromRow)]
pub struct SyncState {
    pub backfill_complete: bool,
    pub backfill_through: Option<i32>,
    pub tail_last_block: Option<i32>,
    pub last_enrich_run_at: Option<DateTime<Utc>>,
    pub last_verify_run_at: Option<DateTime<Utc>>,
}

pub async fn load_sync_state(pool: &PgPool) -> Result<SyncState> {
    sqlx::query_as::<_, SyncState>(
        "SELECT backfill_complete, backfill_through, tail_last_block,
                last_enrich_run_at, last_verify_run_at
           FROM sync_state
          WHERE id = 1",
    )
    .fetch_one(pool)
    .await
    .context("loading sync_state")
}

/// Advance the backfill checkpoint + optionally mark complete.
pub async fn save_backfill_through(
    pool: &PgPool,
    height: i32,
    complete: bool,
) -> Result<()> {
    sqlx::query(
        "UPDATE sync_state
            SET backfill_through = $1,
                backfill_complete = $2,
                updated_at = now()
          WHERE id = 1",
    )
    .bind(height)
    .bind(complete)
    .execute(pool)
    .await
    .context("saving backfill_through")?;
    Ok(())
}

// ---------------------------------------------------------------------------
// tokens — batch upsert.
//
// Mirrors the ON CONFLICT logic in scripts/backfill-from-bchn.ts:
// - Genesis fields are immutable (preserved on conflict).
// - token_type upgrades only: FT + NFT -> FT+NFT; never regresses.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenType {
    Ft,
    Nft,
    FtNft,
}

impl TokenType {
    pub fn as_str(&self) -> &'static str {
        match self {
            TokenType::Ft => "FT",
            TokenType::Nft => "NFT",
            TokenType::FtNft => "FT+NFT",
        }
    }

    /// Combine evidence: given "has FT outputs" + "has NFT outputs", classify.
    pub fn from_evidence(has_ft: bool, has_nft: bool) -> Self {
        match (has_ft, has_nft) {
            (true, true) => TokenType::FtNft,
            (false, true) => TokenType::Nft,
            _ => TokenType::Ft,
        }
    }

    /// Upward merge: never regress an existing classification.
    pub fn merge(self, other: TokenType) -> TokenType {
        if self == TokenType::FtNft || other == TokenType::FtNft {
            return TokenType::FtNft;
        }
        if self != other {
            TokenType::FtNft
        } else {
            self
        }
    }
}

#[derive(Debug, Clone)]
pub struct FoundCategory {
    pub category: Vec<u8>,
    pub token_type: TokenType,
    pub genesis_txid: Vec<u8>,
    pub genesis_block: i32,
    /// Block timestamp (Unix seconds).
    pub genesis_time: i64,
}

/// Upsert a batch of observed categories inside a single transaction.
///
/// Returns the number of rows attempted (successful inserts and conflicting
/// upgrades both count — caller uses this for progress reporting).
pub async fn upsert_tokens(pool: &PgPool, rows: &[FoundCategory]) -> Result<usize> {
    if rows.is_empty() {
        return Ok(0);
    }

    let mut tx: Transaction<'_, Postgres> = pool.begin().await.context("begin tx")?;

    for r in rows {
        let ts = Utc
            .timestamp_opt(r.genesis_time, 0)
            .single()
            .ok_or_else(|| anyhow!("invalid genesis_time {}", r.genesis_time))?;

        sqlx::query(
            "INSERT INTO tokens
                (category, token_type, genesis_txid, genesis_block, genesis_time, discovery_source)
             VALUES ($1, $2, $3, $4, $5, 'bchn')
             ON CONFLICT (category) DO UPDATE
               SET token_type = CASE
                 WHEN tokens.token_type = EXCLUDED.token_type THEN tokens.token_type
                 WHEN tokens.token_type = 'FT+NFT' OR EXCLUDED.token_type = 'FT+NFT' THEN 'FT+NFT'
                 WHEN (tokens.token_type = 'FT' AND EXCLUDED.token_type = 'NFT')
                   OR (tokens.token_type = 'NFT' AND EXCLUDED.token_type = 'FT') THEN 'FT+NFT'
                 ELSE tokens.token_type
               END",
        )
        .bind(&r.category)
        .bind(r.token_type.as_str())
        .bind(&r.genesis_txid)
        .bind(r.genesis_block)
        .bind(ts)
        .execute(&mut *tx)
        .await
        .with_context(|| {
            format!(
                "upsert_tokens row category={}",
                bytes_to_hex(&r.category)
            )
        })?;
    }

    tx.commit().await.context("commit tx")?;
    Ok(rows.len())
}

/// Current row count in `tokens`. Cheap sanity-check for the backfill
/// completion log line.
pub async fn count_tokens(pool: &PgPool) -> Result<i64> {
    let row: (i64,) = sqlx::query_as("SELECT COUNT(*)::bigint FROM tokens")
        .fetch_one(pool)
        .await
        .context("count(*) tokens")?;
    Ok(row.0)
}

// ---------------------------------------------------------------------------
// Tail helpers.
// ---------------------------------------------------------------------------

/// Advance the tail's high-water mark.
pub async fn save_tail_last_block(pool: &PgPool, height: i32) -> Result<()> {
    sqlx::query(
        "UPDATE sync_state
            SET tail_last_block = $1, updated_at = now()
          WHERE id = 1",
    )
    .bind(height)
    .execute(pool)
    .await
    .context("saving tail_last_block")?;
    Ok(())
}

/// Touch the tail's last-run timestamp on every poll tick (and every ZMQ
/// event), regardless of whether new blocks were found. Lets an external
/// watchdog distinguish "tail is alive but chain is quiet" from "tail
/// stopped polling".
pub async fn mark_tail_run(pool: &PgPool) -> Result<()> {
    sqlx::query(
        "UPDATE sync_state
            SET last_tail_run_at = now(), updated_at = now()
          WHERE id = 1",
    )
    .execute(pool)
    .await
    .context("mark_tail_run")?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Enrichment helpers.
// ---------------------------------------------------------------------------

/// Pick up to `limit` categories that need enrichment. Priority:
///
/// 1. Categories with no `token_state` row yet (`verified_at IS NULL`).
/// 2. Active rows older than `active_stale_hours`.
/// 3. Burned rows older than `burned_stale_hours`.
///
/// Randomized within a priority to spread load across runs.
pub async fn pick_enrichment_batch(
    pool: &PgPool,
    active_stale_hours: i32,
    burned_stale_hours: i32,
    limit: i32,
) -> Result<Vec<Vec<u8>>> {
    let rows: Vec<(Vec<u8>,)> = sqlx::query_as(
        r#"
        WITH candidates AS (
          SELECT t.category, ts.verified_at, ts.is_fully_burned
            FROM tokens t
            LEFT JOIN token_state ts ON ts.category = t.category
        )
        SELECT category
          FROM candidates
         WHERE verified_at IS NULL
            OR (is_fully_burned IS NOT TRUE AND verified_at < now() - $1 * interval '1 hour')
            OR (is_fully_burned IS TRUE     AND verified_at < now() - $2 * interval '1 hour')
         ORDER BY verified_at NULLS FIRST, random()
         LIMIT $3
        "#,
    )
    .bind(active_stale_hours)
    .bind(burned_stale_hours)
    .bind(limit)
    .fetch_all(pool)
    .await
    .context("picking enrichment batch")?;

    Ok(rows.into_iter().map(|(c,)| c).collect())
}

/// Everything the enricher computes from a BlockBook UTXO response for one
/// category, ready to be written.
#[derive(Debug, Clone)]
pub struct TokenStateWrite {
    pub category: Vec<u8>,
    /// Decimal-string representation of the supply sum; cast to NUMERIC
    /// inside the SQL statement.
    pub current_supply: String,
    pub live_utxo_count: i32,
    pub live_nft_count: i32,
    pub holder_count: i32,
    pub has_active_minting: bool,
    pub is_fully_burned: bool,
    pub holders: Vec<HolderWrite>,
    pub nfts: Vec<NftWrite>,
}

#[derive(Debug, Clone)]
pub struct HolderWrite {
    pub address: String,
    pub balance: String,
    pub nft_count: i32,
}

#[derive(Debug, Clone)]
pub struct NftWrite {
    pub commitment: Vec<u8>,
    /// One of `none`, `mutable`, `minting`.
    pub capability: &'static str,
    pub owner_address: Option<String>,
}

/// Rebuild `token_state` + `token_holders` + `nft_instances` for one category
/// in a single transaction. Mirrors `scripts/enrich-from-blockbook.ts#writeState`.
pub async fn write_token_state(pool: &PgPool, w: &TokenStateWrite) -> Result<()> {
    let mut tx: Transaction<'_, Postgres> = pool.begin().await.context("begin tx")?;

    sqlx::query(
        r#"
        INSERT INTO token_state
            (category, current_supply, live_utxo_count, live_nft_count,
             holder_count, has_active_minting, is_fully_burned,
             verified_source, verified_at)
        VALUES ($1, $2::numeric, $3, $4, $5, $6, $7, 'blockbook', now())
        ON CONFLICT (category) DO UPDATE SET
            current_supply      = EXCLUDED.current_supply,
            live_utxo_count     = EXCLUDED.live_utxo_count,
            live_nft_count      = EXCLUDED.live_nft_count,
            holder_count        = EXCLUDED.holder_count,
            has_active_minting  = EXCLUDED.has_active_minting,
            is_fully_burned     = EXCLUDED.is_fully_burned,
            verified_source     = EXCLUDED.verified_source,
            verified_at         = EXCLUDED.verified_at
        "#,
    )
    .bind(&w.category)
    .bind(&w.current_supply)
    .bind(w.live_utxo_count)
    .bind(w.live_nft_count)
    .bind(w.holder_count)
    .bind(w.has_active_minting)
    .bind(w.is_fully_burned)
    .execute(&mut *tx)
    .await
    .with_context(|| format!("upsert token_state for {}", bytes_to_hex(&w.category)))?;

    sqlx::query("DELETE FROM token_holders WHERE category = $1")
        .bind(&w.category)
        .execute(&mut *tx)
        .await
        .context("wipe token_holders")?;

    for h in &w.holders {
        sqlx::query(
            r#"
            INSERT INTO token_holders (category, address, balance, nft_count, snapshot_at)
            VALUES ($1, $2, $3::numeric, $4, now())
            "#,
        )
        .bind(&w.category)
        .bind(&h.address)
        .bind(&h.balance)
        .bind(h.nft_count)
        .execute(&mut *tx)
        .await
        .with_context(|| format!("insert token_holder for {}", h.address))?;
    }

    sqlx::query("DELETE FROM nft_instances WHERE category = $1")
        .bind(&w.category)
        .execute(&mut *tx)
        .await
        .context("wipe nft_instances")?;

    for n in &w.nfts {
        sqlx::query(
            r#"
            INSERT INTO nft_instances (category, commitment, capability, owner_address, snapshot_at)
            VALUES ($1, $2, $3, $4, now())
            ON CONFLICT (category, commitment) DO UPDATE SET
                capability    = EXCLUDED.capability,
                owner_address = EXCLUDED.owner_address,
                snapshot_at   = EXCLUDED.snapshot_at
            "#,
        )
        .bind(&w.category)
        .bind(&n.commitment)
        .bind(n.capability)
        .bind(&n.owner_address)
        .execute(&mut *tx)
        .await
        .context("upsert nft_instance")?;
    }

    tx.commit().await.context("commit enrichment tx")?;
    Ok(())
}

/// Set `sync_state.last_enrich_run_at = now()`.
pub async fn mark_enrich_run(pool: &PgPool) -> Result<()> {
    sqlx::query(
        "UPDATE sync_state
            SET last_enrich_run_at = now(), updated_at = now()
          WHERE id = 1",
    )
    .execute(pool)
    .await
    .context("mark_enrich_run")?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Verifier helpers.
// ---------------------------------------------------------------------------

/// Sample `n` categories that have a `token_state` row (so there's something
/// to compare against). Randomized.
pub async fn pick_verify_sample(pool: &PgPool, n: i32) -> Result<Vec<Vec<u8>>> {
    let rows: Vec<(Vec<u8>,)> = sqlx::query_as(
        r#"
        SELECT t.category
          FROM tokens t
         WHERE EXISTS (SELECT 1 FROM token_state ts WHERE ts.category = t.category)
         ORDER BY random()
         LIMIT $1
        "#,
    )
    .bind(n)
    .fetch_all(pool)
    .await
    .context("picking verify sample")?;
    Ok(rows.into_iter().map(|(c,)| c).collect())
}

pub async fn mark_verify_run(pool: &PgPool) -> Result<()> {
    sqlx::query(
        "UPDATE sync_state
            SET last_verify_run_at = now(), updated_at = now()
          WHERE id = 1",
    )
    .execute(pool)
    .await
    .context("mark_verify_run")?;
    Ok(())
}

// ---------------------------------------------------------------------------
// BCMR helpers (Phase 4b).
// ---------------------------------------------------------------------------

/// Pick up to `limit` categories that need BCMR hydration. Priority:
///
/// 1. Categories with no `token_metadata` row yet.
/// 2. Rows older than `stale_hours` (refreshes both successful and
///    `paytaca-missing` entries — a project might publish BCMR after we
///    first looked).
///
/// Randomized within a priority. Stale window is typically a week for
/// successful fetches and a week for 404s too — we trust the worker's
/// recheck cadence rather than distinguishing here.
pub async fn pick_bcmr_batch(
    pool: &PgPool,
    stale_hours: i32,
    limit: i32,
) -> Result<Vec<Vec<u8>>> {
    let rows: Vec<(Vec<u8>,)> = sqlx::query_as(
        r#"
        WITH candidates AS (
          SELECT t.category, m.fetched_at
            FROM tokens t
            LEFT JOIN token_metadata m ON m.category = t.category
        )
        SELECT category
          FROM candidates
         WHERE fetched_at IS NULL
            OR fetched_at < now() - $1 * interval '1 hour'
         ORDER BY fetched_at NULLS FIRST, random()
         LIMIT $2
        "#,
    )
    .bind(stale_hours)
    .bind(limit)
    .fetch_all(pool)
    .await
    .context("picking BCMR batch")?;
    Ok(rows.into_iter().map(|(c,)| c).collect())
}

/// One row's worth of BCMR data plus the provenance tag. `bcmr_source` is
/// `"paytaca"` on a hit, `"paytaca-missing"` on a 404 (so the next batch
/// picker skips us until the stale window elapses).
#[derive(Debug, Clone)]
pub struct TokenMetadataWrite {
    pub category: Vec<u8>,
    pub name: Option<String>,
    pub symbol: Option<String>,
    pub decimals: i16,
    pub description: Option<String>,
    pub icon_uri: Option<String>,
    pub bcmr_source: &'static str,
}

/// Upsert into `token_metadata` keyed on `category`. Refreshes every field
/// on conflict — stale rows get replaced.
pub async fn upsert_token_metadata(pool: &PgPool, w: &TokenMetadataWrite) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO token_metadata
            (category, name, symbol, decimals, description, icon_uri,
             bcmr_source, fetched_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, now())
        ON CONFLICT (category) DO UPDATE SET
            name         = EXCLUDED.name,
            symbol       = EXCLUDED.symbol,
            decimals     = EXCLUDED.decimals,
            description  = EXCLUDED.description,
            icon_uri     = EXCLUDED.icon_uri,
            bcmr_source  = EXCLUDED.bcmr_source,
            fetched_at   = EXCLUDED.fetched_at
        "#,
    )
    .bind(&w.category)
    .bind(&w.name)
    .bind(&w.symbol)
    .bind(w.decimals)
    .bind(&w.description)
    .bind(&w.icon_uri)
    .bind(w.bcmr_source)
    .execute(pool)
    .await
    .with_context(|| format!("upsert token_metadata for {}", bytes_to_hex(&w.category)))?;
    Ok(())
}

pub async fn mark_bcmr_run(pool: &PgPool) -> Result<()> {
    sqlx::query(
        "UPDATE sync_state
            SET last_bcmr_run_at = now(), updated_at = now()
          WHERE id = 1",
    )
    .execute(pool)
    .await
    .context("mark_bcmr_run")?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Venue-listings helpers (Phase 4d — currently only Cauldron, but the
// `venue` column is a string to keep the shape open for Fex / Tapswap /
// Jazz when they're added).
// ---------------------------------------------------------------------------

/// One row-worth of data for an upsert into `token_venue_listings`.
/// Values are raw-from-the-venue; USD conversion happens at render time.
///
/// `tvl_satoshis` and `price_sats` describe the canonical (deepest) pool
/// for the category. `pools_count` and `pools_total_tvl_sats` describe
/// the full pool population for the same category at the same venue —
/// see schema for the full motivation. Both nullable: NULL means
/// "data not available" (e.g., the Cauldron worker leaves `pools_count`
/// NULL because no per-category pool-count endpoint exists upstream).
pub struct VenueListingWrite<'a> {
    pub venue: &'a str,
    pub category: Vec<u8>,
    pub price_sats: Option<f64>,
    pub tvl_satoshis: Option<i64>,
    pub pools_count: Option<i32>,
    pub pools_total_tvl_sats: Option<i64>,
}

/// Categories the Cauldron worker should check — only fungible tokens
/// (pure NFTs have no Cauldron market). Ordered by genesis_block so the
/// same category always hits Cauldron at roughly the same point in a
/// run; useful for operator debugging ("why did we get 429 at 12:13 UTC
/// every time?" — now there's a consistent progression).
pub async fn pick_cauldron_candidates(pool: &PgPool) -> Result<Vec<Vec<u8>>> {
    let rows: Vec<(Vec<u8>,)> = sqlx::query_as(
        "SELECT category
           FROM tokens
          WHERE token_type IN ('FT', 'FT+NFT')
          ORDER BY genesis_block ASC",
    )
    .fetch_all(pool)
    .await
    .context("pick_cauldron_candidates")?;
    Ok(rows.into_iter().map(|(c,)| c).collect())
}

/// Fast-path companion to `pick_cauldron_candidates`: only the
/// categories we already know are listed on Cauldron. Used by the
/// 10-minute refresh pass — re-reads prices + TVL for the ~317
/// currently-listed set, skips pruning (we didn't look at the
/// unlisted 3k, so we can't confirm delists).
pub async fn pick_cauldron_listed(pool: &PgPool) -> Result<Vec<Vec<u8>>> {
    let rows: Vec<(Vec<u8>,)> = sqlx::query_as(
        "SELECT category
           FROM token_venue_listings
          WHERE venue = 'cauldron'
            AND price_sats IS NOT NULL
          ORDER BY category ASC",
    )
    .fetch_all(pool)
    .await
    .context("pick_cauldron_listed")?;
    Ok(rows.into_iter().map(|(c,)| c).collect())
}

pub async fn upsert_venue_listing(pool: &PgPool, w: &VenueListingWrite<'_>) -> Result<()> {
    // `tvl_satoshis` is NUMERIC(30,0) in the schema but we bind it as i64
    // on the Rust side — Cauldron's API returns values that comfortably
    // fit i64, and adding a bigdecimal dep crate-wide for this one column
    // isn't worth it. The `$4::numeric` cast tells Postgres to promote
    // the BIGINT parameter into the column's NUMERIC type at insert time.
    sqlx::query(
        r#"
        INSERT INTO token_venue_listings
            (venue, category, price_sats, tvl_satoshis,
             pools_count, pools_total_tvl_sats,
             first_listed_at, updated_at)
        VALUES ($1, $2, $3, $4::numeric, $5, $6::numeric, now(), now())
        ON CONFLICT (venue, category) DO UPDATE
            SET price_sats           = EXCLUDED.price_sats,
                tvl_satoshis         = EXCLUDED.tvl_satoshis,
                pools_count          = EXCLUDED.pools_count,
                pools_total_tvl_sats = EXCLUDED.pools_total_tvl_sats,
                updated_at           = now()
        "#,
    )
    .bind(w.venue)
    .bind(&w.category)
    .bind(w.price_sats)
    .bind(w.tvl_satoshis)
    .bind(w.pools_count)
    .bind(w.pools_total_tvl_sats)
    .execute(pool)
    .await
    .with_context(|| {
        format!(
            "upsert token_venue_listings for venue={} category={}",
            w.venue,
            bytes_to_hex(&w.category)
        )
    })?;
    Ok(())
}

/// Append one point to `token_price_history`. Called once per successful
/// price fetch inside the Cauldron worker. Independent of the
/// `upsert_venue_listing` call so a schema-level history retention policy
/// can land later without touching the live snapshot write.
pub async fn insert_price_history_point(
    pool: &PgPool,
    venue: &str,
    category: &[u8],
    price_sats: f64,
    tvl_satoshis: Option<i64>,
) -> Result<()> {
    // See upsert_venue_listing — tvl_satoshis is NUMERIC(30,0); i64 ->
    // NUMERIC promotion happens via the explicit $4::numeric cast.
    sqlx::query(
        r#"
        INSERT INTO token_price_history (category, venue, price_sats, tvl_satoshis)
        VALUES ($1, $2, $3, $4::numeric)
        ON CONFLICT (category, venue, ts) DO NOTHING
        "#,
    )
    .bind(category)
    .bind(venue)
    .bind(price_sats)
    .bind(tvl_satoshis)
    .execute(pool)
    .await
    .with_context(|| {
        format!(
            "insert_price_history_point venue={} category={}",
            venue,
            bytes_to_hex(category)
        )
    })?;
    Ok(())
}

/// Remove rows whose categories are NOT in the `keep` list — i.e., the
/// venue used to list this token but no longer does. Only called after a
/// clean run (no hard fetch errors); a partial run that missed a token
/// due to a transient 5xx would otherwise incorrectly "delist" it.
///
/// **Never call with an empty `keep` slice** — the caller must already
/// have refused to prune in that case (e.g. a total venue outage where
/// every category 404'd). We also defend in depth here: Postgres treats
/// `x <> ALL(ARRAY[]::bytea[])` as vacuous-truth TRUE, so an empty-array
/// DELETE would wipe every row for the venue. Early-return a 0 instead.
///
/// Verified behaviour: feeding a 1-element `keep` must delete every row
/// for the venue whose `category` isn't that one byte-string. Worth an
/// operational sanity check on carson after the first full run: count
/// `token_venue_listings WHERE venue='cauldron'` before vs. after the
/// prune step and confirm the delta matches the expected delistings.
pub async fn prune_stale_venue_listings(
    pool: &PgPool,
    venue: &str,
    keep: &[Vec<u8>],
) -> Result<u64> {
    if keep.is_empty() {
        return Ok(0);
    }
    let res = sqlx::query(
        "DELETE FROM token_venue_listings
          WHERE venue = $1
            AND category <> ALL($2)",
    )
    .bind(venue)
    .bind(keep)
    .execute(pool)
    .await
    .with_context(|| format!("prune_stale_venue_listings venue={}", venue))?;
    Ok(res.rows_affected())
}

pub async fn mark_cauldron_run(pool: &PgPool) -> Result<()> {
    sqlx::query(
        "UPDATE sync_state
            SET last_cauldron_run_at = now(), updated_at = now()
          WHERE id = 1",
    )
    .execute(pool)
    .await
    .context("mark_cauldron_run")?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tapswap P2P listings helpers. Populate `tapswap_offers` rows recognised by
// the Tapswap walker (either the oneshot `tapswap-backfill` binary or the
// incremental scan inside `sync-tail`'s `process_block`).
//
// Day-one ships offers as `status='open'` only — spend detection (close
// transitions to 'taken' / 'cancelled') is a follow-up commit. The upsert
// is `ON CONFLICT DO NOTHING` because a listing's fields are immutable once
// on chain; the only thing that changes about it later is its lifecycle,
// which the future spend-walker will handle via a separate UPDATE path.
//
// Operational note: because we `DO NOTHING` on id-conflict, a parser bug fix
// does NOT retroactively correct rows already written by the buggy parser —
// those rows stick until deleted. After a material change to
// `workers/src/tapswap.rs` that affects decoded fields (not just the reject
// set), reset the table and rerun the backfill:
//   sudo -u bchn psql -d tokenstork -c "TRUNCATE tapswap_offers;"
//   sudo -u bchn psql -d tokenstork -c \
//     "UPDATE sync_state SET last_tapswap_backfill_through = NULL WHERE id = 1;"
//   sudo systemctl start sync-tapswap-backfill.service
// A follow-up may add a `parser_version` column + `DO UPDATE WHERE
// parser_version < $X` to automate this.
// ---------------------------------------------------------------------------

/// Row insert for a single open Tapswap offer. Decimal-string fields are
/// bound as TEXT and cast to NUMERIC in SQL via `$n::numeric` — Postgres
/// will not implicitly cast text→numeric over the prepared-statement
/// protocol.
pub struct OfferWrite {
    /// Listing tx txid (raw 32 bytes).
    pub id: [u8; 32],
    // "has" side — what the maker is offering (from outputs[0].tokenData):
    pub has_category: Option<[u8; 32]>,
    pub has_amount: Option<String>, // NUMERIC(78,0)-formatted
    pub has_commitment: Option<Vec<u8>>,
    pub has_capability: Option<&'static str>, // 'none' | 'mutable' | 'minting'
    pub has_sats: i64,
    // "want" side — what the maker wants in return (from OP_RETURN chunks 4-7):
    pub want_category: Option<[u8; 32]>,
    pub want_amount: Option<String>,
    pub want_commitment: Option<Vec<u8>>,
    pub want_capability: Option<&'static str>,
    pub want_sats: i64,
    // Metadata:
    pub fee_sats: i64,
    pub maker_pkh: [u8; 20], // raw bytes; UI renders as cashaddr at display time
    pub listed_block: i32,
    pub listed_at: chrono::DateTime<chrono::Utc>,
}

/// Insert one offer. Idempotent — re-running the backfill over overlapping
/// block ranges is safe (ON CONFLICT DO NOTHING on the primary key).
pub async fn upsert_tapswap_offer(pool: &PgPool, o: &OfferWrite) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO tapswap_offers
            (id, has_category, has_amount, has_commitment, has_capability, has_sats,
             want_category, want_amount, want_commitment, want_capability, want_sats,
             fee_sats, maker_pkh, listed_block, listed_at, status)
        VALUES
            ($1, $2, $3::numeric, $4, $5, $6,
             $7, $8::numeric, $9, $10, $11,
             $12, $13, $14, $15, 'open')
        ON CONFLICT (id) DO NOTHING
"#,
    )
    .bind(o.id.as_slice())
    .bind(o.has_category.as_ref().map(|c| c.as_slice()))
    .bind(o.has_amount.as_deref())
    .bind(o.has_commitment.as_deref())
    .bind(o.has_capability)
    .bind(o.has_sats)
    .bind(o.want_category.as_ref().map(|c| c.as_slice()))
    .bind(o.want_amount.as_deref())
    .bind(o.want_commitment.as_deref())
    .bind(o.want_capability)
    .bind(o.want_sats)
    .bind(o.fee_sats)
    .bind(o.maker_pkh.as_slice())
    .bind(o.listed_block)
    .bind(o.listed_at)
    .execute(pool)
    .await
    .with_context(|| format!("upsert_tapswap_offer {}", bytes_to_hex(&o.id)))?;
    Ok(())
}

/// Batch version for the backfill's block-level flushes. Wraps the
/// individual inserts in one transaction so a mid-batch failure rolls back
/// cleanly and the backfill can resume from the last good checkpoint.
pub async fn upsert_tapswap_offers_batch(pool: &PgPool, batch: &[OfferWrite]) -> Result<usize> {
    if batch.is_empty() {
        return Ok(0);
    }
    let mut tx = pool.begin().await.context("begin tapswap batch tx")?;
    for o in batch {
        sqlx::query(
            r#"
            INSERT INTO tapswap_offers
                (id, has_category, has_amount, has_commitment, has_capability, has_sats,
                 want_category, want_amount, want_commitment, want_capability, want_sats,
                 fee_sats, maker_pkh, listed_block, listed_at, status)
            VALUES
                ($1, $2, $3::numeric, $4, $5, $6,
                 $7, $8::numeric, $9, $10, $11,
                 $12, $13, $14, $15, 'open')
            ON CONFLICT (id) DO NOTHING
"#,
        )
        .bind(o.id.as_slice())
        .bind(o.has_category.as_ref().map(|c| c.as_slice()))
        .bind(o.has_amount.as_deref())
        .bind(o.has_commitment.as_deref())
        .bind(o.has_capability)
        .bind(o.has_sats)
        .bind(o.want_category.as_ref().map(|c| c.as_slice()))
        .bind(o.want_amount.as_deref())
        .bind(o.want_commitment.as_deref())
        .bind(o.want_capability)
        .bind(o.want_sats)
        .bind(o.fee_sats)
        .bind(o.maker_pkh.as_slice())
        .bind(o.listed_block)
        .bind(o.listed_at)
        .execute(&mut *tx)
        .await
        .with_context(|| {
            format!(
                "upsert_tapswap_offers_batch (id {})",
                bytes_to_hex(&o.id)
            )
        })?;
    }
    tx.commit().await.context("commit tapswap batch tx")?;
    Ok(batch.len())
}

/// Read the Tapswap backfill checkpoint (NULL before first run).
pub async fn load_tapswap_backfill_through(pool: &PgPool) -> Result<Option<i32>> {
    let row: (Option<i32>,) = sqlx::query_as(
        "SELECT last_tapswap_backfill_through FROM sync_state WHERE id = 1",
    )
    .fetch_one(pool)
    .await
    .context("load_tapswap_backfill_through")?;
    Ok(row.0)
}

/// Advance the Tapswap backfill checkpoint. Called every CHECKPOINT_EVERY
/// blocks by the backfill binary so a mid-run crash can resume from where
/// we left off.
pub async fn save_tapswap_backfill_through(pool: &PgPool, height: i32) -> Result<()> {
    sqlx::query(
        "UPDATE sync_state
            SET last_tapswap_backfill_through = $1,
                updated_at = now()
          WHERE id = 1",
    )
    .bind(height)
    .execute(pool)
    .await
    .context("save_tapswap_backfill_through")?;
    Ok(())
}

/// Load the spend-detection backfill checkpoint. `None` means the
/// one-shot has never run on this DB (fresh deploy, or pre-2026-04-25
/// install that predated the spend-detection feature).
pub async fn load_tapswap_spend_backfill_through(pool: &PgPool) -> Result<Option<i32>> {
    let row: (Option<i32>,) = sqlx::query_as(
        "SELECT last_tapswap_spend_backfill_through FROM sync_state WHERE id = 1",
    )
    .fetch_one(pool)
    .await
    .context("load_tapswap_spend_backfill_through")?;
    Ok(row.0)
}

/// Advance the spend-detection backfill checkpoint. Called every
/// CHECKPOINT_EVERY blocks by the spend-backfill binary so a mid-run
/// crash resumes from where we left off rather than re-walking the
/// entire range.
pub async fn save_tapswap_spend_backfill_through(pool: &PgPool, height: i32) -> Result<()> {
    sqlx::query(
        "UPDATE sync_state
            SET last_tapswap_spend_backfill_through = $1,
                updated_at = now()
          WHERE id = 1",
    )
    .bind(height)
    .execute(pool)
    .await
    .context("save_tapswap_spend_backfill_through")?;
    Ok(())
}

/// Touch `last_tapswap_run_at` — observability only, lets the Phase 7
/// staleness watchdog notice if the Tapswap walker stops without crashing.
pub async fn mark_tapswap_run(pool: &PgPool) -> Result<()> {
    sqlx::query(
        "UPDATE sync_state
            SET last_tapswap_run_at = now(), updated_at = now()
          WHERE id = 1",
    )
    .execute(pool)
    .await
    .context("mark_tapswap_run")?;
    Ok(())
}

/// One row per open Tapswap offer that a candidate spending tx in the
/// current block could be closing. Returned by
/// `find_open_tapswap_offers_by_id` so the walker can classify each
/// close (matching the listing's stored maker_pkh against outputs[0]
/// of the spending tx).
pub struct OpenOfferLookup {
    pub id: [u8; 32],
    pub maker_pkh: [u8; 20],
}

/// Bulk lookup of open offers by listing-txid (the `id` column).
/// Filters to `status = 'open'` so closed offers don't get re-closed
/// on a re-org or a duplicate detection. Returns at most `ids.len()`
/// rows; absent rows mean either the listing isn't ours (a different
/// tx was being spent) or it's already closed.
pub async fn find_open_tapswap_offers_by_id(
    pool: &PgPool,
    ids: &[[u8; 32]],
) -> Result<Vec<OpenOfferLookup>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    // sqlx wants a slice of slices for ANY(); convert to Vec<&[u8]> via
    // a temporary Vec<Vec<u8>> so the bound borrow is well-defined.
    let owned: Vec<Vec<u8>> = ids.iter().map(|a| a.to_vec()).collect();
    let rows: Vec<(Vec<u8>, Vec<u8>)> = sqlx::query_as(
        "SELECT id, maker_pkh
           FROM tapswap_offers
          WHERE status = 'open'
            AND id = ANY($1)",
    )
    .bind(&owned)
    .fetch_all(pool)
    .await
    .context("find_open_tapswap_offers_by_id")?;

    rows.into_iter()
        .map(|(id_bytes, pkh_bytes)| {
            let id: [u8; 32] = id_bytes
                .as_slice()
                .try_into()
                .map_err(|_| anyhow::anyhow!("tapswap_offers.id was not 32 bytes"))?;
            let maker_pkh: [u8; 20] = pkh_bytes
                .as_slice()
                .try_into()
                .map_err(|_| anyhow::anyhow!("tapswap_offers.maker_pkh was not 20 bytes"))?;
            Ok(OpenOfferLookup { id, maker_pkh })
        })
        .collect()
}

/// One row per close detected in the current block, ready to apply to
/// `tapswap_offers`. The walker builds a Vec of these and the writer
/// applies them in a single transaction.
pub struct OfferCloseWrite {
    pub id: [u8; 32],
    /// "taken" or "cancelled" (matches the schema CHECK constraint).
    pub status: &'static str,
    /// `Some(pkh)` when status is "taken" and we recovered outputs[0]
    /// PKH from the spending tx. `None` for cancelled or unrecoverable.
    pub taker_pkh: Option<[u8; 20]>,
    pub closed_tx: [u8; 32],
    pub closed_at: DateTime<Utc>,
}

/// Apply a batch of Tapswap closes. Each row becomes a guarded UPDATE
/// (`WHERE id = $1 AND status = 'open'`) so a duplicate close from a
/// re-processed block silently no-ops instead of re-stamping an already-
/// closed offer.
///
/// Auto-commit per row, NOT a wrapping transaction: a malformed row
/// shouldn't roll back already-applied close events. The lifecycle
/// transitions are independent — there's no cross-row invariant to
/// preserve. On per-row error, the early-return surfaces the failure
/// to the caller (which propagates up to the tail's checkpoint logic
/// so the block isn't marked done; the next tick re-processes and
/// retries the failed row, finding earlier rows already-closed and
/// no-op'ing them via the WHERE guard).
pub async fn apply_tapswap_closes(
    pool: &PgPool,
    batch: &[OfferCloseWrite],
) -> Result<usize> {
    if batch.is_empty() {
        return Ok(0);
    }
    let mut affected: usize = 0;
    for c in batch {
        let res = sqlx::query(
            r#"
            UPDATE tapswap_offers
               SET status     = $2,
                   taker_pkh  = $3,
                   closed_tx  = $4,
                   closed_at  = $5
             WHERE id = $1
               AND status = 'open'
            "#,
        )
        .bind(c.id.as_slice())
        .bind(c.status)
        .bind(c.taker_pkh.as_ref().map(|p| p.as_slice()))
        .bind(c.closed_tx.as_slice())
        .bind(c.closed_at)
        .execute(pool)
        .await
        .with_context(|| {
            format!(
                "apply_tapswap_closes id={} status={}",
                bytes_to_hex(&c.id),
                c.status
            )
        })?;
        affected += res.rows_affected() as usize;
    }
    Ok(affected)
}

/// Touch `last_fex_run_at` — observability only, lets the staleness
/// watchdog notice if the Fex scanner stops without crashing.
pub async fn mark_fex_run(pool: &PgPool) -> Result<()> {
    sqlx::query(
        "UPDATE sync_state
            SET last_fex_run_at = now(), updated_at = now()
          WHERE id = 1",
    )
    .execute(pool)
    .await
    .context("mark_fex_run")?;
    Ok(())
}

/// Snapshot of Cauldron's global aggregates. Sats-only — USD figures are
/// derived at render time from the live BCH price so the slower-moving
/// stats cadence (30 min) isn't pinned to whatever USD/BCH was at the
/// moment of fetch.
pub struct CauldronGlobalStatsWrite {
    pub tvl_sats: i64,
    pub volume_24h_sats: i64,
    pub volume_7d_sats: i64,
    pub volume_30d_sats: i64,
    pub pools_active: i32,
    pub pools_ended: i32,
    pub pools_interactions: i64,
    /// Pre-serialized JSON array of `{ "month": "YYYY-MM", "count": N }`.
    /// We serialize at the call site to avoid pulling a JSON dep into pg.rs's
    /// surface; sqlx accepts a JSON string for a `JSONB` column directly via
    /// the `::jsonb` cast in the upsert statement.
    pub unique_addresses_by_month_json: String,
}

/// Read-side counterpart of `CauldronGlobalStatsWrite`. Used by the
/// stats worker to preserve good prior values on a partial-failure run
/// (one endpoint times out → use the prior value for that field rather
/// than overwriting with zero).
pub struct CauldronGlobalStatsRead {
    pub tvl_sats: i64,
    pub volume_24h_sats: i64,
    pub volume_7d_sats: i64,
    pub volume_30d_sats: i64,
    pub pools_active: i32,
    pub pools_ended: i32,
    pub pools_interactions: i64,
    pub unique_addresses_by_month_json: String,
}

/// Internal tuple shape for the cauldron_global_stats SELECT — kept
/// behind a private type alias so clippy stops flagging the row-tuple
/// as too-complex inline. The order MUST match the SELECT column order.
type CauldronStatsRowTuple = (
    i64,    // tvl_sats
    i64,    // volume_24h_sats
    i64,    // volume_7d_sats
    i64,    // volume_30d_sats
    i32,    // pools_active
    i32,    // pools_ended
    i64,    // pools_interactions
    String, // unique_addresses_by_month::text
);

/// Read the current cauldron_global_stats row. Returns `None` if the
/// table is empty (fresh deploy before the first worker run); the seed
/// in schema.sql guarantees a row exists in the steady state, so a
/// `None` should be operationally rare.
pub async fn fetch_cauldron_global_stats(
    pool: &PgPool,
) -> Result<Option<CauldronGlobalStatsRead>> {
    // sqlx-with-query_as needs FromRow which requires Decode; rather than
    // derive that on a public type, hand-extract via a tuple type and
    // map. The unique_addresses column is JSONB which we read as a JSON
    // string via Postgres' ::text cast — symmetric with how we write it.
    let row: Option<CauldronStatsRowTuple> = sqlx::query_as(
        r#"
        SELECT tvl_sats,
               volume_24h_sats,
               volume_7d_sats,
               volume_30d_sats,
               pools_active,
               pools_ended,
               pools_interactions,
               unique_addresses_by_month::text
          FROM cauldron_global_stats
         WHERE id = 1
        "#,
    )
    .fetch_optional(pool)
    .await
    .context("fetch_cauldron_global_stats")?;
    Ok(row.map(|(t, v24, v7, v30, pa, pe, pi, j)| CauldronGlobalStatsRead {
        tvl_sats: t,
        volume_24h_sats: v24,
        volume_7d_sats: v7,
        volume_30d_sats: v30,
        pools_active: pa,
        pools_ended: pe,
        pools_interactions: pi,
        unique_addresses_by_month_json: j,
    }))
}

/// Upsert the cauldron_global_stats singleton row. The schema seeds id=1
/// on first deploy so this ON CONFLICT path is the steady-state writer.
pub async fn upsert_cauldron_global_stats(
    pool: &PgPool,
    s: &CauldronGlobalStatsWrite,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO cauldron_global_stats
            (id, tvl_sats, volume_24h_sats, volume_7d_sats, volume_30d_sats,
             pools_active, pools_ended, pools_interactions,
             unique_addresses_by_month, fetched_at, updated_at)
        VALUES
            (1, $1, $2, $3, $4, $5, $6, $7, $8::jsonb, now(), now())
        ON CONFLICT (id) DO UPDATE SET
            tvl_sats                  = EXCLUDED.tvl_sats,
            volume_24h_sats           = EXCLUDED.volume_24h_sats,
            volume_7d_sats            = EXCLUDED.volume_7d_sats,
            volume_30d_sats           = EXCLUDED.volume_30d_sats,
            pools_active              = EXCLUDED.pools_active,
            pools_ended               = EXCLUDED.pools_ended,
            pools_interactions        = EXCLUDED.pools_interactions,
            unique_addresses_by_month = EXCLUDED.unique_addresses_by_month,
            fetched_at                = now(),
            updated_at                = now()
        "#,
    )
    .bind(s.tvl_sats)
    .bind(s.volume_24h_sats)
    .bind(s.volume_7d_sats)
    .bind(s.volume_30d_sats)
    .bind(s.pools_active)
    .bind(s.pools_ended)
    .bind(s.pools_interactions)
    .bind(&s.unique_addresses_by_month_json)
    .execute(pool)
    .await
    .context("upsert_cauldron_global_stats")?;
    Ok(())
}

/// Touch `last_cauldron_stats_run_at` — observability for the staleness
/// watchdog. Fired even on partial-failure runs (i.e. when at least one
/// of the 6 sub-fetches succeeded) so the timestamp reflects the worker's
/// actual liveness, not just the all-success path.
pub async fn mark_cauldron_stats_run(pool: &PgPool) -> Result<()> {
    sqlx::query(
        "UPDATE sync_state
            SET last_cauldron_stats_run_at = now(), updated_at = now()
          WHERE id = 1",
    )
    .execute(pool)
    .await
    .context("mark_cauldron_stats_run")?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Blocks (per-block economics dashboard).
//
// One row per block ≥ CashTokens activation (792,772). Populated by both
// the live `sync-tail` Pass 4 walker and the one-shot `blocks-backfill`
// binary; both reuse `blocks::summarize_block` for the field derivation.
//
// `total_output_sats` binds to NUMERIC(30,0) via a string-formatted
// argument because a busy block can sum to > i64. Everything else is
// signed-integer-safe.
// ---------------------------------------------------------------------------

/// One block's row, keyed by height. `hash` is the raw 32-byte big-endian
/// hash, `time` the block's Unix-epoch seconds (converted to TIMESTAMPTZ
/// at the binding boundary), `total_output_sats` a decimal string for
/// NUMERIC(30,0).
#[derive(Debug, Clone)]
pub struct BlockWrite {
    pub height: i32,
    pub hash: Vec<u8>,
    pub time_unix: i64,
    pub tx_count: i32,
    /// Decimal string — bound to NUMERIC(30,0) via `::numeric` cast.
    pub total_output_sats: String,
    pub coinbase_sats: i64,
    pub fees_sats: i64,
    pub subsidy_sats: i64,
    pub size_bytes: i32,
}

/// Upsert one block. ON CONFLICT (height) DO UPDATE — re-inserts after a
/// reorg overwrite the prior row's hash/time/etc. with the fresh values.
/// Realistically a tail re-run on the same height should produce identical
/// values; the UPDATE is defensive.
pub async fn upsert_block(pool: &PgPool, b: &BlockWrite) -> Result<()> {
    let time_dt = epoch_to_datetime(b.time_unix)?;
    sqlx::query(
        r#"
        INSERT INTO blocks
            (height, hash, time, tx_count, total_output_sats,
             coinbase_sats, fees_sats, subsidy_sats, size_bytes)
        VALUES
            ($1, $2, $3, $4, $5::numeric, $6, $7, $8, $9)
        ON CONFLICT (height) DO UPDATE
           SET hash              = EXCLUDED.hash,
               time              = EXCLUDED.time,
               tx_count          = EXCLUDED.tx_count,
               total_output_sats = EXCLUDED.total_output_sats,
               coinbase_sats     = EXCLUDED.coinbase_sats,
               fees_sats         = EXCLUDED.fees_sats,
               subsidy_sats      = EXCLUDED.subsidy_sats,
               size_bytes        = EXCLUDED.size_bytes
"#,
    )
    .bind(b.height)
    .bind(b.hash.as_slice())
    .bind(time_dt)
    .bind(b.tx_count)
    .bind(&b.total_output_sats)
    .bind(b.coinbase_sats)
    .bind(b.fees_sats)
    .bind(b.subsidy_sats)
    .bind(b.size_bytes)
    .execute(pool)
    .await
    .with_context(|| format!("upsert_block height {}", b.height))?;
    Ok(())
}

/// Batch upsert wrapped in a single transaction. Used by the backfill to
/// flush several thousand blocks per checkpoint without paying per-row
/// commit overhead.
pub async fn upsert_blocks_batch(pool: &PgPool, batch: &[BlockWrite]) -> Result<usize> {
    if batch.is_empty() {
        return Ok(0);
    }
    let mut tx = pool.begin().await.context("begin blocks batch tx")?;
    for b in batch {
        let time_dt = epoch_to_datetime(b.time_unix)?;
        sqlx::query(
            r#"
            INSERT INTO blocks
                (height, hash, time, tx_count, total_output_sats,
                 coinbase_sats, fees_sats, subsidy_sats, size_bytes)
            VALUES
                ($1, $2, $3, $4, $5::numeric, $6, $7, $8, $9)
            ON CONFLICT (height) DO UPDATE
               SET hash              = EXCLUDED.hash,
                   time              = EXCLUDED.time,
                   tx_count          = EXCLUDED.tx_count,
                   total_output_sats = EXCLUDED.total_output_sats,
                   coinbase_sats     = EXCLUDED.coinbase_sats,
                   fees_sats         = EXCLUDED.fees_sats,
                   subsidy_sats      = EXCLUDED.subsidy_sats,
                   size_bytes        = EXCLUDED.size_bytes
"#,
        )
        .bind(b.height)
        .bind(b.hash.as_slice())
        .bind(time_dt)
        .bind(b.tx_count)
        .bind(&b.total_output_sats)
        .bind(b.coinbase_sats)
        .bind(b.fees_sats)
        .bind(b.subsidy_sats)
        .bind(b.size_bytes)
        .execute(&mut *tx)
        .await
        .with_context(|| format!("upsert_blocks_batch height {}", b.height))?;
    }
    tx.commit().await.context("commit blocks batch tx")?;
    Ok(batch.len())
}

/// Read the blocks-backfill checkpoint. None means the one-shot has never
/// run; the binary's caller substitutes the activation floor.
pub async fn load_blocks_backfill_through(pool: &PgPool) -> Result<Option<i32>> {
    let row: (Option<i32>,) = sqlx::query_as(
        "SELECT last_blocks_backfill_through FROM sync_state WHERE id = 1",
    )
    .fetch_one(pool)
    .await
    .context("load_blocks_backfill_through")?;
    Ok(row.0)
}

/// Advance the blocks-backfill checkpoint. Called every CHECKPOINT_EVERY
/// blocks so a mid-run crash resumes from where we left off.
pub async fn save_blocks_backfill_through(pool: &PgPool, height: i32) -> Result<()> {
    sqlx::query(
        "UPDATE sync_state
            SET last_blocks_backfill_through = $1,
                updated_at = now()
          WHERE id = 1",
    )
    .bind(height)
    .execute(pool)
    .await
    .context("save_blocks_backfill_through")?;
    Ok(())
}

/// Touch `last_blocks_run_at` — observability only, lets a future
/// staleness watchdog notice if the blocks walker stops without crashing.
pub async fn mark_blocks_run(pool: &PgPool) -> Result<()> {
    sqlx::query(
        "UPDATE sync_state
            SET last_blocks_run_at = now(), updated_at = now()
          WHERE id = 1",
    )
    .execute(pool)
    .await
    .context("mark_blocks_run")?;
    Ok(())
}

fn epoch_to_datetime(unix_secs: i64) -> Result<DateTime<Utc>> {
    Utc.timestamp_opt(unix_secs, 0)
        .single()
        .ok_or_else(|| anyhow!("invalid block timestamp {unix_secs}"))
}

/// Ensure the pool is closed before a binary exits — keeps Postgres from
/// logging warnings about abruptly terminated sessions.
pub async fn shutdown(pool: PgPool) {
    pool.close().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_roundtrip() {
        let b = hex_to_bytes("0xdeadbeef").unwrap();
        assert_eq!(b, vec![0xde, 0xad, 0xbe, 0xef]);
        assert_eq!(bytes_to_hex(&b), "deadbeef");
    }

    #[test]
    fn hex_backslash_prefix() {
        let b = hex_to_bytes(r"\xcafebabe").unwrap();
        assert_eq!(bytes_to_hex(&b), "cafebabe");
    }

    #[test]
    fn hex_invalid() {
        assert!(hex_to_bytes("zz").is_err());
    }

    #[test]
    fn token_type_merge_never_regresses() {
        assert_eq!(TokenType::Ft.merge(TokenType::FtNft), TokenType::FtNft);
        assert_eq!(TokenType::FtNft.merge(TokenType::Ft), TokenType::FtNft);
        assert_eq!(TokenType::Ft.merge(TokenType::Nft), TokenType::FtNft);
        assert_eq!(TokenType::Nft.merge(TokenType::Ft), TokenType::FtNft);
        assert_eq!(TokenType::Ft.merge(TokenType::Ft), TokenType::Ft);
        assert_eq!(TokenType::Nft.merge(TokenType::Nft), TokenType::Nft);
    }

    #[test]
    fn token_type_from_evidence() {
        assert_eq!(TokenType::from_evidence(true, false), TokenType::Ft);
        assert_eq!(TokenType::from_evidence(false, true), TokenType::Nft);
        assert_eq!(TokenType::from_evidence(true, true), TokenType::FtNft);
        // No evidence defaults to FT — matches the TS classifier, which is only
        // called after at least one tokenData was observed.
        assert_eq!(TokenType::from_evidence(false, false), TokenType::Ft);
    }
}
