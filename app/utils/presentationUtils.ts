export function satoshisToBCH(sats: number) {
  return sats / 100000000;
}

export function humanizeBigNumber(num: number): string {
  var units = [
    "",
    "thousand",
    "million",
    "billion",
    "trillion",
    "quadrillion",
    "quintillion",
  ];

  // If number is less than 10000, return it as it is
  if (num < 10000) {
    return num.toString();
  }

  // Make sure the number is positive and get its logarithm
  var magnitude = Math.log10(Math.abs(num));

  // Determine the unit to use
  var unitIndex = Math.min(Math.floor(magnitude / 3), units.length - 1);

  // Get the number in terms of that unit
  var normalizedNum = num / Math.pow(10, unitIndex * 3);

  // If decimal part is zero, return integer part only
  if (normalizedNum % 1 === 0) {
    return normalizedNum.toFixed(0) + " " + units[unitIndex];
  }

  // Round to one decimal place and add the unit
  return normalizedNum.toFixed(1) + " " + units[unitIndex];
}
