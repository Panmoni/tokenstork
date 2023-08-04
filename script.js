"use strict";

import { queryTotalSupplyFT } from './queryChainGraph.js';
const chaingraphUrl = "https://gql.chaingraph.pat.mn/v1/graphql";

// Get the price of BCH in USD from CoinGecko
fetch(
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd"
)
  .then((response) => response.json())
  .then((data) => {
    const price = data["bitcoin-cash"].usd;
    document.getElementById("bch-price").textContent = `$${price.toFixed(2)}`;
  })
  .catch((error) => {
    console.error("Error:", error);
  });

// Get Fear and Greed index
async function getFGI() {
  try {
    const url = "https://fear-and-greed-index.p.rapidapi.com/v1/fgi";
    const options = {
      method: "GET",
      headers: {
        "X-RapidAPI-Key": "1e842df5cdmshe40976c5c3e4772p14374cjsn255db4bf0165",
        "X-RapidAPI-Host": "fear-and-greed-index.p.rapidapi.com",
      },
    };
    const response = await fetch(url, options);
    const data = await response.json();
    const currentIndex = data.fgi.now.value;
    document.getElementById("fear-greed").textContent = currentIndex;
  } catch (error) {
    console.error(error);
  }
}

getFGI();

// FT whitelist. Request listing: hello@panmoni.com.
const tokenIds = [
  "b79bfc8246b5fc4707e7c7dedcb6619ef1ab91f494a790c20b0f4c422ed95b92",
  "de980d12e49999f1dbc8d61a8f119328f7be9fb1c308eafe979bf10abb17200d",
  "482d555258d3be69fef6ffcd0e5eeb23c4aaacec572b25ab1c21897600c45887",
  "f6677f3d3805d70949b375d36e094ff0ec9ece2a2cb1fde6d8b0e90b368f1f63",
  "8473d94f604de351cdee3030f6c354d36b257861ad8e95bbc0a06fbab2a2f9cf",
  "8bc2ebc1547257265ece8381f3ed6aa573c5aa8a23e0f552dc7128bb8a8e6f0f",
  "b69f76548653033603cdcb81299e3c1d1f3d61ad66e7ba0e6569b493605b4cbe",
  "36546e4062a1cfd070a4a8d8ff9db18aae4ddf8d9ac9a4fa789314d108b49797",
];

// Get number of tokens being tracked.
document.getElementById("ftCount").textContent = `${tokenIds.length}`;

// This is the list of headers to display.
const headers = document.getElementById("headers");
const headerNames = [
  "Name",
  "Price",
  "Circulating Supply",
  "Max Supply",
  "Market Cap",
  "Category",
  "Links",
];

// Roadmap: HDW Change, Volume

// Create a new div for each header
headerNames.forEach((headerName) => {
  const headerDiv = document.createElement("div");
  headerDiv.className = "header";
  headerDiv.textContent = headerName;
  headers.appendChild(headerDiv);
});

