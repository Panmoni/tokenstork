export interface TokenData {
  uris: Record<string, string>;
  token: {
    decimals: number;
    category: string;
    symbol: string;
  };
  maxSupply: string;
}

//TODO: remove this or merge it with similar data in page.tsx
