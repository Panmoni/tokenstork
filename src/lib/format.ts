// Presentation helpers — 1:1 port of app/utils/presentationUtils.ts.

export function getIPFSUrl(iconUrl: string): string {
	const ipfsGateway = 'https://ipfs.io/ipfs/';
	const extendedIpfsPattern =
		/https:\/\/[a-zA-Z0-9]+\.(ipfs\.nftstorage\.link)\/.+/;
	if (extendedIpfsPattern.test(iconUrl)) {
		return iconUrl;
	}
	const ipfsPatterns = [
		{
			pattern: /https:\/\/(.+)\.ipfs\.nftstorage\.link\//,
			replace: (cid: string) => `${ipfsGateway}${cid}`
		},
		{
			pattern: /ipfs:\/\/(.+)/,
			replace: (cid: string) => `${ipfsGateway}${cid}`
		}
	];

	for (const { pattern, replace } of ipfsPatterns) {
		const match = iconUrl.match(pattern);
		if (match && match[1]) {
			return replace(match[1]);
		}
	}

	return iconUrl;
}

export function satoshisToBCH(sats: number): number {
	return sats / 100_000_000;
}

export function humanizeBigNumber(value: number): string {
	if (isNaN(value)) {
		throw new Error('Input must be a number');
	}
	const units = ['', 'K', 'M', 'B', 'T', 'P', 'E'];
	if (value < 1000) return value.toString();

	const unitIndex = Math.floor(Math.log(value) / Math.log(1000));
	let numStr = (value / Math.pow(1000, unitIndex)).toFixed(2);
	numStr = parseFloat(numStr).toString();
	return `${numStr}${units[unitIndex]}`;
}

export function formatMarketCap(marketCap: string): string {
	if (marketCap === 'N/A' || marketCap === '0') {
		return '-';
	}
	const numericValue = parseFloat(marketCap);
	if (numericValue >= 1_000_000) {
		return `$${humanizeBigNumber(numericValue)}`;
	} else if (numericValue >= 1) {
		return `$${numericValue.toLocaleString('en-US', {
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		})}`;
	} else {
		return `$${numericValue.toFixed(2)}`;
	}
}
