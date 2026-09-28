"use client";

import { formatPercent } from "@peakpump/shared/format";

// The gap between the price this trade fills at and the price the curve is at now.
// Both halves come from a chain read: the average fill is the quote's own pool-side
// amount over its own token amount, and the spot is priceX18 from the live batch. It is
// the second of the two local expressions in this file, it is not a fee, a quote or
// an output amount, and it is not a number any transaction carries.
//
// The pool-side amount is net6 on a buy and gross6 on a sell, which is what the pool
// gains and loses. Using the seller's usdcOut6 instead would fold the fee
// into the impact, and the fee is already three lines of its own above this one.
export function executionPriceX18(usdc6: bigint, tokens: bigint): bigint {
  // usdc6/1e6 over tokens/1e18, scaled by 1e18: the 1e30 is those three exponents and
  // no rounding factor of its own.
  return (usdc6 * 10n ** 30n) / tokens;
}

export function PriceImpact({
  side,
  usdc6,
  tokens,
  priceX18,
}: {
  side: "buy" | "sell";
  usdc6: bigint | undefined;
  tokens: bigint | undefined;
  priceX18: bigint | undefined;
}) {
  // One gate for two not-ready states: no quote yet, and no live price yet. Neither is
  // a contract state worth branching on further.
  if (usdc6 === undefined || tokens === undefined || priceX18 === undefined) return null;
  if (tokens === 0n || priceX18 === 0n) return null;

  const execX18 = executionPriceX18(usdc6, tokens);
  const impactBps = ((execX18 - priceX18) * 10_000n) / priceX18;
  const above = impactBps >= 0n;
  const magnitude = above ? impactBps : -impactBps;

  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-small text-pp-text-muted">Price impact</span>
      {/* Tone follows the direction the market moves, which is the direction DESIGN.md
          assigns the two colours to: a buy walks the curve up, a sell walks it down.
          The word follows the sign of the gap, so a fill that lands the other side of
          the spot says so. */}
      <span
        className={
          side === "buy"
            ? "mono text-body text-pp-up break-all md:text-small"
            : "mono text-body text-pp-down break-all md:text-small"
        }
      >
        {formatPercent(magnitude)} {above ? "above spot" : "below spot"}
      </span>
    </div>
  );
}
