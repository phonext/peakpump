import { CurveAbi } from "@peakpump/contracts-abi";
import type { Address, MulticallReturnType } from "viem";
import { MULTICALL3, type ReadClient, blockNumberAbi } from "@/lib/viem";

// Units follow the contract, not the display: x, marketCap6, usdcRaised6 and the
// two per-user caps are 6-decimal USDC; sold and y are 18-decimal token wei;
// priceX18 is USDC per whole token scaled by 1e18; deferredWei is native USDC at
// 18 decimals, because Curve.deferred holds what a failed value transfer owes in
// msg.value units and not in quote units.
export interface TokenLive {
  blockNumber: bigint;
  x: bigint;
  sold: bigint;
  priceX18: bigint;
  marketCap6: bigint;
  progressBps: bigint;
  usdcRaised6: bigint;
  state: number;
  phase: "ASCENT" | "PEAK";
  y: bigint;
  feeBps: number;
  creatorBps: number;
  protocolBps: number;
  antiSnipeEndBlock: bigint;
  maxBuyPerAddress6: bigint;
  // Null when no wallet is connected: there is no address to read them for, and
  // reading them at the zero address would put a number on screen that answers a
  // question nobody asked.
  boughtInWindow6: bigint | null;
  deferredWei: bigint | null;
}

// getBlockNumber rides along as the fourteenth call so the whole batch reports
// the block it was executed against. Curve.state() is the Phase enum, ASCENT
// first.
function curveCalls(curve: Address) {
  return [
    { address: curve, abi: CurveAbi, functionName: "x" },
    { address: curve, abi: CurveAbi, functionName: "sold" },
    { address: curve, abi: CurveAbi, functionName: "priceX18" },
    { address: curve, abi: CurveAbi, functionName: "marketCap6" },
    { address: curve, abi: CurveAbi, functionName: "progressBps" },
    { address: curve, abi: CurveAbi, functionName: "usdcRaised6" },
    { address: curve, abi: CurveAbi, functionName: "state" },
    { address: curve, abi: CurveAbi, functionName: "y" },
    { address: curve, abi: CurveAbi, functionName: "feeBps" },
    { address: curve, abi: CurveAbi, functionName: "creatorBps" },
    { address: curve, abi: CurveAbi, functionName: "protocolBps" },
    { address: curve, abi: CurveAbi, functionName: "antiSnipeEndBlock" },
    { address: curve, abi: CurveAbi, functionName: "maxBuyPerAddress6" },
    { address: MULTICALL3, abi: blockNumberAbi, functionName: "getBlockNumber" },
  ] as const;
}

type BaseResults = MulticallReturnType<ReturnType<typeof curveCalls>, false>;

// The rest element is what lets the connected-wallet batch, which is two calls
// longer, reuse this without a cast.
function assemble(
  results: readonly [...BaseResults, ...unknown[]],
  boughtInWindow6: bigint | null,
  deferredWei: bigint | null,
): TokenLive {
  const [
    x,
    sold,
    priceX18,
    marketCap6,
    progressBps,
    usdcRaised6,
    state,
    y,
    feeBps,
    creatorBps,
    protocolBps,
    antiSnipeEndBlock,
    maxBuyPerAddress6,
    blockNumber,
  ] = results;
  return {
    blockNumber,
    x,
    sold,
    priceX18,
    marketCap6,
    progressBps,
    usdcRaised6,
    state,
    phase: state === 0 ? "ASCENT" : "PEAK",
    y,
    feeBps,
    creatorBps,
    protocolBps,
    // uint48 arrives as a number from viem while every block number is a bigint.
    // Widened here so no caller mixes the two in block arithmetic.
    antiSnipeEndBlock: BigInt(antiSnipeEndBlock),
    maxBuyPerAddress6,
    boughtInWindow6,
    deferredWei,
  };
}

// One batch. Every number a token page can trade on is in it, including the
// market's own fee split rather than the factory's current defaults, which the
// owner can change and which already diverge from the values in code.
export async function readTokenLive(
  client: ReadClient,
  curve: Address,
  user: Address | undefined,
): Promise<TokenLive> {
  if (user === undefined) {
    const results = await client.multicall({ contracts: curveCalls(curve), allowFailure: false });
    return assemble(results, null, null);
  }
  const results = await client.multicall({
    contracts: [
      ...curveCalls(curve),
      { address: curve, abi: CurveAbi, functionName: "boughtInWindow6", args: [user] },
      { address: curve, abi: CurveAbi, functionName: "deferred", args: [user] },
    ] as const,
    allowFailure: false,
  });
  return assemble(results, results[14], results[15]);
}
