"use client";

import { PeakpumpFactoryAbi } from "@peakpump/contracts-abi";
import { PEAKPUMP_FACTORY } from "@peakpump/shared/addresses";
import { type UseQueryResult, skipToken, useQuery } from "@tanstack/react-query";
import { useCreateParams } from "@/hooks/useCreateParams";
import { LIVE_POLL_MS } from "@/hooks/useTokenLive";
import { LIVE_READ_QUERY_OPTIONS } from "@/lib/query";
import { type ReadClient, publicClient } from "@/lib/viem";

// The read lives here and not in lib/factory-reads.ts: that module is closed
// to additions. The shape is
// that module's: address and ABI from the same two packages, and the view's
// own argument order.
export async function readMaxDevBuy(
  client: ReadClient,
  S: bigint,
  R6: bigint,
  rX18: bigint,
  feeBps: bigint,
): Promise<bigint> {
  return client.readContract({
    address: PEAKPUMP_FACTORY,
    abi: PeakpumpFactoryAbi,
    functionName: "maxDevBuy6",
    args: [S, R6, rX18, feeBps],
  });
}

// The curve arguments the cap is a function of, in the raw units create()
// itself receives. Null is the caller's gate: the view runs deriveParams
// internally (PeakpumpFactory.sol:343) and reverts on an out-of-bounds triple,
// so the model's own rejection of the economics arrives here as null and the
// hook asks nothing it knows would revert.
export interface EconomicsTriple {
  S: bigint;
  R6: bigint;
  rX18: bigint;
}

// The only source for the dev-buy maximum is the factory's own view, read over
// RPC — never a number retyped in the form and never the shared pure twin on
// its own, which exists for the ARC test's oracle. feeBps is the live
// defaultFeeBps rather than a constant: the market this form creates inherits
// that fee (PeakpumpFactory.sol:215 passes defaultFeeBps into the curve), the
// cap depends on it, and setDefaultFees can move it while the form is open.
// useCreateParams already polls the four factory parameters on this cadence,
// so composing that hook costs one shared query rather than a second round
// trip. The error stays react-query's — describeReadError turns it into a
// sentence at the render site, where the sentence is shown.
export function useMaxDevBuy(economics: EconomicsTriple | null): UseQueryResult<bigint> {
  const createParams = useCreateParams();
  const feeBps = createParams.data?.defaultFeeBps;
  const args =
    economics !== null && feeBps !== undefined
      ? { S: economics.S, R6: economics.R6, rX18: economics.rX18, feeBps: BigInt(feeBps) }
      : undefined;
  return useQuery({
    // The bigint entries are stringified and the absent ones null: react-query
    // hashes a key with JSON.stringify, which throws on a bigint.
    queryKey: [
      "max-dev-buy",
      economics?.S.toString() ?? null,
      economics?.R6.toString() ?? null,
      economics?.rX18.toString() ?? null,
      feeBps ?? null,
    ],
    queryFn: args === undefined ? skipToken : () => readMaxDevBuy(publicClient, args.S, args.R6, args.rX18, args.feeBps),
    refetchInterval: LIVE_POLL_MS,
    ...LIVE_READ_QUERY_OPTIONS,
  });
}
