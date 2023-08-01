"use strict";

// This is the price of Bitcoin Cash
fetch(
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd"
)
  .then((response) => response.json())
  .then((data) => {
    const price = data["bitcoin-cash"].usd;
    document.getElementById("bch-price").innerText = `$${price.toFixed(2)}`;
  })
  .catch((error) => {
    console.error("Error:", error);
  });

// This is the list of token ids to fetch data for.
const tokenIds = [
  "de980d12e49999f1dbc8d61a8f119328f7be9fb1c308eafe979bf10abb17200d",
  "482d555258d3be69fef6ffcd0e5eeb23c4aaacec572b25ab1c21897600c45887",
  "8473d94f604de351cdee3030f6c354d36b257861ad8e95bbc0a06fbab2a2f9cf",
  "8bc2ebc1547257265ece8381f3ed6aa573c5aa8a23e0f552dc7128bb8a8e6f0f",
  "b69f76548653033603cdcb81299e3c1d1f3d61ad66e7ba0e6569b493605b4cbe",
  "36546e4062a1cfd070a4a8d8ff9db18aae4ddf8d9ac9a4fa789314d108b49797",
];

// This is the number of tokens being tracked.
document.getElementById("ftCount").textContent = `${tokenIds.length}`;

// This is the list of headers to display.
const headers = document.getElementById("headers");
const headerNames = [
  "Name",
  "Price",
  "Market Cap",
  "Max Supply",
  "AuthChain",
  "Category",
  "Website",
  "Twitter",
];

// Roadmap: HDW Change, Volume, Circulating Supply

// Create a new div for each header
headerNames.forEach((headerName) => {
  const headerDiv = document.createElement("div");
  headerDiv.className = "header";
  headerDiv.innerText = headerName;
  headers.appendChild(headerDiv);
});

// This function fetches data for a token id and returns the result.
async function fetchDataForTokenId(tokenId) {
  const response = await fetch(
    `https://bcmr.paytaca.com/api/tokens/${tokenId}`
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  } else {
    return await response.json();
  }
}

// This function fetches data for all token ids and returns the results.
async function fetchDataForAllTokenIds() {
  const promises = tokenIds.map(fetchDataForTokenId);
  const results = await Promise.allSettled(promises);
  return results
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
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
    console.log(data); // remove this for production
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
      iconSymbolNameCell.appendChild(iconImg);

      const nameSpan = document.createElement("span");
      nameSpan.innerText =
        item.name.length > 20 ? item.name.substr(0, 20) + "..." : item.name;
      nameSpan.className = "name";
      nameSpan.title = item.description;
      iconSymbolNameCell.appendChild(nameSpan);

      const symbolSpan = document.createElement("span");
      symbolSpan.innerText = item.token.symbol;
      symbolSpan.className = "symbol";
      symbolSpan.title = item.description;
      iconSymbolNameCell.appendChild(symbolSpan);

      row.appendChild(iconSymbolNameCell);

      // Create and append the price in one cell
      const priceCell = document.createElement("div");
      priceCell.className = "cell price";
      priceCell.innerText = "$0.00";
      row.appendChild(priceCell);

      // Create and append the market cap in one cell
      const marketCapCell = document.createElement("div");
      marketCapCell.className = "cell marketCap";
      marketCapCell.innerText = "N/A";
      row.appendChild(marketCapCell);

      // Create and append the max supply in one cell
      const maxSupplyCell = document.createElement("div");
      let onlySixteenDigitsForNow = 1000000000000000;
      let nf = new Intl.NumberFormat("en-US");
      maxSupplyCell.className = "cell maxSupply";
      maxSupplyCell.innerText = nf.format(onlySixteenDigitsForNow);
      row.appendChild(maxSupplyCell);

      // Create and append the auth chain in one cell
      const authChainCell = document.createElement("div");
      authChainCell.className = "cell authChain";
      authChainCell.innerText = "";
      const authIcon = document.createElement("i");
      authIcon.className = "fa-solid fa-square-check";
      authIcon.style.cursor = "pointer";
      authChainCell.appendChild(authIcon);
      row.appendChild(authChainCell);

      // Create and append the category in one cell
      const categoryCell = document.createElement("div");
      categoryCell.className = "cell category";
      const categoryInput = document.createElement("input");
      categoryInput.value = item.token.category;
      categoryInput.readOnly = true;
      categoryCell.appendChild(categoryInput);

      const copyIcon = document.createElement("i");
      copyIcon.className = "fa-solid fa-copy copy-icon";
      copyIcon.style.cursor = "copy";
      copyIcon.title = "Copy category to clipboard";
      copyIcon.onclick = function () {
        copyText(categoryInput);
      };
      categoryCell.appendChild(copyIcon);

      // Create and append the icon link
      const icon = document.createElement("img");
      icon.src = "salemkode.png";
      icon.className = "sk-icon";
      icon.style.width = "24px";
      icon.style.height = "24px";

      const iconLink = document.createElement("a");
      iconLink.href =
        "https://explorer.salemkode.com/token/" + categoryInput.value;
      iconLink.target = "_blank";
      iconLink.rel = "noopener noreferrer";
      iconLink.title = "View on SalemKode Explorer";
      iconLink.appendChild(icon);

      categoryCell.appendChild(iconLink);

      row.appendChild(categoryCell);

      // Create and append the web link if it exists
      const webCell = document.createElement("div");
      webCell.className = "cell web";
      if (item.uris && item.uris.web) {
        const webLink = document.createElement("a");
        webLink.href = item.uris.web;
        webLink.target = "_blank";
        webLink.rel = "noopener noreferrer";
        webLink.title = "Visit external website at your own risk.";
        webLink.innerText = item.uris.web
          .replace("https://", "")
          .replace(/\/$/, "")
          .toLowerCase();
        const externalLinkIcon = document.createElement("i");
        externalLinkIcon.className =
          "fa-solid fa-arrow-up-right-from-square external-link-icon";
        externalLinkIcon.style.cursor = "pointer";
        webLink.appendChild(externalLinkIcon);

        webCell.appendChild(webLink);
      } else {
        const xIcon = document.createElement("i");
        xIcon.className = "fa-solid fa-x";
        xIcon.style.cursor = "pointer";
        xIcon.title = "No website";
        webCell.appendChild(xIcon);
      }

      row.appendChild(webCell);

      // Create and append the twitter link if it exists
      const twitterCell = document.createElement("div");
      twitterCell.className = "cell twitter";

      if (item.uris && item.uris.twitter) {
        // Get the Twitter username from the URL
        const url = new URL(item.uris.twitter);
        const twitterUsername = url.pathname.replace("/", "").toLowerCase();

        const twitterLink = document.createElement("a");
        twitterLink.href = item.uris.twitter;
        twitterLink.target = "_blank";
        twitterLink.rel = "noopener noreferrer";
        twitterLink.title = "Visit Twitter profile.";

        const twitterSpan = document.createElement("span");
        twitterSpan.innerText = "@" + twitterUsername + " ";
        twitterLink.appendChild(twitterSpan);

        const twitterIcon = document.createElement("i");
        twitterIcon.className = "fab fa-twitter";
        twitterLink.appendChild(twitterIcon);

        twitterCell.appendChild(twitterLink);
      } else {
        const xIcon = document.createElement("i");
        xIcon.className = "fa-solid fa-x";
        xIcon.style.cursor = "pointer";
        xIcon.title = "No Twtter";
        twitterCell.appendChild(xIcon);
      }
      row.appendChild(twitterCell);

      // Add the row to the container
      container.appendChild(row);
    });
  })
  .catch((e) => {
    console.log("Error: " + e);
  });
