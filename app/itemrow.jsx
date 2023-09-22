import React, { useState, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCopy,
  faGlobe,
  faCircleQuestion,
} from "@fortawesome/free-solid-svg-icons";
import {
  faTwitter,
  faInstagram,
  faYoutube,
  faDiscord,
  faTelegram,
} from "@fortawesome/free-brands-svg-icons";
import { useBCHPrice } from "./bchpriceclientprovider";
import Image from "next/image";

const ItemRow = ({ item, copyText }) => {
  const { bchPrice } = useBCHPrice();
  const { uris, token } = item;
  const { category, symbol } = token;

  const linkItems = {
    web: faGlobe,
    twitter: faTwitter,
    instagram: faInstagram,
    youtube: faYoutube,
    support: faCircleQuestion,
    discord: faDiscord,
    telegram: faTelegram,
  };

  const [electrumData, setElectrumData] = useState({
    price: "Loading...",
  });
  const [liquidityValue, setLiquidityValue] = useState("N/A");

  function satoshisToBCH(satoshis) {
    return satoshis / 100000000;
  }

  const fetchElectrumDataForCategory = async (category) => {
    try {
      // Fetch the token details from the paytaca API using the category as the tokenId
      const tokenResponse = await fetch(
        `https://bcmr.paytaca.com/api/tokens/${category}`
      );
      if (!tokenResponse.ok) {
        throw new Error(`Paytaca API returned status: ${tokenResponse.status}`);
      }
      const tokenData = await tokenResponse.json();
      const decimals = tokenData.token.decimals;

      const res = await fetch(
        `https://cauldronapi.panmoni.com/token_price?category=${category}&decimals=${decimals}`
      );
      if (!res.ok) {
        throw new Error(`API returned status: ${res.status}`);
      }
      const data = await res.json();
      const { buy, sell } = data.result;

      if (!buy && !sell) {
        return { price: "N/A" };
      } else if (typeof buy !== "number" || typeof sell !== "number") {
        console.error("Invalid response from the API.");
        console.error(data);
        return null;
      } else {
        const avgPrice = (buy + sell) / 2;
        return { price: avgPrice };
      }

      return data.result;
    } catch (error) {
      console.error("Error fetching data:", error);
      return null;
    }
  };

  let displayPrice = "Loading..."; // Default value
  if (electrumData) {
    if (electrumData.price === "N/A") {
      displayPrice = "N/A";
    } else {
      const bchValue = satoshisToBCH(parseFloat(electrumData.price));
      const usdValue = bchValue * bchPrice;
      if (isNaN(usdValue)) {
        displayPrice = "Error";
      } else if (usdValue >= 1) {
        // If USD value >= 1, display with 2 decimal places
        displayPrice = `$${Math.round(usdValue * 100) / 100}`;
      } else {
        // If USD value < 1, display with 6 decimal places
        displayPrice = `$${(Math.round(usdValue * 1000000) / 1000000).toFixed(
          6
        )}`;
      }
    }
  }

  // Function to fetch liquidity data
  const fetchLiquidityDataForCategory = async (category) => {
    try {
      const response = await fetch(
        `https://cauldronapi.panmoni.com/token_liquidity?category=${category}`
      );
      if (!response.ok) {
        throw new Error(`Liquidity API returned status: ${response.status}`);
      }
      const data = await response.json();
      const bchValue = satoshisToBCH(data.result.bch);
      const usdValue = bchValue * bchPrice;

      // Format the usdValue with commas
      const formattedValue = `$${usdValue.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
      return formattedValue;
    } catch (error) {
      console.error("Error fetching liquidity data:", error);
      return null;
    }
  };

  useEffect(() => {
    (async () => {
      const data = await fetchElectrumDataForCategory(category);
      setElectrumData(data);

      // Fetch liquidity data and update the state
      const liquidityData = await fetchLiquidityDataForCategory(category);
      if (liquidityData !== null) {
        setLiquidityValue(liquidityData);
      }
    })();
  }, [category, bchPrice]);

  return (
    <div className="row">
      {/* Icon, Name, and Symbol */}
      <div className="cell icon-symbol-name">
        <Image
          src={
            item?.uris?.icon?.startsWith("ipfs://")
              ? "https://ipfs.io/ipfs/" + item.uris.icon.substring(7)
              : item?.uris?.icon
          }
          alt={item?.name}
          width={64}
          height={64}
        />
        <span className="name" title={item.description}>
          {item.name.length > 20 ? item.name.substr(0, 20) + "..." : item.name}
        </span>
        <span className="symbol" title={item.description}>
          {item.token.symbol}
        </span>
      </div>
      {/* Price */}
      <div className="cell price">{displayPrice}</div>
      {/* Circulating Supply */}
      <div className="cell circSupply">N/A</div>
      {/* Max Supply */}
      <div className="cell maxSupply">{item.maxSupply || "N/A"}</div>
      {/* Market Cap */}
      <div className="cell marketCap">N/A</div>
      <div className="cell tvl">{liquidityValue}</div>
      {/* Category with copy and link icons */}
      <div className="cell category">
        <span className="category-display" title={item.token.category}>
          {item.token.category.slice(0, 5) +
            "..." +
            item.token.category.slice(-5)}
        </span>{" "}
        <FontAwesomeIcon
          className="icon-space"
          icon={faCopy}
          onClick={() => copyText(item.token.category)}
          title="Copy category to clipboard"
          style={{ cursor: "pointer" }}
        />
        <a
          href={`https://explorer.salemkode.com/token/${item.token.category}`}
          target="_blank"
          rel="noopener noreferrer"
          title="View on SalemKode Explorer"
        >
          <Image
            src="/salemkode.png"
            className="sk-icon"
            alt="Link to token on SalemKode Explorer"
            width={24}
            height={24}
          />
        </a>
      </div>
      {/* Links */}
      <div className="cell links">
        {/* Iterate over each key in `item.uris` and create links */}
        {Object.keys(item.uris).map((key) => {
          // Check if the key exists in linkItems
          if (linkItems[key]) {
            return (
              <a
                key={key}
                title={`${key} from BCMR`}
                href={item.uris[key]}
                target="_blank"
                rel="noopener noreferrer"
              >
                <FontAwesomeIcon icon={linkItems[key]} className="bcmr-links" />
              </a>
            );
          }
          return null; // Return null if the key doesn't exist in linkItems
        })}
      </div>
    </div>
  );
};

export default ItemRow;
