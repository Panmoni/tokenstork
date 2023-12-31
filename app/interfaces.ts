// app/interfaces.ts

// TODO: ideally key: string should not be any type. Fix this.

export interface TokenData {
  [key: string]: any;
  icon: string;
  name: string;
  description: string;
  symbol: string;
  price: number;
  circulatingSupply: string;
  circulatingSupplyBigInt: bigint;
  maxSupply: string;
  maxSupplyBigInt: bigint;
  marketCap: string;
  marketCapBigInt: bigint;
  tvl: number;
  category: string;
}
