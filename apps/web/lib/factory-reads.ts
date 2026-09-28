import { PeakpumpFactoryAbi } from "@peakpump/contracts-abi";
import { PEAKPUMP_FACTORY } from "@peakpump/shared/addresses";
import type { ReadClient } from "@/lib/viem";

// creationFee6 is 6-decimal USDC; the three bps values are basis points out of
// 10,000. The factory has no tradeFeeBps: what a new market inherits as its
// total is defaultFeeBps, and the creator/protocol pair splits that total.
export interface CreateParams {
  creationFee6: bigint;
  defaultFeeBps: number;
  defaultCreatorBps: number;
  defaultProtocolBps: number;
}

// Read live rather than taken from @peakpump/shared/fees, which labels the
// static preview only: the owner can change all four, and the deployed
// creation fee already sits at 0 against a code default that is not.
// These are the numbers a create form charges against, so they come from the
// factory itself.
export async function readCreateParams(client: ReadClient): Promise<CreateParams> {
  const [creationFee6, defaultFeeBps, defaultCreatorBps, defaultProtocolBps] =
    await client.multicall({
      contracts: [
        { address: PEAKPUMP_FACTORY, abi: PeakpumpFactoryAbi, functionName: "creationFee6" },
        { address: PEAKPUMP_FACTORY, abi: PeakpumpFactoryAbi, functionName: "defaultFeeBps" },
        { address: PEAKPUMP_FACTORY, abi: PeakpumpFactoryAbi, functionName: "defaultCreatorBps" },
        { address: PEAKPUMP_FACTORY, abi: PeakpumpFactoryAbi, functionName: "defaultProtocolBps" },
      ] as const,
      allowFailure: false,
    });
  return { creationFee6, defaultFeeBps, defaultCreatorBps, defaultProtocolBps };
}
