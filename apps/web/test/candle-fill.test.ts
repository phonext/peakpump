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

  it("never evicts a real candle for a fill", () => {
    // A hundred minutes between the first trade and the last, and a limit of three
    // points. The silence cannot be drawn in full and neither can it buy the space
    // the two real candles take: both survive, and the three points the frame holds
    // are both trades plus the one bucket of flat price the budget had left.
    const far = BASE + 100n * MINUTE;
    const rows = [candle(BASE, FIRST), candle(far, SECOND)];

    const filled = fillCandleGaps(rows, "1m", 3);

    expect(filled).toHaveLength(3);
    expect(filled.map((c) => c.bucketStart)).toEqual([BASE, BASE + MINUTE, far]);
    // The one fill the budget allowed is the bucket after the earlier trade, at the
    // price that trade left behind, and not a point drawn at the far candle's price.
    expect(filled.at(1)!.close).toBe(FIRST);
  });

  it("caps the fill of a single gap at eight buckets", () => {
    // The shape the deployed chart rendered wrong: two trades, days apart, whose
    // gap once consumed the whole 300-point budget and left nothing but flat price.
    // The cap bounds the flat stretch to eight buckets wherever it is spent.
    const far = BASE + 100n * MINUTE;
    const rows = [candle(BASE, FIRST), candle(far, SECOND)];

    const filled = fillCandleGaps(rows, "1m", 300);

    expect(filled).toHaveLength(10);
    // Eight flat buckets off the earlier trade, then the far one, and no more.
    expect(filled.map((c) => c.bucketStart)).toEqual([
      BASE,
      ...Array.from({ length: 8 }, (_, i) => BASE + BigInt(i + 1) * MINUTE),
      far,
    ]);
    expect(filled.at(-1)!.close).toBe(SECOND);
  });

  it("keeps every real candle when the limit is smaller than the series", () => {
    // The reserve is unconditional, so a limit below the candle count shortens the
    // fill to nothing rather than dropping a trade. The frame may hold more points
    // than the limit asked for, but never fewer real candles than the market has.
    const rows = [candle(BASE, FIRST), candle(BASE + MINUTE, SECOND), candle(BASE + 2n * MINUTE, FIRST)];

    expect(fillCandleGaps(rows, "1m", 1)).toEqual(rows);
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

  it("spends the leftover budget on the newest gap first", () => {
    // Three trades and two long silences, and a budget that cannot cap both. The
    // recent gap is the one a holder reads against the price the panel shows, so
    // it is filled and the older one is left as the gap the axis simply skips.
    const mid = BASE + 100n * MINUTE;
    const far = BASE + 200n * MINUTE;
    const rows = [candle(BASE, FIRST), candle(mid, SECOND), candle(far, FIRST)];

    // Five points of budget after the three real candles: the newest gap takes
    // all five and the older one takes none.
    const filled = fillCandleGaps(rows, "1m", 8);

    expect(filled).toHaveLength(8);
    expect(filled.map((c) => c.bucketStart)).toEqual([
      BASE,
      mid,
      ...Array.from({ length: 5 }, (_, i) => mid + BigInt(i + 1) * MINUTE),
      far,
    ]);
  });

  it("honours an explicit per-gap cap", () => {
    const far = BASE + 100n * MINUTE;
    const rows = [candle(BASE, FIRST), candle(far, SECOND)];

    const filled = fillCandleGaps(rows, "1m", 300, 2);

    expect(filled).toHaveLength(4);
    expect(filled.map((c) => c.bucketStart)).toEqual([BASE, BASE + MINUTE, BASE + 2n * MINUTE, far]);
  });

  it("never draws a fill outside the real candles' own range", () => {
    // The reserve does not widen the range: the first point is the first trade and
    // the last is the last, and the fill only ever appears between two real ones.
    const far = BASE + 100n * MINUTE;
    const rows = [candle(BASE, FIRST), candle(far, SECOND)];

    const filled = fillCandleGaps(rows, "1m", 300);

    expect(filled.at(0)!.bucketStart).toBe(BASE);
    expect(filled.at(-1)!.bucketStart).toBe(far);
  });
});
