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
//
// A carry-forward is only legible while it cannot crowd the real candles off the
// frame. The limit is therefore spent on the real candles first and the fill draws
// on what is left, and no single gap may take more than perGapCap points of it:
// eight buckets of flat price reads as a pause, where a week of it reads as the
// market's whole history and evicts the two trades that history consists of.
export function fillCandleGaps(
  rows: readonly CandleRow[],
  interval: CandleInterval,
  limit: number,
  perGapCap = 8,
): CandleRow[] {
  if (rows.length === 0) return [];

  const step = INTERVAL_SECONDS[interval];

  // The real candles are the history and are never evicted for a fill, so a market
  // whose trading is one burst and one later trade keeps both bursts rather than
  // trading them for the silence in between.
  const filled: CandleRow[] = [...rows];
  let remaining = Math.max(0, limit - rows.length);

  // Gaps in descending time, so a budget that runs out runs out on the oldest
  // silence: the recent flat stretch is the one a holder reads against the price
  // the panel shows, and it is filled before the older one is.
  const descending = [...rows].reverse();
  const gaps: Array<{ earlier: CandleRow; later: CandleRow }> = [];
  let previous: CandleRow | undefined;
  for (const row of descending) {
    if (previous !== undefined) gaps.push({ earlier: row, later: previous });
    previous = row;
  }

  for (const { earlier, later } of gaps) {
    if (remaining === 0) break;
    // The buckets strictly between the two, which is the count of steps minus the
    // two ends. bucketStart is unique per (token, interval) and interval-aligned,
    // so this is the count of candles to draw and never a negative one.
    const wanted = (later.bucketStart - earlier.bucketStart) / step - 1n;
    const count = Number(fewest(wanted, BigInt(perGapCap), BigInt(remaining)));
    for (let k = 1n; k <= count; k++) {
      filled.push(carryForward(earlier.bucketStart + k * step, earlier.close));
    }
    remaining -= count;
  }

  return filled.sort((a, b) =>
    a.bucketStart > b.bucketStart ? 1 : a.bucketStart < b.bucketStart ? -1 : 0,
  );
}

function fewest(...values: readonly bigint[]): bigint {
  return values.reduce((lowest, value) => (value < lowest ? value : lowest));
}

function carryForward(bucketStart: bigint, close: bigint): CandleRow {
  return { bucketStart, open: close, high: close, low: close, close, volume6: 0n, tradeCount: 0 };
}
