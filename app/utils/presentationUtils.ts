// app/utils/presentationUtils.ts

export function satoshisToBCH(sats: number) {
  return sats / 100000000;
}

export function humanizeBigNumber(value: number): string {
  if (isNaN(value)) {
    throw new Error("Input must be a number");
  }
  const units = ["", "K", "M", "B", "T", "P", "E"];
  if (value < 1000) return value.toString(); // less than 1000, no need for a unit

  // Calculate the index of the unit
  let unitIndex = Math.floor(Math.log(value) / Math.log(1000));
  // Calculate the humanized number
  let numStr = (value / Math.pow(1000, unitIndex)).toFixed(2);
  // If the number is a whole number, remove unnecessary decimal places
  numStr = parseFloat(numStr).toString();
  // Append the unit and return
  return `${numStr}${units[unitIndex]}`;
}

export function formatMarketCap(marketCap: string): string {
  if (marketCap === "N/A" || marketCap === "0") {
    return "N/A";
  }

  const numericValue = parseFloat(marketCap);

  if (numericValue >= 1000000) {
    // Humanize if over 1,000,000
    return `$${humanizeBigNumber(numericValue)}`;
  } else if (numericValue >= 1) {
    // Format as currency if 1 or more
    return `$${numericValue.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;
  } else {
    // If less than 1, show as is with two decimal places
    return `$${numericValue.toFixed(2)}`;
  }
}
