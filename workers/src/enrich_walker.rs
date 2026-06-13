//! Event-driven enrichment: derive per-block token-UTXO deltas from BCHN
//! block data. Sibling of [`crate::tapswap_walker`] — same "one function,
//! both the live tail and a backfill call it" shape, same error policy
//! (propagate so the tail checkpoint doesn't advance and the block re-runs).
//!
//! This module holds the **pure** derivation: `Block -> BlockDeltas`. It has
//! no DB or network dependency, so it's exhaustively unit-testable. The DB
//! apply (insert creates, delete spends `RETURNING category`, re-aggregate the
//! touched categories into token_state/token_holders/nft_instances) lives in
//! `crate::pg` and is driven by `sync-tail`.
//!
//! Design rationale + migration plan: `docs/enrich-event-driven-design.md`.

use std::collections::HashSet;

use anyhow::{Context, Result};
use num_bigint::BigInt;

use crate::bchn::{Block, NftCapability, TokenAmount};
use crate::cashaddr::script_to_cashaddr_body;

/// A token-bearing output created in this block → one `live_token_utxo` row.
#[derive(Debug, Clone, PartialEq)]
pub struct LiveUtxo {
    pub txid: [u8; 32],
    pub vout: i32,
    pub category: [u8; 32],
    /// Owner cashaddr without `bitcoincash:` prefix; `None` for nonstandard
    /// scripts (amount still counts toward supply, attributes to no holder).
    pub address: Option<String>,
    pub amount: BigInt,
    pub nft_commitment: Option<Vec<u8>>,
    pub nft_capability: Option<NftCapability>,
    pub created_height: i32,
}

/// An outpoint consumed in this block → delete the `live_token_utxo` row with
/// this PK (a no-op for non-token outpoints).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct OutPoint {
    pub txid: [u8; 32],
    pub vout: i32,
}

#[derive(Debug, Default)]
pub struct BlockDeltas {
    pub creates: Vec<LiveUtxo>,
    pub spends: Vec<OutPoint>,
    /// Categories touched by *created* outputs. Categories touched only by a
    /// spend are unknowable from block data alone (the input carries no token
    /// data), so the DB apply unions them in via `DELETE ... RETURNING category`.
    pub touched_by_creates: HashSet<[u8; 32]>,
}

/// Decode a 32-byte id (txid or category) from BCHN's display-order hex,
/// matching how `tokens.category` / txids are stored elsewhere (raw
/// `hex::decode`, no reversal).
fn decode_id32(hex_str: &str) -> Result<[u8; 32]> {
    let bytes = hex::decode(hex_str).with_context(|| format!("hex decode {hex_str}"))?;
    <[u8; 32]>::try_from(bytes.as_slice())
        .map_err(|_| anyhow::anyhow!("expected 32-byte id, got {} bytes", hex_str.len() / 2))
}

fn parse_amount(a: &TokenAmount) -> Result<BigInt> {
    match a {
        TokenAmount::Number(n) => Ok(BigInt::from(*n)),
        // Propagate, never coerce: an unparseable amount silently undercounts
        // supply + the owner's balance. It's spec-impossible from BCHN, which
        // is exactly why we fail loud — matching the legacy enrich path and the
        // strict read-back in pg::load_live_utxos_for_category.
        TokenAmount::Text(s) => s
            .parse::<BigInt>()
            .with_context(|| format!("parsing token amount {s:?}")),
    }
}

/// CashAddr-style capability → the DB's TEXT enum (`none|mutable|minting`).
pub fn nft_capability_str(c: NftCapability) -> &'static str {
    match c {
        NftCapability::None => "none",
        NftCapability::Mutable => "mutable",
        NftCapability::Minting => "minting",
    }
}

/// Parse the DB's `nft_capability` TEXT back into [`NftCapability`].
pub fn nft_capability_from_str(s: &str) -> Result<NftCapability> {
    match s {
        "none" => Ok(NftCapability::None),
        "mutable" => Ok(NftCapability::Mutable),
        "minting" => Ok(NftCapability::Minting),
        other => Err(anyhow::anyhow!("unknown nft_capability {other:?}")),
    }
}

