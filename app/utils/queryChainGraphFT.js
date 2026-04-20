const HEX_REGEX = /^[a-fA-F0-9]{64}$/;

// Chaingraph hard-limits to 5000 results per query. To get all UTXOs for a token,
// we paginate using incrementing offsets until no more results are returned.
const CHAINGRAPH_PAGE_SIZE = 5000;

async function queryChainGraph(queryReq, chaingraphUrl) {
    const jsonObj = {
        "operationName": null,
        "variables": {},
        "query": queryReq
    };
    const response = await fetch(chaingraphUrl, {
        method: "POST",
        mode: "cors",
        cache: "no-cache",
        credentials: "same-origin",
        headers: {
            "Content-Type": "application/json",
        },
        redirect: "follow",
        referrerPolicy: "no-referrer",
        body: JSON.stringify(jsonObj),
    });
    return await response.json();
}

// Paginate through all FT UTXOs for a token category — handles Chaingraph's 5000 limit
export async function queryFtAddressesAll(tokenId, chaingraphUrl = "https://gql.chaingraph.pat.mn/v1/graphql") {
    if (!HEX_REGEX.test(tokenId)) {
        throw new Error("Invalid token ID format");
    }

    let allUtxos = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
        const queryReq = `query {
            output(
                offset: ${offset}
                limit: ${CHAINGRAPH_PAGE_SIZE}
                where: {
                    token_category: { _eq: "\\\\x${tokenId}" }
                    _not: { spent_by: {} }
                }
            ) {
                locking_bytecode,
                transaction_hash,
                fungible_token_amount
            }
        }`;
        const result = await queryChainGraph(queryReq, chaingraphUrl);
        const utxos = result.data?.output || [];

        allUtxos.push(...utxos);

        if (utxos.length < CHAINGRAPH_PAGE_SIZE) {
            hasMore = false;
        } else {
            offset += CHAINGRAPH_PAGE_SIZE;
        }
    }

    return allUtxos;
}

export async function queryFtAddresses(tokenId, offset = 0) {
    if (!HEX_REGEX.test(tokenId)) {
        throw new Error("Invalid token ID format");
    }
    const queryReqTotalSupply = `query {
        output(
          offset: ${offset}
          limit: ${CHAINGRAPH_PAGE_SIZE}
          where: {
            token_category: {
              _eq: "\\\\x${tokenId}"
            }
            _not: { spent_by: {} }
          }
        ) {
          locking_bytecode,
          transaction_hash,
	  fungible_token_amount
        }
    }`;
    return await queryChainGraph(queryReqTotalSupply, "https://gql.chaingraph.pat.mn/v1/graphql");
}

export async function getTapSwapOrigin(txidParent) {
  if (!HEX_REGEX.test(txidParent)) {
    throw new Error("Invalid transaction ID format");
  }
  const queryParentTxId = `query {
    transaction(
        where: {
          hash: {
            _eq: "\\\\x${txidParent}"
          }
        }
      ) {
        inputs {
          outpoint_transaction_hash,
          outpoint_index
        }
      }
  }`;
  const result = await queryChainGraph(queryParentTxId, "https://gql.chaingraph.pat.mn/v1/graphql");
  const outpoint = result.data.transaction[0].inputs[0]
  const txid = outpoint.outpoint_transaction_hash.slice(2);
  const vout = outpoint.outpoint_index
  const getLockingBytecode = `query {
    transaction(
        where: {
          hash: {
            _eq: "\\\\x${txid}"
          }
        }
      ) {
        outputs {
          locking_bytecode
        }
      }
  }`;
  const result2 = await queryChainGraph(getLockingBytecode, "https://gql.chaingraph.pat.mn/v1/graphql");
  return result2.data.transaction[0].outputs[+vout].locking_bytecode;
}
