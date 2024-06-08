// app/page.tsx

"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";

import tokenIds from "@/app/utils/tokenIds.js";
import { getTokenData } from "@/app/utils/getTokenData";
import {
  humanizeBigNumber,
  formatMarketCap,
  getIPFSUrl,
} from "@/app/utils/presentationUtils";

import { TokenData } from "@/app/interfaces";
import { useBCHPrice } from "@/app/providers/bchpriceclientprovider";

import TokenSkeleton from "@/app/components/TokenSkeleton";
import FormatCategory from "@/app/components/FormatCategory";
import BottomCards from "@/app/components/BottomCards";

import { InformationCircleIcon } from "@heroicons/react/solid";
import {
  Flex,
  Icon,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Title,
} from "@tremor/react";

// TODO: explore search example from https://github.com/vercel/nextjs-postgres-nextauth-tailwindcss-template/tree/main
// TODO: should this be all server and zero client?
// TODO: does the new UI work via proxy?
// TODO: add tabs on this and add a tab for NFTs.

type SortState = {
  column: string;
  direction: "asc" | "desc";
};

export default function TokenDataPage() {
  const [tokenData, setTokenData] = useState<TokenData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [sortState, setSortState] = useState<SortState>({
    column: "tvl",
    direction: "desc",
  });
  const { bchPrice } = useBCHPrice();
  const updateInterval = 300000; // milliseconds

  const sortData = (data: TokenData[], { column, direction }: SortState) => {
    return [...data].sort((a, b) => {
      if (a[column] < b[column]) {
        return direction === "asc" ? -1 : 1;
      }
      if (a[column] > b[column]) {
        return direction === "asc" ? 1 : -1;
      }
      return 0;
    });
  };

  const onSort = (column: string) => {
    const isAsc = sortState.column === column && sortState.direction === "asc";
    setSortState({
      column,
      direction: isAsc ? "desc" : "asc",
    });
  };

  const sortedData = sortData(tokenData, sortState);

  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    async function fetchData() {
      setLoading(true);
      try {
        if (bchPrice === null) {
          throw new Error("BCH price is not available");
        }
        const fixedPrice = parseFloat(bchPrice.toFixed(2));

    const expire_time = 86400000
    let expiry;
    expiry = localStorage.getItem("token_data_cache") || "";
    if ( expiry == "" || ( parseInt(expiry) - Date.now() ) < 0 )
    {
	localStorage.clear();
	localStorage.setItem( "token_data_cache", String( (Date.now() + expire_time) ) );
    }

        const dataPromises = tokenIds.map(async (category) => {
          try {
            return await getTokenData(category, fixedPrice);
          } catch (e) {
            return Promise.resolve(null);
          }
        });
        const results = await Promise.all(dataPromises);
        const allTokenData: TokenData[] = results.flat().filter((d): d is TokenData => d !== null);
        setTokenData(allTokenData);
      } catch (error) {
        if (error instanceof Error) {
          setError(`Error fetching token data: ${error.message}`);
        } else {
          setError("An unexpected error occurred");
        }
      } finally {
        setLoading(false);
      }
    }

    if (bchPrice !== null) {
      fetchData();
      intervalId = setInterval(fetchData, updateInterval);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [bchPrice]);

  if (error) {
    return <p>Error: {error}</p>;
  }

  if (loading) {
    return (
      <>
        <TokenSkeleton />
        <BottomCards />
      </>
    );
  }

  if (tokenData.length === 0) {
    return <p>No token data available.</p>;
  }

  return (
    <main className="px-1 sm:px-2 lg:px-4 text-lg">
      <h2 className="text-3xl font-extrabold mb-4">
        <span className="text-transparent bg-clip-text bg-gradient-to-r to-accent from-primary">
          Today&apos;s BCH CashTokens Prices
        </span>
      </h2>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <div>
          <Table className="mt-6">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Token Name</TableHeaderCell>
                <TableHeaderCell>
                  Ticker
                  <Icon
                    icon={InformationCircleIcon}
                    variant="simple"
                    tooltip="Token metadata subject to change"
                    className="align-middle"
                  />
                </TableHeaderCell>
                <TableHeaderCell
                  className="text-right cursor-pointer"
                  onClick={() => onSort("price")}
                >
                  Price ($){" "}
                  {sortState.column === "price" ? (
                    <span>{sortState.direction === "asc" ? "↑" : "↓"}</span>
                  ) : (
                    <span>↕</span>
                  )}
                  <Icon
                    icon={InformationCircleIcon}
                    variant="simple"
                    tooltip="Prices are highly speculative"
                    className="align-middle"
                  />
                </TableHeaderCell>
                <TableHeaderCell className="text-right cursor-pointer">
                  Circulating Supply
                  <Icon
                    icon={InformationCircleIcon}
                    variant="simple"
                    tooltip="The supply present at the authbase"
                    className="align-middle"
                  />
                </TableHeaderCell>
                <TableHeaderCell className="text-right cursor-pointer">
                  Max Supply{" "}
                  <Icon
                    icon={InformationCircleIcon}
                    variant="simple"
                    tooltip="Max supply is always fixed at genesis"
                    className="align-middle"
                  />
                </TableHeaderCell>
                <TableHeaderCell
                  className="text-right cursor-pointer"
                  onClick={() => onSort("marketCapBigInt")}
                >
                  Market Cap ($){" "}
                  {sortState.column === "marketCapBigInt" ? (
                    <span>{sortState.direction === "asc" ? "↑" : "↓"}</span>
                  ) : (
                    <span>↕</span>
                  )}
                  <Icon
                    icon={InformationCircleIcon}
                    variant="simple"
                    tooltip="Market caps are highly speculative"
                    className="align-middle"
                  />
                </TableHeaderCell>
                <TableHeaderCell
                  className="text-right cursor-pointer"
                  onClick={() => onSort("tvl")}
                >
                  TVL ($){" "}
                  <Icon
                    icon={InformationCircleIcon}
                    variant="simple"
                    tooltip="Total Value Locked"
                    className="align-middle"
                  />
                  <span>
                    {sortState.column === "tvl"
                      ? sortState.direction === "asc"
                        ? "↑"
                        : "↓"
                      : "↕"}
                  </span>
                </TableHeaderCell>
                <TableHeaderCell className="text-right">
                  Token Category{" "}
                  <Icon
                    icon={InformationCircleIcon}
                    variant="simple"
                    tooltip="Sometimes referred to as TokenID"
                    className="align-middle"
                  />
                </TableHeaderCell>
              </TableRow>
            </TableHead>

            <TableBody className="!opacity-100">
              {sortedData.map((token) => (
                <TableRow
                  key={token.name}
                  className="transition duration-200 ease-in-out cursor-pointer hover:shadow-lg hover:bg-gradient-to-r from-violet-600/20 to-indigo-600/10"
                >
                  <TableCell>
                    <Image
                      src={getIPFSUrl(token.icon)}
                      alt={token.name}
                      width={32}
                      height={32}
                      className="rounded-full inline align-middle"
                      title={token.description}
                    />{" "}
                    <span
                      className="align-middle font-semibold"
                      title={token.description}
                    >
                      {token.name.length > 22
                        ? token.name.substr(0, 22) + "..."
                        : token.name}
                    </span>
                  </TableCell>
                  <TableCell>{token.symbol}</TableCell>
                  <TableCell className="text-right hover:text-xl">
                    {token.price === 0
                      ? "-"
                      : token.price >= 1
                      ? "$" + token.price.toFixed(2)
                      : "$" + token.price.toFixed(6)}
                  </TableCell>
                  <TableCell className="text-right hover:text-xl">
                    {humanizeBigNumber(Number(token.circulatingSupply))}
                  </TableCell>
                  <TableCell className="text-right hover:text-xl">
                    {humanizeBigNumber(Number(token.maxSupply))}
                  </TableCell>
                  <TableCell className="text-right hover:text-xl">
                    {formatMarketCap(token.marketCap)}
                  </TableCell>
                  <TableCell className="text-right hover:text-xl">
                    {Number(token.tvl) === 0
                      ? "-"
                      : Number(token.tvl) >= 1000
                      ? "$" +
                        Number(token.tvl).toLocaleString("en-US", {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        })
                      : "$" + Number(token.tvl).toFixed(0)}
                  </TableCell>
                  <TableCell className="text-right">
                    <FormatCategory category={token.category} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <BottomCards />
        </div>
      )}
    </main>
  );
}
