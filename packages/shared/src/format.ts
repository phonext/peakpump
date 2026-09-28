// Display formatting. Every numeric argument is a bigint; Number() is never
// applied to a chain value anywhere in this file. All rendering is done with
// bigint arithmetic and string assembly so a value can never lose precision on
// the way to the screen.

const USDC_WEI_PER_MICRO = 1_000_000_000_000n; // 1e12; usdcIn6 = wei / 1e12

// Renders a fixed-point bigint with `decimals` implied fractional digits as a
// grouped decimal string. maxFrac, when given, caps the fractional digits shown
// (it never rounds — it truncates, matching the floor semantics used on chain).
function formatFixed(value: bigint, decimals: number, maxFrac?: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const intPart = abs / scale;
  let fracPart = (abs % scale).toString().padStart(decimals, "0");
  if (maxFrac !== undefined && maxFrac < decimals) {
    fracPart = fracPart.slice(0, maxFrac);
  }
  fracPart = fracPart.replace(/0+$/, "");
  const grouped = intPart.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = negative ? "-" : "";
  return fracPart.length > 0 ? `${sign}${grouped}.${fracPart}` : `${sign}${grouped}`;
}

// 6-decimal USDC (the ERC-20 view / quote units).
export function formatUsdc6(amount6: bigint): string {
  return formatFixed(amount6, 6);
}

// 18-decimal native USDC (msg.value units). Capped at 6 fractional digits for
// display; sub-1e12 wei is dust the contract handles, not a display concern.
export function formatUsdcWei(amountWei: bigint): string {
  return formatFixed(amountWei, 18, 6);
}

// 18-decimal token wei.
export function formatTokenAmount(amountWei: bigint): string {
  return formatFixed(amountWei, 18, 4);
}

// A price from priceX18() is USDC-per-whole-token scaled by 1e18. Plain fixed
// decimal, full precision, trailing zeros trimmed (Ridge -> "0.00000375").
export function formatPriceX18(priceX18: bigint): string {
  return formatFixed(priceX18, 18);
}

// 6-decimal USDC market cap, e.g. 15_000_000_000n -> "$15,000".
export function formatMarketCap(marketCap6: bigint): string {
  return `$${formatFixed(marketCap6, 6, 2)}`;
}

// Basis points (0..10000) to a percentage string, e.g. 4210n -> "42.1%".
export function formatPercent(bps: bigint): string {
  return `${formatFixed(bps, 2, 1)}%`;
}

// 0x-prefixed address to a short form, e.g. "0xfEe1…7a1e".
export function formatAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// Relative age from two bigint second-timestamps. Never orders by, and never
// coerces, a raw chain timestamp; it only differences two values.
export function formatTimeAgo(timestampSec: bigint, nowSec: bigint): string {
  let diff = nowSec - timestampSec;
  if (diff < 0n) diff = 0n;
  if (diff < 60n) return `${diff}s ago`;
  if (diff < 3_600n) return `${diff / 60n}m ago`;
  if (diff < 86_400n) return `${diff / 3_600n}h ago`;
  return `${diff / 86_400n}d ago`;
}

// Gas cost estimate in native USDC, from gas units and a maxFeePerGas in wei.
export function estimateGasUsdc(gasUnits: bigint, maxFeePerGas: bigint): string {
  return formatUsdcWei(gasUnits * maxFeePerGas);
}

// Floors a native-USDC wei value to whole 6-decimal micro-USDC. The Max button
// uses this so the amount shown and the amount sent agree to 6 decimals.
export function toMicroFloor(weiValue: bigint): bigint {
  return weiValue / USDC_WEI_PER_MICRO;
}
