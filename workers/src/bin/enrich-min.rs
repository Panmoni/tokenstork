//! enrich-min — replicates enrich's flow (init_tracing + pool + node_info +
//! walk one category) but takes the category from argv. Goal: isolate which
//! step in enrich's main causes walk_category_utxos to truncate.

use std::env;

use anyhow::{Context, Result};
use tracing_subscriber::EnvFilter;
use workers::blockbook::BlockbookClient;
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
    let cat = env::args()
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("usage: enrich-min <category-hex>"))?;

    let bb = BlockbookClient::from_env().context("building BlockBook client")?;
    let _pool = pg::pool_from_env().await.context("connecting to Postgres")?;

    let info = bb.get_node_info().await.context("blockbook /api/v2/")?;
    eprintln!("[min] node best_height={:?}", info.blockbook.best_height);

    // Mimic enrich.rs: pick a batch (DB query), then walk each category.
    let batch = pg::pick_enrichment_batch(&_pool, 6, 24 * 7, 3).await?;
    eprintln!("[min] picked {} categories", batch.len());

    for category_bytes in &batch {
        let category_hex = pg::bytes_to_hex(category_bytes);
        let utxos = bb.walk_category_utxos(&category_hex).await?;
        eprintln!("[min] picked {} -> {} utxos", &category_hex[..16], utxos.len());
    }

    eprintln!("[min] now testing user-specified cat");
    let utxos = bb.walk_category_utxos(&cat).await?;
    eprintln!("[min] walk_category_utxos returned {} utxos", utxos.len());

    Ok(())
}
