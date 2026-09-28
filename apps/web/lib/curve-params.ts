import { CurveAbi, PeakTokenAbi } from "@peakpump/contracts-abi";
import type { Address } from "viem";
import type { ReadClient } from "@/lib/viem";

// Everything here is written once, at initialize, and has no setter: S, Ts, x0,
// y0 and y1 come from MATH 3, token and creator from the factory's create call,
// and PeakToken's name, symbol and supply from its own initialize. That is why
// useMarketParams may hold them forever while every live figure keeps
// LIVE_READ_QUERY_OPTIONS. feeBps is deliberately absent: it is a snapshot the
// market carries and readTokenLive already returns it beside the price it applies
// to.
export interface MarketParams {
  token: Address;
  creator: Address;
  S: bigint;
  Ts: bigint;
  x0: bigint;
  y0: bigint;
  y1: bigint;
  name: string;
  symbol: string;
  totalSupply: bigint;
}

// Two round trips rather than one batch: the token address is the first read's
// answer and the second read's target. Both are multicalls, so this is two
// requests for ten calls.
export async function readMarketParams(
  client: ReadClient,
  curve: Address,
): Promise<MarketParams> {
  const [token, creator, S, Ts, x0, y0, y1] = await client.multicall({
    contracts: [
      { address: curve, abi: CurveAbi, functionName: "token" },
      { address: curve, abi: CurveAbi, functionName: "creator" },
      { address: curve, abi: CurveAbi, functionName: "S" },
      { address: curve, abi: CurveAbi, functionName: "Ts" },
      { address: curve, abi: CurveAbi, functionName: "x0" },
      { address: curve, abi: CurveAbi, functionName: "y0" },
      { address: curve, abi: CurveAbi, functionName: "y1" },
    ] as const,
    allowFailure: false,
  });
  const [name, symbol, totalSupply] = await client.multicall({
    contracts: [
      { address: token, abi: PeakTokenAbi, functionName: "name" },
      { address: token, abi: PeakTokenAbi, functionName: "symbol" },
      { address: token, abi: PeakTokenAbi, functionName: "totalSupply" },
    ] as const,
    allowFailure: false,
  });
  return { token, creator, S, Ts, x0, y0, y1, name, symbol, totalSupply };
}

// MATH 2 [6]: Tl is S - Ts and is never computed independently of it.
export function tokensAfterSummit(params: MarketParams): bigint {
  return params.S - params.Ts;
}