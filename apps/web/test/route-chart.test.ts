import { describe, expect, it } from "vitest";

import { ascentScale, frameOf, place, routePaths } from "@/components/chart/route-frame";
import type { MarketParams } from "@/lib/curve-params";

// The market that reported the crash: 0x9B1E…1E1A, read live while this test was written.
// _summit() has run, so x0 is the 0n the chain answers with past the Summit and the
// raised6 figure is the one the crossing froze. y0, y1, Ts and S are the creation values.
const PEAK: MarketParams = {
  token: "0x0000000000000000000000000000000000000001",
  creator: "0x0000000000000000000000000000000000000002",
  S: 1_000_000_000_000_000_000_000_000_000n,
  Ts: 800_000_000_000_000_000_000_000_000n,
  x0: 0n,
  y0: 1_066_666_666_666_666_666_666_666_666n,
  y1: 266_666_666_666_666_666_666_666_666n,
  name: "",
  symbol: "",
  totalSupply: 0n,
};

const RAISED6 = 1_000_000_003n;

// The x0 this market was created with: ceil(R / (r - 1)) at R = 1000 USDC and r = 4. The
// reconstruction lands on it exactly here; where it does not, raised6's own single-buy
// rounding leaves it within a unit.
const ASCENT_X0 = 333_333_334n;

describe("the route chart past the Summit", () => {
  it("takes the scale from the stored x0 while the market is still climbing", () => {
    const ascending: MarketParams = { ...PEAK, x0: ASCENT_X0 };
    expect(ascentScale(ascending, undefined)).toBe(ASCENT_X0);
  });

  it("waits for the live read when the stored x0 is gone and no raise has landed", () => {
    expect(ascentScale(PEAK, undefined)).toBeUndefined();
  });

  it("recovers the ascent scale from the raise the crossing froze", () => {
    // MATH [1] with r - 1 = Ts / y1, which follows from [2] and y1 = y0 - Ts.
    expect(ascentScale(PEAK, RAISED6)).toBe(ASCENT_X0);
  });

  it("draws a frame whose span is not zero", () => {
    const frame = frameOf(PEAK, ascentScale(PEAK, RAISED6) as bigint);
    expect(frame.low).toBeGreaterThan(0n);
    expect(frame.high).toBeGreaterThan(frame.low);
  });

  it("places every sample of the route without dividing by the span", () => {
    // The crash: x0 read 0n past the Summit, both ends of the frame came back 0n, and
    // place divided by their difference. This loop is the one routePaths runs, and a
    // BigInt division by zero would throw rather than fail an assertion below.
    const scale = ascentScale(PEAK, RAISED6) as bigint;
    const frame = frameOf(PEAK, scale);
    const paths = routePaths(PEAK, scale, frame);

    expect(paths.line.startsWith("M")).toBe(true);
    const points = paths.line.slice(1).split("L");
    expect(points).toHaveLength(65);

    // Every coordinate is inside the box the viewBox declares, which is what makes the
    // recovery a drawing rather than a value that merely does not throw.
    for (const point of points) {
      const [left, top] = point.split(",");
      expect(Number(left)).toBeGreaterThanOrEqual(0);
      expect(Number(left)).toBeLessThanOrEqual(100);
      expect(Number(top)).toBeGreaterThanOrEqual(0);
      expect(Number(top)).toBeLessThanOrEqual(100);
    }

    // The span the recovered scale buys is the one the immutable ratio says it is:
    // high / low is r^2 (MATH [4]), which is y0^2 over y1^2 here, to within the
    // integer rounding the chain floors every division with.
    const ratio = frame.high / frame.low;
    expect(ratio).toBeGreaterThanOrEqual(15n);
    expect(ratio).toBeLessThanOrEqual(17n);
  });

  it("clamps a value outside the frame rather than leaving it to the caller", () => {
    expect(place(0n, 100n, 200n)).toBe(0);
    expect(place(1_000n, 100n, 200n)).toBe(100);
    expect(place(150n, 100n, 200n)).toBe(50);
  });
});
