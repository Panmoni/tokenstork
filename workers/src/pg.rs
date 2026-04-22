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