// Fetch data for a token id and return the result.
async function fetchDataForTokenId(tokenId) {
  try {
    const response = await fetch(
      `https://bcmr.paytaca.com/api/tokens/${tokenId}`
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Error fetching data for token id ${tokenId}: `, error);
  }
}

// Fetch data for all token ids and return the results.
async function fetchDataForAllTokenIds() {
  try {
    const promises = tokenIds.map(fetchDataForTokenId);
    const results = await Promise.allSettled(promises);
    return results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
  } catch (error) {
    console.error(`Error fetching data for all token ids: `, error);
  }
}

// The alert message when copying the category
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

// This function copies the category to the clipboard
function copyText(inputElement) {
  let tempElement = document.createElement("textarea");
  tempElement.value = inputElement.value;
  document.body.appendChild(tempElement);
  tempElement.select();
  document.execCommand("copy");
  document.body.removeChild(tempElement);
  showToast("Category copied to clipboard");
}

// Fetch data and display it in the HTML page.
fetchDataForAllTokenIds()
  .then((data) => {
    const container = document.getElementById("container");

    // Create a new div for each row
    data.forEach((item) => {
      const row = document.createElement("div");
      row.className = "row";
      container.appendChild(row);

      // Create and append the icon, name and symbol in one cell
      const iconSymbolNameCell = document.createElement("div");
      iconSymbolNameCell.className = "cell icon-symbol-name";

      const iconImg = document.createElement("img");
      let imageUrl = item.uris.icon;
      if (imageUrl.startsWith("ipfs://")) {
        imageUrl = "https://ipfs.io/ipfs/" + imageUrl.substring(7);
      }
      iconImg.src = imageUrl;
      iconImg.width = 64;
      iconImg.height = 64;
      iconImg.title = item.name;
      iconImg.alt = item.name;
      iconSymbolNameCell.appendChild(iconImg);

      const nameSpan = document.createElement("span");
      nameSpan.textContent =
        item.name.length > 20 ? item.name.substr(0, 20) + "..." : item.name;
      nameSpan.className = "name";
      nameSpan.title = item.description;
      iconSymbolNameCell.appendChild(nameSpan);

      const symbolSpan = document.createElement("span");
      symbolSpan.textContent = item.token.symbol;
      symbolSpan.className = "symbol";
      symbolSpan.title = item.description;
      iconSymbolNameCell.appendChild(symbolSpan);

      row.appendChild(iconSymbolNameCell);

      // Create and append the price in one cell
      const priceCell = document.createElement("div");
      priceCell.className = "cell price";
      priceCell.textContent = "$0.00";
      row.appendChild(priceCell);

      // Create and append the circulating supply in one cell
      const circSupplyCell = document.createElement("div");
      circSupplyCell.className = "cell circSupply";
      circSupplyCell.textContent = "N/A";
      row.appendChild(circSupplyCell);

      // Create and append the max supply in one cell
      // Humanize the max supply
      function humanizeMaxSupply(num) {
        var units = [
          "",
          "thousand",
          "million",
          "billion",
          "trillion",
          "quadrillion",
          "quintillion",
        ];

        // Make sure the number is positive and get its logarithm
        var magnitude = Math.log10(Math.abs(num));

        // Determine the unit to use
        var unitIndex = Math.min(Math.floor(magnitude / 3), units.length - 1);

        // Get the number in terms of that unit
        var normalizedNum = num / Math.pow(10, unitIndex * 3);

        // Round to one decimal place and add the unit
        return normalizedNum.toFixed(1) + " " + units[unitIndex];
      }

      const maxSupplyCell = document.createElement("div");

      const responseJson = queryTotalSupplyFT(item.token.category, chaingraphUrl);
      const totalAmount = responseJson.data.transaction[0].outputs.reduce((total, output) => total +  parseInt(output.fungible_token_amount),0);
      maxSupplyAmount = humanizeMaxSupply(totalAmount);

      // let onlySixteenDigitsForNow = humanizeMaxSupply(1000000000000000);
      // let nf = new Intl.NumberFormat("en-US");
      maxSupplyCell.className = "cell maxSupply";
      // maxSupplyCell.innerText = nf.format(onlySixteenDigitsForNow);
      maxSupplyCell.textContent = maxSupplyAmount;
      row.appendChild(maxSupplyCell);

      // Create and append the market cap in one cell
      const marketCapCell = document.createElement("div");
      marketCapCell.className = "cell marketCap";
      marketCapCell.textContent = "N/A";
      row.appendChild(marketCapCell);

      // Create and append the category in one cell
      const categoryCell = document.createElement("div");
      categoryCell.className = "cell category";

      // Shorten the category
      let shortCategory =
        item.token.category.slice(0, 10) +
        "..." +
        item.token.category.slice(-10);
      let categoryDisplay = document.createElement("span");
      categoryDisplay.textContent = shortCategory;
      categoryDisplay.title = item.token.category;
      categoryDisplay.className = "category-display";

      //  Create a hidden input to copy the category
      const categoryInput = document.createElement("input");
      categoryInput.value = item.token.category;
      categoryInput.readOnly = true;
      categoryCell.appendChild(categoryDisplay);

      // Create a copy icon
      const copyIcon = document.createElement("i");
      copyIcon.className = "fa-solid fa-copy copy-icon";
      copyIcon.style.cursor = "copy";
      copyIcon.title = "Copy category to clipboard";
      copyIcon.onclick = function () {
        copyText(categoryInput);
      };
      categoryCell.appendChild(copyIcon);

      // Create and link to salemkode explorer
      const icon = document.createElement("img");
      icon.src = "img/salemkode.png";
      icon.className = "sk-icon";
      icon.style.width = "24px";
      icon.style.height = "24px";
      icon.alt = "Link to token on SalemKode Explorer";
      const iconLink = document.createElement("a");
      iconLink.href =
        "https://explorer.salemkode.com/token/" + categoryInput.value;
      iconLink.target = "_blank";
      iconLink.rel = "noopener noreferrer";
      iconLink.title = "View on SalemKode Explorer";
      iconLink.appendChild(icon);

      categoryCell.appendChild(iconLink);

      row.appendChild(categoryCell);

      // Add token links from BCMR
      const linksCell = document.createElement("div");
      linksCell.className = "cell links";

      let linkItems = {
        web: "fa-solid fa-globe",
        twitter: "fa-brands fa-twitter",
        instagram: "fa-brands fa-instagram",
        youtube: "fa-brands fa-youtube",
        support: "fa-solid fa-question-circle",
        discord: "fa-brands fa-discord",
        telegram: "fa-brands fa-telegram",
      };

      // Iterate over each key in `token.uris`
      for (let key in item.uris) {
        // If the key exists in `linkItems`, create a link
        if (key in linkItems) {
          let url = item.uris[key];
          let iconClass = linkItems[key];

          // Create the link element
          let linkElement = document.createElement("a");
          linkElement.title = `${key} from BCMR`;
          linkElement.href = url;
          linkElement.target = "_blank";
          linkElement.rel = "noopener noreferrer";

          // Create the icon element
          let iconElement = document.createElement("i");
          iconElement.className = `bcmr-links ${iconClass}`;
          linkElement.appendChild(iconElement);

          // Append the link element to the linksCell
          linksCell.appendChild(linkElement);
        }
      }

      row.appendChild(linksCell);

      // Add the row to the container
      container.appendChild(row);
    });
  })
  .catch((e) => {
    console.log("Error: " + e);
  });
