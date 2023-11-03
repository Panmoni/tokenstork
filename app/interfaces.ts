export interface TokenData {
  uris: Record<string, string>;
  token: {
    decimals: number;
    category: string;
    symbol: string;
  };
  maxSupply: string;
}
