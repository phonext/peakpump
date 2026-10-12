import type { CandleInterval, CandleRow } from "@/lib/graphql";

// The four intervals the indexer aggregates (packages/indexer/src/candles.ts). The
// seconds are restated here rather than imported, because the indexer is an Envio
// project whose entrypoint is generated and the web app does not depend on it. The
// Record is exhaustive over the closed CandleInterval union, so a fifth interval
// would be a type error here before it was ever a chart bug.
const INTERVAL_SECONDS: Record<CandleInterval, bigint> = {
  "1m": 60n,
  "5m": 300n,
  "1h": 3600n,
  "1d": 86400n,
};

// SPEC 6.3: a bucket with no trade does not exist, and the client draws the flat
// carry-forward rather than the indexer interpolating one. An empty bucket becomes
// a doji at the close of the last bucket that did trade — the price a holder would
// have seen, held through the silence — with no volume and no trades to its name.
//
// The range is the first real candle through the last and never a calendar period:
// nothing is drawn before the market's first trade, so a market three days old on
// the daily interval does not open with a week of flat candles at a price that
// never existed. Rows arrive ascending from lib/graphql.ts, which reverses the
// descending fetch, and bucketStart is a multiple of the interval because the
// indexer floors a trade timestamp to it, so the walk stays on the same grid.
export function fillCandleGaps(
  rows: readonly CandleRow[],
  interval: CandleInterval,
  limit: number,
): CandleRow[] {
  if (rows.length === 0) return [];

  const step = INTERVAL_SECONDS[interval];

  // Walked newest first, because the limit binds on a market whose traded buckets
  // are spread thinner than it allows, and the points worth keeping then are the
  // recent ones — the same choice the descending fetch made when it kept the
  // newest buckets and dropped the older ones. The reverse is a copy of at most
  // the limit's worth of rows, and the one at the end undoes it.
  const descending = [...rows].reverse();
  // Narrowed here rather than at every read below: noUncheckedIndexedAccess types
  // the head optional even after the empty check above.
  const latest = descending[0];
  if (latest === undefined) return [];

  const filled: CandleRow[] = [latest];
  let previous: CandleRow = latest;

  for (const earlier of descending.slice(1)) {
    for (let t = previous.bucketStart - step; t > earlier.bucketStart; t -= step) {
      if (filled.length >= limit) break;
      filled.push(carryForward(t, earlier.close));
    }
    if (filled.length >= limit) break;
    filled.push(earlier);
    previous = earlier;
  }

  return filled.reverse();
}

function carryForward(bucketStart: bigint, close: bigint): CandleRow {
  return { bucketStart, open: close, high: close, low: close, close, volume6: 0n, tradeCount: 0 };
}
