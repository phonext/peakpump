import { describe, expect, it } from "vitest";

import { fillCandleGaps } from "@/components/chart/candle-fill";
import type { CandleRow, CandleInterval } from "@/lib/graphql";

// A base bucket on a minute boundary, so the arithmetic the indexer performs —
// flooring a trade timestamp to the interval — is mirrored by the fixtures below.
const BASE = 1_771_000_320n;
const MINUTE = 60n;

function candle(bucketStart: bigint, close: bigint, tradeCount = 1): CandleRow {
  return { bucketStart, open: close, high: close, low: close, close, volume6: 1_000_000n, tradeCount };
}

// The close carried across a gap is the one that preceded it, never the one that
// followed: the price during the silence is the last one anyone paid.
const FIRST = 1_000_000_000_000_000_000n;
const SECOND = 2_000_000_000_000_000_000n;

describe("the candle carry-forward", () => {
  it("returns nothing when there are no candles", () => {
    expect(fillCandleGaps([], "1m", 300)).toEqual([]);
  });

  it("returns a single candle untouched, with nothing drawn before it", () => {
    const rows = [candle(BASE, FIRST)];
    expect(fillCandleGaps(rows, "1m", 300)).toEqual(rows);
  });

  it("leaves a contiguous series unchanged", () => {
    const rows = [candle(BASE, FIRST), candle(BASE + MINUTE, SECOND), candle(BASE + 2n * MINUTE, FIRST)];
    expect(fillCandleGaps(rows, "1m", 300)).toEqual(rows);
  });

  it("fills an empty bucket with a flat candle at the close that preceded it", () => {
    const rows = [candle(BASE, FIRST), candle(BASE + 2n * MINUTE, SECOND)];

    const filled = fillCandleGaps(rows, "1m", 300);

    expect(filled).toHaveLength(3);
    expect(filled[1]).toEqual({
      bucketStart: BASE + MINUTE,
      open: FIRST,
      high: FIRST,
      low: FIRST,
      close: FIRST,
      // A bucket with no trade has no volume to report, so it is not a trade in
      // disguise: the candle is a drawing of the price, not a record of activity.
      volume6: 0n,
      tradeCount: 0,
    });
  });

  it("fills every empty bucket between two trades, one candle per interval", () => {
    const rows = [candle(BASE, FIRST), candle(BASE + 5n * MINUTE, SECOND)];

    const filled = fillCandleGaps(rows, "1m", 300);

    expect(filled).toHaveLength(6);
    expect(filled.map((c) => c.bucketStart)).toEqual([
      BASE,
      BASE + MINUTE,
      BASE + 2n * MINUTE,
      BASE + 3n * MINUTE,
      BASE + 4n * MINUTE,
      BASE + 5n * MINUTE,
    ]);
  });

  it("starts at the first candle and never the start of a calendar period", () => {
    // The daily interval, and a first bucket that is not the start of a week or a
    // month. Backfilling to a calendar boundary would draw days of flat price
    // before the market existed; the carry-forward begins where trading did.
    const day = 86_400n;
    const first = BASE - (BASE % day) + 3n * day;
    const rows = [candle(first, FIRST), candle(first + 2n * day, SECOND)];

    const filled = fillCandleGaps(rows, "1d", 300);

    expect(filled).toHaveLength(3);
    expect(filled.at(0)!.bucketStart).toBe(first);
    expect(filled.at(-1)!.bucketStart).toBe(first + 2n * day);
  });

  it("steps by the interval and not by the minute", () => {
    // Five minutes between two hourly buckets is one empty bucket, not five.
    const hour = 3_600n;
    const first = BASE - (BASE % hour);
    const rows = [candle(first, FIRST), candle(first + 2n * hour, SECOND)];

    const filled = fillCandleGaps(rows, "1h", 300);

    expect(filled).toHaveLength(3);
    expect(filled.at(1)!.bucketStart).toBe(first + hour);
  });

  it("carries the earlier close across a gap and not the later one", () => {
    const rows = [candle(BASE, FIRST), candle(BASE + 3n * MINUTE, SECOND)];

    const filled = fillCandleGaps(rows, "1m", 300);

    expect(filled.at(1)!.close).toBe(FIRST);
    expect(filled.at(2)!.close).toBe(FIRST);
  });

  it("keeps the most recent buckets when the fill would exceed the limit", () => {
    // A minute between the first trade and the last, and a limit of three points:
    // the six months of silence in between cannot all be drawn, so the three the
    // frame keeps are the newest ones.
    const far = BASE + 100n * MINUTE;
    const rows = [candle(BASE, FIRST), candle(far, SECOND)];

    const filled = fillCandleGaps(rows, "1m", 3);

    expect(filled).toHaveLength(3);
    expect(filled.at(-1)!.bucketStart).toBe(far);
    expect(filled.at(-1)!.close).toBe(SECOND);
    expect(filled.at(0)!.bucketStart).toBe(far - 2n * MINUTE);
  });

  it("fills every interval the chart offers", () => {
    for (const interval of ["1m", "5m", "1h", "1d"] as const) {
      const step = { "1m": 60n, "5m": 300n, "1h": 3_600n, "1d": 86_400n }[interval];
      const first = BASE - (BASE % step);
      const rows = [candle(first, FIRST), candle(first + 3n * step, SECOND)];

      const filled = fillCandleGaps(rows, interval, 300);

      expect(filled, interval).toHaveLength(4);
      expect(filled.map((c) => c.close), interval).toEqual([FIRST, FIRST, FIRST, SECOND]);
    }
  });

  it("treats the limit as a maximum and not a target", () => {
    const interval: CandleInterval = "1m";
    const rows = [candle(BASE, FIRST), candle(BASE + MINUTE, SECOND)];

    expect(fillCandleGaps(rows, interval, 1)).toHaveLength(1);
  });
});
