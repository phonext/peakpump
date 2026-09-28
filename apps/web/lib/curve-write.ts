import { CurveAbi } from "@peakpump/contracts-abi";
import type { Address } from "viem";

// The three write paths this route has, as plain contract calls. Nothing here
// multiplies, clamps or floors a fee: feeCeiling in packages/shared/src/chain.ts is
// the only place a gas bound is computed, feeOverrides in lib/gas.ts is the only
// caller of it, and hooks/useTrade.ts sends what an estimate already carried.

// msg.value carries the 18-decimal view and usdcIn6 = msg.value / 1e12,
// so a whole number of 6-decimal units is sent as an exact multiple of
// 1e12. The contract's dustWei accumulator therefore takes
// nothing from a trade this panel builds: there is no remainder to take.
export const MICRO_TO_WEI = 1_000_000_000_000n;

export interface BuyParams {
  curve: Address;
  usdcIn6: bigint;
  minTokensOut: bigint;
  deadline: bigint;
  to: Address;
}

export interface SellParams {
  curve: Address;
  tokensIn: bigint;
  minUsdcOut6: bigint;
  deadline: bigint;
}

// Parameter order is frozen and matches the deployed ABI:
// buy(uint256 minTokensOut, uint256 deadline, address to) payable.
export function buyCall(params: BuyParams) {
  return {
    address: params.curve,
    abi: CurveAbi,
    functionName: "buy",
    args: [params.minTokensOut, params.deadline, params.to],
    value: params.usdcIn6 * MICRO_TO_WEI,
  } as const;
}

// sell(uint256 tokensIn, uint256 minUsdcOut6, uint256 deadline), and no approve
// anywhere: PeakToken.pullFrom is guarded by msg.sender == curve, so the curve
// moves the tokens without an allowance ever existing.
export function sellCall(params: SellParams) {
  return {
    address: params.curve,
    abi: CurveAbi,
    functionName: "sell",
    args: [params.tokensIn, params.minUsdcOut6, params.deadline],
  } as const;
}

export function withdrawDeferredCall(curve: Address) {
  return { address: curve, abi: CurveAbi, functionName: "withdrawDeferred", args: [] } as const;
}
