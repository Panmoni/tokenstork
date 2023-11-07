// app/page.tsx

"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";

import tokenIds from "@/app/utils/tokenIds.js";
import { getTokenData } from "@/app/utils/getTokenData";
import {
  humanizeBigNumber,
  formatMarketCap,
} from "@/app/utils/presentationUtils";

import { TokenData } from "@/app/interfaces";
import { useBCHPrice } from "@/app/providers/bchpriceclientprovider";

import TokenSkeleton from "@/app/components/TokenSkeleton";
import FormatCategory from "@/app/components/FormatCategory";
import MagLegend from "@/app/components/MagLegend";

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
// TODO: make it also reactive to changes in token prices/data
// TODO: legend for orders of magnitude abbreviations

export default function TokenDataPage() {
  const [tokenData, setTokenData] = useState<TokenData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const { bchPrice } = useBCHPrice();
  const updateInterval = 300000; // milliseconds

  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    async function fetchData() {
      setLoading(true);
      try {
        if (bchPrice === null) {
          throw new Error("BCH price is not available");
        }
        const fixedPrice = parseFloat(bchPrice.toFixed(2));

        const dataPromises = tokenIds.map((category) =>
          getTokenData(category, fixedPrice)
        );
        const results = await Promise.all(dataPromises);
        const allTokenData = results.flat();
        setTokenData(allTokenData);
      } catch (error) {
        if (error instanceof Error) {
          setError(error.message);
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
    return <TokenSkeleton />;
  }

  if (tokenData.length === 0) {
    return <p>No token data available.</p>;
  }

  return (
    <main className="px-1 sm:px-2 lg:px-4 text-lg">
      <h2 className="text-3xl font-extrabold mb-4">
        <span className="text-transparent bg-clip-text bg-gradient-to-r to-accent from-primary">
          Today&apos;s BCH CashTokens Prices by Total Value Locked
        </span>
      </h2>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <div>
          <Flex
            className="space-x-0.5"
            justifyContent="start"
            alignItems="center"
          >
            <Title> BCH CashTokens Market Cap Data </Title>
          </Flex>
          <Table className="mt-6">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Ticker</TableHeaderCell>
                <TableHeaderCell className="text-right">
                  Price ($){" "}
                  <Icon
                    icon={InformationCircleIcon}
                    variant="simple"
                    tooltip="Prices are highly speculative"
                    className="align-middle"
                  />
                </TableHeaderCell>
                <TableHeaderCell className="text-right">
                  Circulating Supply
                  <Icon
                    icon={InformationCircleIcon}
                    variant="simple"
                    tooltip="The supply present at the authbase"
                    className="align-middle"
                  />
                </TableHeaderCell>
                <TableHeaderCell className="text-right">
                  Max Supply{" "}
                  <Icon
                    icon={InformationCircleIcon}
                    variant="simple"
                    tooltip="Max supply is always fixed at genesis"
                    className="align-middle"
                  />
                </TableHeaderCell>
                <TableHeaderCell className="text-right">
                  Market Cap ($){" "}
                  <Icon
                    icon={InformationCircleIcon}
                    variant="simple"
                    tooltip="Market caps are highly speculative"
                    className="align-middle"
                  />
                </TableHeaderCell>
                <TableHeaderCell className="text-right">
                  TVL ($){" "}
                  <Icon
                    icon={InformationCircleIcon}
                    variant="simple"
                    tooltip="Total Value Locked"
                    className="align-middle"
                  />
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
              {tokenData.map((token) => (
                <TableRow
                  key={token.name}
                  className="transition duration-200 ease-in-out cursor-pointer hover:shadow-lg hover:bg-gradient-to-r from-violet-600/20 to-indigo-600/10"
                >
                  <TableCell>
                    <Image
                      src={
                        token.icon?.startsWith("ipfs://")
                          ? "https://ipfs.io/ipfs/" + token.icon.substring(7)
                          : token.icon
                      }
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
                    {humanizeBigNumber(token.circulatingSupply)}
                  </TableCell>
                  <TableCell className="text-right hover:text-xl">
                    {humanizeBigNumber(token.maxSupply)}
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
          <MagLegend />
        </div>
      )}
    </main>
  );
}
