//! auth-cleanup — periodic deletion of expired auth_challenges and
//! sessions rows. Both tables grow monotonically without this — neither
//! is on a hot path that prunes itself, but both have indexes that filter
//! out expired rows on the read paths, so functionality is unaffected
//! either way. This binary is purely about disk hygiene.
//!
//! Cadence: hourly (via the matching `sync-auth-cleanup.timer` unit).
//! Cheap enough that we could run more often if growth ever becomes a
//! concern.
//!
//! Design notes:
//! - We delete rows that aged past expires_at by more than 1 day, not
//!   strictly anything past expires_at. The 1-day grace window lets
//!   future debug / audit queries find recently-expired rows; the cost
//!   is at most 24 h × N hourly-runs of unused storage, which is
//!   tiny.
//! - DELETE returns the affected row count, which we log so the operator
//!   can see "auth-cleanup deleted X challenges, Y sessions" in the
//!   journal. Useful for abuse detection.
//!
//! Env vars:
//! - DATABASE_URL  Postgres URL (required)
//! - RUST_LOG      log filter; defaults to info

use anyhow::{Context, Result};
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

use workers::pg;

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

    let pool = pg::pool_from_env().await.context("connecting to Postgres")?;

    // Delete expired auth_challenges. The 1-day grace window means a
    // freshly-expired row stays visible in journalctl-correlated
    // debugging for ~25h post-expiry — useful when reviewing failure
    // patterns. After that, gone.
    // Defensive `expires_at IS NOT NULL` even though the schema declares
    // the column NOT NULL — if a future migration loosens that, this
    // binary won't silently delete every row in the table because
    // `NULL < now() - INTERVAL '1 day'` evaluates to NULL (falsy in a
    // WHERE), but the readability cost of an extra clause is zero and
    // the cost of getting it wrong is "delete all sessions".
    let challenges_deleted: i64 = match sqlx::query_scalar(
        r#"WITH deleted AS (
              DELETE FROM auth_challenges
               WHERE expires_at IS NOT NULL
                 AND expires_at < now() - INTERVAL '1 day'
           RETURNING 1
           )
           SELECT COUNT(*)::bigint FROM deleted"#,
    )
    .fetch_one(&pool)
    .await
    {
        Ok(n) => n,
        Err(e) => {
            warn!(error = %e, "DELETE on auth_challenges failed");
            -1
        }
    };

    let sessions_deleted: i64 = match sqlx::query_scalar(
        r#"WITH deleted AS (
              DELETE FROM sessions
               WHERE expires_at IS NOT NULL
                 AND expires_at < now() - INTERVAL '1 day'
           RETURNING 1
           )
           SELECT COUNT(*)::bigint FROM deleted"#,
    )
    .fetch_one(&pool)
    .await
    {
        Ok(n) => n,
        Err(e) => {
            warn!(error = %e, "DELETE on sessions failed");
            -1
        }
    };

    info!(
        challenges_deleted,
        sessions_deleted, "auth-cleanup complete"
    );

    pg::shutdown(pool).await;
    Ok(())
}
