const HEX_REGEX = /^[a-fA-F0-9]{64}$/;

export async function queryFtAddresses(tokenId, offset = 0) {
    if (!HEX_REGEX.test(tokenId)) {
      throw new Error("Invalid token ID format");
    }
    const queryReqTotalSupply = `query {
        output(
          offset: ${offset}
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

async function queryChainGraph(queryReq, chaingraphUrl) {
    const jsonObj = {
        "operationName": null,
        "variables": {},
        "query": queryReq
    };
    const response = await fetch(chaingraphUrl, {
        method: "POST",
        mode: "cors", // no-cors, *cors, same-origin
        cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
        credentials: "same-origin", // include, *same-origin, omit
        headers: {
            "Content-Type": "application/json",
        },
        redirect: "follow", // manual, *follow, error
        referrerPolicy: "no-referrer", // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
        body: JSON.stringify(jsonObj), // body data type must match "Content-Type" header
    });
    return await response.json();
}
