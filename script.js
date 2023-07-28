'use strict';

const tokenIds = ['482d555258d3be69fef6ffcd0e5eeb23c4aaacec572b25ab1c21897600c45887', '8473d94f604de351cdee3030f6c354d36b257861ad8e95bbc0a06fbab2a2f9cf', 'de980d12e49999f1dbc8d61a8f119328f7be9fb1c308eafe979bf10abb17200d', 'b69f76548653033603cdcb81299e3c1d1f3d61ad66e7ba0e6569b493605b4cbe', '8bc2ebc1547257265ece8381f3ed6aa573c5aa8a23e0f552dc7128bb8a8e6f0f', '36546e4062a1cfd070a4a8d8ff9db18aae4ddf8d9ac9a4fa789314d108b49797'];

// This function fetches data for a single token id.
async function fetchDataForTokenId(tokenId) {
  const response = await fetch(`https://bcmr.paytaca.com/api/tokens/${tokenId}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  } else {
    return await response.json();
  }
}

// This function fetches data for all token ids and stores the results.
async function fetchDataForAllTokenIds() {
  const promises = tokenIds.map(fetchDataForTokenId);
  const results = await Promise.allSettled(promises);
  return results.filter(result => result.status === 'fulfilled').map(result => result.value);
}

// Fetch data and display it in the HTML page.
fetchDataForAllTokenIds().then(data => {
	
	console.log(data);
	
    const container = document.getElementById('container');

    // Create a new div for each row
    data.forEach(item => {
        const row = document.createElement('div');
        row.className = 'row';

        // Create and append the icon
        const iconCell = document.createElement('div');
        iconCell.className = 'cell';
        const iconImg = document.createElement('img');
        iconImg.src = item.uris.icon;
		iconImg.width = 64;
		iconImg.height = 64;
        iconCell.appendChild(iconImg);
        row.appendChild(iconCell);

        // Create and append the symbol
        const symbolCell = document.createElement('div');
        symbolCell.className = 'cell';
        symbolCell.innerText = item.token.symbol;
        row.appendChild(symbolCell);

        // Create and append the name
        const nameCell = document.createElement('div');
        nameCell.className = 'cell';
        nameCell.innerText = item.name;
        row.appendChild(nameCell);

		if (item.uris && item.uris.web) {
		            const webCell = document.createElement('div');
		            webCell.className = 'cell';
		            const webLink = document.createElement('a');
		            webLink.href = item.uris.web;
		            webLink.innerText = item.uris.web.replace('https://', '').replace(/\/$/, '');
		            webCell.appendChild(webLink);
		            row.appendChild(webCell);
		        }

        // Add the row to the container
        container.appendChild(row);
    });
}).catch(e => {
    console.log('Error: ' + e);
});