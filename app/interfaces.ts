// types.ts

export interface TokenData {
  uris: Record<string, string>;
  token: {
    decimals: number;
    category: string;
    symbol: string;
  };
  maxSupply: string;
  // Add other properties as needed
}

