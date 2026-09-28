// Four candle intervals and no fifth; the web client's
// CandleInterval union is closed over exactly these ids.
export const CANDLE_INTERVALS = [
  { id: "1m", seconds: 60n },
  { id: "5m", seconds: 300n },
  { id: "1h", seconds: 3600n },
  { id: "1d", seconds: 86400n },
] as const;

// A bucket boundary is arithmetic, never an ordering: Arc timestamps are
// non-decreasing only, so nothing in this package sorts on one.
export function bucketStart(timestampSeconds: bigint, intervalSeconds: bigint): bigint {
  return (timestampSeconds / intervalSeconds) * intervalSeconds;
}

// MATH [9], the only price unit this codebase has:
// priceX18 = floor(x * 1e30 / y). x is the 6-decimal USDC reserve the Trade
// event reports; y follows MATH section 4 from the phase after the trade.
// The contract cannot emit a Trade with y == 0 (buying the whole supply takes
// unbounded USDC), so there is no divide-by-zero case to handle.
export function priceAfterTrade(x6: bigint, y: bigint): bigint {
  return (x6 * 10n ** 30n) / y;
}
