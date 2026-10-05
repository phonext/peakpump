import { priceX18 } from "@peakpump/shared/curve";

import type { MarketParams } from "@/lib/curve-params";

// The route to the Summit is pure geometry: a price against tokens sold, built from the
// stored market constants and nothing else. It lives outside the component for the same
// reason components/layout/attribution-year.ts does — a test beside it can assert against
// it without a JSX transform, and the transform this project pins sets jsx to preserve,
// which vitest cannot parse.

// Sixty-five points across the domain, which is finer than the pixels a 280px frame has
// for a curve that is smooth and monotone over the whole of it.
export const SAMPLES = 64;

// The reserve at any point on the route, from the invariant rather than from a formula of
// this file's own: MATH [3] conserves k = x*y across every ASCENT trade, so x is x0*y0
// over the supply that is left. Floored, like every division on chain.
//
// x0 is the frame's scale and not params.x0: _summit() zeroes that field at the Summit
// and never restores it (Curve.sol:396), so a market loaded past the crossing reads 0n
// and every ASCENT figure derived from it collapses to zero. ascentScale is where the
// scale comes from instead.
export function reserveAt(params: MarketParams, x0: bigint, y: bigint): bigint {
  return (x0 * params.y0) / y;
}

// A position inside the box, in percent. The ratio is taken in basis points so the only
// value ever coerced to a float is an integer below ten thousand and one and never a
// chain figure; a hundredth of a percent is a third of a pixel at this frame's height.
// Both ends are clamped because the pool's rounding runs in its own favour, which can put
// the live price a unit or two above the sampled route, and a marker outside the box
// would sit in the panel's padding.
export function place(value: bigint, low: bigint, high: bigint): number {
  const bps = ((value - low) * 10_000n) / (high - low);
  return Number(bps < 0n ? 0n : bps > 10_000n ? 10_000n : bps) / 100;
}

// The two ends of the route are the two ends of the frame, so the curve touches all four
// sides and no axis needs a scale printed down it. The top is the price the contract will
// hold at the Summit — y1 as stored, with its own reserve — rather than an interpolation
// towards it.
export interface Frame {
  Ts: bigint;
  low: bigint;
  high: bigint;
}

// The ASCENT scale the frame is drawn with, or undefined while it is not yet known. The
// climb's shape is y0, y1 and Ts, which never change; every price along it is x0 times a
// function of those, so x0 cancels in every ratio place takes and only the absolute
// figures need it. While the market is still climbing that is the stored field.
//
// Past the Summit there is no stored field: _summit() zeroes x0 and never restores it
// (Curve.sol:396), so the chain answers 0n and the frame's two ends — and with them
// place's denominator — both come back zero. The one figure that still carries the ASCENT
// scale is the raise the crossing froze, because usdcRaised6() returns raised6 in PEAK
// (Curve.sol:465) and raised6 is x - x0 at the moment of the Summit. MATH [1] with
// r - 1 = Ts / y1, which follows from [2] and y1 = y0 - Ts, turns that into a scale:
// x0 = R * y1 / Ts. The residual is raised6's own single-buy rounding, under one unit of
// USDC in x0.
//
// raised6 is undefined while the live read is in flight, which is the one state the
// returned undefined stands for: the contract floors the raise at R6_MIN on creation, so
// a market that has crossed already had a scale to lose.
export function ascentScale(
  params: MarketParams | undefined,
  raised6: bigint | undefined,
): bigint | undefined {
  if (params === undefined) return undefined;
  if (params.x0 !== 0n) return params.x0;
  if (raised6 === undefined || raised6 === 0n) return undefined;
  return (raised6 * params.y1) / params.Ts;
}

export function frameOf(params: MarketParams, x0: bigint): Frame {
  return {
    Ts: params.Ts,
    low: priceX18(x0, params.y0),
    high: priceX18(reserveAt(params, x0, params.y1), params.y1),
  };
}

// One pass, two paths: the line and the fill under it. The viewBox is 100 by 100 and the
// SVG stretches it to the box, which is what lets these coordinates and the CSS
// percentages the markers are positioned with be the same numbers.
export function routePaths(
  params: MarketParams,
  x0: bigint,
  frame: Frame,
): { line: string; area: string } {
  const points: string[] = [];
  for (let i = 0; i <= SAMPLES; i += 1) {
    const sold = (frame.Ts * BigInt(i)) / BigInt(SAMPLES);
    const y = params.y0 - sold;
    const price = priceX18(reserveAt(params, x0, y), y);
    const left = place(sold, 0n, frame.Ts).toFixed(2);
    const top = (100 - place(price, frame.low, frame.high)).toFixed(2);
    points.push(`${left},${top}`);
  }
  const line = `M${points.join("L")}`;
  return { line, area: `${line}L100,100L0,100Z` };
}
