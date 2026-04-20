// @/pages/api/tokens/[category]/nfts.ts
// GET /api/tokens/<category_hex>/nfts?limit=500&offset=0
// All NFT instances for a given category.

import type { NextApiRequest, NextApiResponse } from "next";
import { bytesFromHex, hexFromBytes, query } from "@/lib/pg";

const HEX_REGEX = /^[0-9a-fA-F]{64}$/;

interface NftRow {
  commitment: Buffer;
  capability: "none" | "mutable" | "minting";
  owner_address: string | null;
  snapshot_at: Date;
}

interface NftsResponse {
  category: string;
  nfts: Array<{
    commitment: string;    // hex
    capability: "none" | "mutable" | "minting";
    ownerAddress: string | null;
    snapshotAt: number;    // Unix seconds
  }>;
  count: number;
  limit: number;
  offset: number;
  total: number;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<NftsResponse | { error: string }>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawCategory = req.query.category;
  const category = Array.isArray(rawCategory) ? rawCategory[0] : rawCategory;
  if (!category || !HEX_REGEX.test(category)) {
    return res.status(400).json({ error: "invalid category (expected 64 hex chars)" });
  }

  const capability = typeof req.query.capability === "string" ? req.query.capability : null;
  if (capability && !["none", "mutable", "minting"].includes(capability)) {
    return res.status(400).json({ error: "invalid capability" });
  }

  const limit = Math.min(Math.max(Number(req.query.limit ?? 500) || 500, 1), 5000);
  const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);

  res.setHeader("Cache-Control", "public, max-age=60");

  try {
    const categoryBytes = bytesFromHex(category);
    const whereParts: string[] = ["category = $1"];
    const queryValues: unknown[] = [categoryBytes];
    if (capability) {
      whereParts.push(`capability = $${queryValues.length + 1}`);
      queryValues.push(capability);
    }
    const whereSql = `WHERE ${whereParts.join(" AND ")}`;

    const countRes = await query<{ total: string }>(
      `SELECT COUNT(*)::bigint AS total FROM nft_instances ${whereSql}`,
      queryValues
    );
    const total = Number(countRes.rows[0]?.total ?? 0);

    const rowsRes = await query<NftRow>(
      `SELECT commitment, capability, owner_address, snapshot_at
         FROM nft_instances
         ${whereSql}
        ORDER BY commitment ASC
        LIMIT $${queryValues.length + 1} OFFSET $${queryValues.length + 2}`,
      [...queryValues, limit, offset]
    );

    return res.status(200).json({
      category: category.toLowerCase(),
      nfts: rowsRes.rows.map((r) => ({
        commitment: hexFromBytes(r.commitment)!,
        capability: r.capability,
        ownerAddress: r.owner_address,
        snapshotAt: Math.floor(r.snapshot_at.getTime() / 1000),
      })),
      count: rowsRes.rows.length,
      limit,
      offset,
      total,
    });
  } catch (err) {
    console.error("[api/tokens/[category]/nfts] error:", err);
    return res.status(500).json({ error: "Failed to fetch NFTs" });
  }
}