/// Derive the token-UTXO creates/spends for one block. Pure; no I/O.
pub fn derive_block_deltas(block: &Block) -> Result<BlockDeltas> {
    let height: i32 = block
        .height
        .try_into()
        .context("block.height does not fit in i32")?;
    let mut deltas = BlockDeltas::default();

    for tx in &block.tx {
        let tx_txid = decode_id32(&tx.txid).with_context(|| format!("tx txid {}", &tx.txid))?;

        // Spends: every non-coinbase input removes whatever outpoint it
        // consumes. We can't tell here whether it was a token UTXO — the
        // batched delete is a no-op for non-token outpoints.
        for vin in &tx.vin {
            let (Some(prev_hex), Some(prev_vout)) = (vin.txid.as_ref(), vin.vout) else {
                continue; // coinbase or malformed input
            };
            let prev_txid =
                decode_id32(prev_hex).with_context(|| format!("prevout txid in {}", &tx.txid))?;
            deltas.spends.push(OutPoint {
                txid: prev_txid,
                vout: i32::try_from(prev_vout).context("prevout index overflows i32")?,
            });
        }

        // Creates: every output carrying tokenData becomes a live row.
        for (n, vout) in tx.vout.iter().enumerate() {
            let Some(td) = &vout.token_data else { continue };
            let category = decode_id32(&td.category)
                .with_context(|| format!("category in tx {}", &tx.txid))?;
            let amount = match &td.amount {
                Some(a) => parse_amount(a)?,
                None => BigInt::from(0),
            };
            let (nft_commitment, nft_capability) = match &td.nft {
                Some(nft) => (
                    Some(hex::decode(&nft.commitment).unwrap_or_default()),
                    Some(nft.capability),
                ),
                None => (None, None),
            };
            let script = hex::decode(&vout.script_pub_key.hex).unwrap_or_default();
            let address = script_to_cashaddr_body(&script);

            deltas.creates.push(LiveUtxo {
                txid: tx_txid,
                vout: i32::try_from(n).context("vout index overflows i32")?,
                category,
                address,
                amount,
                nft_commitment,
                nft_capability,
                created_height: height,
            });
            deltas.touched_by_creates.insert(category);
        }
    }

    Ok(deltas)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bchn::{Block, Nft, ScriptPubKey, ScriptSig, TokenData, Tx, Vin, Vout};

    const CAT: &str = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
    const GENESIS_TX: &str = "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2";

    fn p2pkh_hex(pkh: u8) -> String {
        let mut s = vec![0x76u8, 0xa9, 0x14];
        s.extend_from_slice(&[pkh; 20]);
        s.extend_from_slice(&[0x88, 0xac]);
        hex::encode(s)
    }

    fn ft_vout(amount: &str, pkh: u8) -> Vout {
        Vout {
            token_data: Some(TokenData {
                category: CAT.to_string(),
                amount: Some(TokenAmount::Text(amount.to_string())),
                nft: None,
            }),
            script_pub_key: ScriptPubKey { hex: p2pkh_hex(pkh) },
            value: 0.0,
        }
    }

    fn coinbase_tx() -> Tx {
        Tx {
            txid: "c0".repeat(32),
            vout: vec![],
            vin: vec![Vin { txid: None, vout: None, script_sig: None, coinbase: Some("00".into()) }],
        }
    }

    fn block(height: u64, txs: Vec<Tx>) -> Block {
        Block { hash: "00".repeat(32), height, time: 1_700_000_000, tx: txs, size: 0 }
    }

    #[test]
    fn create_ft_output_produces_row_with_encoded_owner() {
        let tx = Tx { txid: GENESIS_TX.to_string(), vout: vec![ft_vout("1000", 0x11)], vin: vec![] };
        let d = derive_block_deltas(&block(800_000, vec![coinbase_tx(), tx])).unwrap();

        assert_eq!(d.creates.len(), 1);
        let u = &d.creates[0];
        assert_eq!(u.amount, BigInt::from(1000));
        assert_eq!(u.vout, 0);
        assert_eq!(u.created_height, 800_000);
        assert_eq!(u.category, decode_id32(CAT).unwrap());
        assert!(u.address.as_deref().unwrap().starts_with('q'), "P2PKH owner encoded");
        assert!(d.touched_by_creates.contains(&decode_id32(CAT).unwrap()));
    }

    #[test]
    fn spend_records_outpoint_keyed_for_delete() {
        // Spending tx consumes vout 0 of GENESIS_TX.
        let spend = Tx {
            txid: "d4".repeat(32),
            vout: vec![],
            vin: vec![Vin {
                txid: Some(GENESIS_TX.to_string()),
                vout: Some(0),
                script_sig: Some(ScriptSig { hex: String::new() }),
                coinbase: None,
            }],
        };
        let d = derive_block_deltas(&block(800_001, vec![coinbase_tx(), spend])).unwrap();
        assert_eq!(d.spends.len(), 1);
        assert_eq!(d.spends[0], OutPoint { txid: decode_id32(GENESIS_TX).unwrap(), vout: 0 });
        assert!(d.creates.is_empty());
    }

    #[test]
    fn coinbase_input_is_not_a_spend() {
        let d = derive_block_deltas(&block(800_002, vec![coinbase_tx()])).unwrap();
        assert!(d.spends.is_empty(), "coinbase has no prevout");
        assert!(d.creates.is_empty());
    }

    #[test]
    fn nft_output_carries_commitment_and_capability() {
        let tx = Tx {
            txid: GENESIS_TX.to_string(),
            vout: vec![Vout {
                token_data: Some(TokenData {
                    category: CAT.to_string(),
                    amount: None,
                    nft: Some(Nft { capability: NftCapability::Minting, commitment: "deadbeef".into() }),
                }),
                script_pub_key: ScriptPubKey { hex: p2pkh_hex(0x22) },
                value: 0.0,
            }],
            vin: vec![],
        };
        let d = derive_block_deltas(&block(800_003, vec![tx])).unwrap();
        let u = &d.creates[0];
        assert_eq!(u.amount, BigInt::from(0));
        assert_eq!(u.nft_commitment.as_deref(), Some([0xde, 0xad, 0xbe, 0xef].as_slice()));
        assert_eq!(u.nft_capability, Some(NftCapability::Minting));
    }

    #[test]
    fn non_token_outputs_are_ignored() {
        let tx = Tx {
            txid: GENESIS_TX.to_string(),
            vout: vec![Vout {
                token_data: None,
                script_pub_key: ScriptPubKey { hex: p2pkh_hex(0x33) },
                value: 1.0,
            }],
            vin: vec![],
        };
        let d = derive_block_deltas(&block(800_004, vec![tx])).unwrap();
        assert!(d.creates.is_empty(), "plain BCH output is not a token UTXO");
    }
}
