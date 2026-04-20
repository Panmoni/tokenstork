// @/pages/api/tokens/[category]/holders.ts
// GET /api/tokens/<category_hex>/holders?limit=100&offset=0
// Top-N holders of a given category, by balance.

import type { NextApiRequest, NextApiResponse } from "next";
import { bytesFromHex, query } from "@/lib/pg";

const HEX_REGEX = /^[0-9a-fA-F]{64}$/;

interface HolderRow {
  address: string;
  balance: string;
  nft_count: number;
  snapshot_at: Date;
}

interface HoldersResponse {
  category: string;
  holders: Array<{
    address: string;
    balance: string;     // decimal string (NUMERIC)
    nftCount: number;
    snapshotAt: number;  // Unix seconds
  }>;
  count: number;
  limit: number;
  offset: number;
  total: number;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<HoldersResponse | { error: string }>
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

  const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 1000);
  const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);

  res.setHeader("Cache-Control", "public, max-age=60");

  try {
    const categoryBytes = bytesFromHex(category);

    const countRes = await query<{ total: string }>(
      `SELECT COUNT(*)::bigint AS total FROM token_holders WHERE category = $1`,
      [categoryBytes]
    );
    const total = Number(countRes.rows[0]?.total ?? 0);

    const rowsRes = await query<HolderRow>(
      `SELECT address, balance::text AS balance, nft_count, snapshot_at
         FROM token_holders
        WHERE category = $1
        ORDER BY balance DESC, address ASC
        LIMIT $2 OFFSET $3`,
      [categoryBytes, limit, offset]
    );

    return res.status(200).json({
      category: category.toLowerCase(),
      holders: rowsRes.rows.map((r) => ({
        address: r.address,
        balance: r.balance,
        nftCount: r.nft_count,
        snapshotAt: Math.floor(r.snapshot_at.getTime() / 1000),
      })),
      count: rowsRes.rows.length,
      limit,
      offset,
      total,
    });
  } catch (err) {
    console.error("[api/tokens/[category]/holders] error:", err);
    return res.status(500).json({ error: "Failed to fetch holders" });
  }
}
