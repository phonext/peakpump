// Independent BigInt reference for docs/MATH.md, derived from the formulas — NOT
// ported from CurveMath.sol. It exists so a shared mistake cannot hide in both
// implementations; the differential fixture proves they agree. Units follow
// MATH 0: 6-decimal USDC, 18-decimal token wei, 18-decimal fixed-point r.

export const WAD = 1_000_000_000_000_000_000n; // 1e18
export const PRICE_SCALE = 1_000_000_000_000_000_000_000_000_000_000n; // 1e30
export const BPS_DENOM = 10_000n;

export const S_MIN = 1_000_000_000_000_000_000_000_000n; // 1e24
export const S_MAX = 1_000_000_000_000_000_000_000_000_000_000n; // 1e30
export const R6_MIN = 1_000_000_000n; // 1e9
export const R6_MAX = 10_000_000_000_000n; // 1e13
export const R_MIN = 2_000_000_000_000_000_000n; // 2e18
export const R_MAX = 20_000_000_000_000_000_000n; // 20e18

// Integer division rounds toward zero in JS BigInt; for non-negative operands
// that is floor. Ceil of a*b/d is (a*b + d - 1) / d for d > 0.
function floorDiv(n: bigint, d: bigint): bigint {
  return n / d;
}
function mulDivFloor(a: bigint, b: bigint, d: bigint): bigint {
  return floorDiv(a * b, d);
}
function mulDivCeil(a: bigint, b: bigint, d: bigint): bigint {
  return floorDiv(a * b + d - 1n, d);
}

export interface DerivedParams {
  Ts: bigint;
  Tl: bigint;
  y0: bigint;
  x0: bigint;
  y1: bigint;
  Reff6: bigint;
}
export interface BuyQuote {
  tokensOut: bigint;
  fee6: bigint;
  net6: bigint;
}
export interface SellQuote {
  usdcOut6: bigint;
  fee6: bigint;
  gross6: bigint;
}
export interface CrossingQuote {
  netNeeded6: bigint;
  feeUsed6: bigint;
  spend6: bigint;
}

// MATH 3. Mirrors the named reverts so the generator never emits an
// out-of-range case as if it were legal.
export function deriveParams(S: bigint, R6: bigint, rX18: bigint): DerivedParams {
  if (S < S_MIN || S > S_MAX) throw new Error("SupplyOutOfRange");
  if (R6 < R6_MIN || R6 > R6_MAX) throw new Error("RaiseOutOfRange");
  if (rX18 < R_MIN || rX18 > R_MAX) throw new Error("MultipleOutOfRange");

  const Ts = mulDivFloor(S, rX18, rX18 + WAD);
  if (S <= Ts) throw new Error("SupplyNotAboveTs");
  const Tl = S - Ts;

  const y0 = mulDivFloor(Ts, rX18, rX18 - WAD);
  if (y0 <= Ts) throw new Error("Y0NotAboveTs");
  const y1 = y0 - Ts;
  if (y1 === 0n) throw new Error("Y1NotPositive");

  const x0 = mulDivCeil(R6, WAD, rX18 - WAD);
  if (x0 === 0n) throw new Error("X0NotPositive");

  const Reff6 = mulDivFloor(x0, rX18 - WAD, WAD);
  return { Ts, Tl, y0, x0, y1, Reff6 };
}

// MATH 6.1. Zero-fee short circuit before any division; protocol share by
// subtraction so the two shares always sum to fee6.
export function splitFee(
  fee6: bigint,
  feeBps: bigint,
  creatorBps: bigint,
): { creatorFee6: bigint; protocolFee6: bigint } {
  if (feeBps === 0n) return { creatorFee6: 0n, protocolFee6: 0n };
  const creatorFee6 = mulDivFloor(fee6, creatorBps, feeBps);
  return { creatorFee6, protocolFee6: fee6 - creatorFee6 };
}

// MATH 6.2.
export function buyQuote(x: bigint, y: bigint, usdcIn6: bigint, feeBps: bigint): BuyQuote {
  const fee6 = mulDivCeil(usdcIn6, feeBps, BPS_DENOM);
  const net6 = usdcIn6 - fee6;
  const tokensOut = mulDivFloor(y, net6, x + net6);
  return { tokensOut, fee6, net6 };
}

// MATH 6.3.
export function sellQuote(x: bigint, y: bigint, tokensIn: bigint, feeBps: bigint): SellQuote {
  const gross6 = mulDivFloor(x, tokensIn, y + tokensIn);
  const fee6 = mulDivCeil(gross6, feeBps, BPS_DENOM);
  const usdcOut6 = gross6 - fee6;
  return { usdcOut6, fee6, gross6 };
}

// MATH 6.4. Denominator is the market constant y1.
export function crossingQuote(
  x: bigint,
  y1: bigint,
  remaining: bigint,
  feeBps: bigint,
): CrossingQuote {
  const netNeeded6 = mulDivCeil(x, remaining, y1);
  const spend6 = mulDivCeil(netNeeded6, BPS_DENOM, BPS_DENOM - feeBps);
  const feeUsed6 = spend6 - netNeeded6;
  return { netNeeded6, feeUsed6, spend6 };
}

// MATH [9].
export function priceX18(x: bigint, y: bigint): bigint {
  return mulDivFloor(x, PRICE_SCALE, y);
}

// MATH [10].
export function marketCap6(x: bigint, y: bigint, S: bigint): bigint {
  return mulDivFloor(x, S, y);
}
