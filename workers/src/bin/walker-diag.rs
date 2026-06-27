//! walker-diag — one-shot diagnostic that calls walk_category_utxos against
//! the live BlockBook for a single category, printing both the raw response
//! body length and the parsed walker output. Use to verify whether the
//! deployed binary is hitting a different bytes-on-the-wire shape than the
//! unit-test fixtures suggest.
//!
//! Usage: BLOCKBOOK_URL=... walker-diag <category-hex>

use std::env;

use anyhow::Result;
use tracing_subscriber::EnvFilter;
use workers::blockbook::{AddressTxsResponse, BlockbookClient};

#[tokio::main]
async fn main() -> Result<()> {
    // Replicate enrich's init_tracing exactly to see if tracing-subscriber
    // setup is what differs.
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();

    let cat = env::args()
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("usage: walker-diag <category-hex>"))?;

    // Skip pool init for this test.
    println!("[diag] pg pool skipped");

    let bb = BlockbookClient::from_env()?;

    println!("[diag] category: {}", cat);

    // Bypass walk_category_utxos for first call so we see the raw response.
    let url = format!(
        "{}/api/v2/address/{}?details=txs&page=1&pageSize=1000",
        env::var("BLOCKBOOK_URL").unwrap_or_else(|_| "http://127.0.0.1:9131".to_string()),
        cat
    );
    println!("[diag] GET {}", url);
    let raw = reqwest::get(&url).await?.text().await?;
    println!("[diag] raw body length: {}", raw.len());
    println!("[diag] raw first 500 chars: {}", &raw.chars().take(500).collect::<String>());

    // Parse manually with serde_json to surface error if any
    match serde_json::from_str::<AddressTxsResponse>(&raw) {
        Ok(parsed) => {
            let txs = parsed.transactions.unwrap_or_default();
            println!("[diag] parsed: {} transactions, totalPages={:?}",
                txs.len(), parsed.total_pages);
            for (i, tx) in txs.iter().enumerate() {
                println!("[diag] tx[{}] txid={} vout count={}", i, tx.txid, tx.vout.len());
                for v in &tx.vout {
                    println!("[diag]   vout n={} has_td={} spent={:?}",
                        v.n, v.token_data.is_some(), v.spent);
                    if let Some(td) = &v.token_data {
                        println!("[diag]     td.category={} td.amount={:?} has_nft={}",
                            td.category, td.amount, td.nft.is_some());
                    }
                }
            }
        }
        Err(e) => {
            println!("[diag] parse FAILED: {}", e);
        }
    }

    // Now run via the actual walker
    println!("[diag] --- via walk_category_utxos ---");

    // Simulate enrich's flow: get_node_info first, then walk multiple
    // categories in succession. If the second/third walks truncate where
    // the first didn't, the issue is connection-state across calls.
    let info = bb.get_node_info().await?;
    println!("[diag] get_node_info ok best_height={:?}", info.blockbook.best_height);

    // No PG. Just walk a category 3 times. First truncated?
    println!("[diag] === pure walks, no PG ===");
    for i in 1..=3 {
        let utxos = bb.walk_category_utxos(&cat).await?;
        println!("[diag] iter {} → {} utxos", i, utxos.len());
    }
    let utxos = bb.walk_category_utxos(&cat).await?;
    println!("[diag] walker returned {} utxos", utxos.len());
    Ok(())
}
