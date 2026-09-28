import { PeakTokenAbi } from "@peakpump/contracts-abi";
import type { Address } from "viem";
import type { ReadClient } from "@/lib/viem";

// nativeWei is the 18-decimal view and is what msg.value and the gas bound are
// denominated in; tokenWei and creatorTokenWei are token wei. The two USDC views
// are the same funds, so nothing here ever adds them, and toMicroFloor
// is the only conversion between them.
export interface TokenBalances {
  nativeWei: bigint | null;
  tokenWei: bigint | null;
  creatorTokenWei: bigint;
}

// One HTTP round trip: the two balanceOf calls go through multicall and the native
// balance rides the same batched request the http transport opens for it.
export async function readTokenBalances(
  client: ReadClient,
  token: Address,
  creator: Address,
  user: Address | undefined,
): Promise<TokenBalances> {
  if (user === undefined) {
    const [creatorTokenWei] = await client.multicall({
      contracts: [
        { address: token, abi: PeakTokenAbi, functionName: "balanceOf", args: [creator] },
      ] as const,
      allowFailure: false,
    });
    return { nativeWei: null, tokenWei: null, creatorTokenWei };
  }
  const [balances, nativeWei] = await Promise.all([
    client.multicall({
      contracts: [
        { address: token, abi: PeakTokenAbi, functionName: "balanceOf", args: [creator] },
        { address: token, abi: PeakTokenAbi, functionName: "balanceOf", args: [user] },
      ] as const,
      allowFailure: false,
    }),
    client.getBalance({ address: user }),
  ]);
  const [creatorTokenWei, tokenWei] = balances;
  return { nativeWei, tokenWei, creatorTokenWei };
}

// Basis points of supply the creator still holds, floored, so the badge never
// rounds a holding up. Local arithmetic on two chain reads and nothing a trade
// depends on: it is not a fee, a quote, an output amount or a refund, and it never
// appears beside a submit control.
export function holdingBps(creatorTokenWei: bigint, totalSupply: bigint): bigint {
  return (creatorTokenWei * 10_000n) / totalSupply;
}