"use client";

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { type TokenLive, readTokenLive } from "@/lib/curve-reads";
import { LIVE_READ_QUERY_OPTIONS } from "@/lib/query";
import { publicClient } from "@/lib/viem";
import { useWalletState } from "@/lib/wallet-state";

// One cadence for every live read in the product. react-query's
// refetchIntervalInBackground defaults to false, so this already means "while the
// tab is visible" and no visibilitychange listener of ours is needed.
export const LIVE_POLL_MS = 2_000;

// The connected address is part of the key, not just the arguments: switching
// accounts must not paint the previous account's window spend or deferred
// balance, and a disconnect must drop them rather than keep them.
//
// The error is left as react-query's. describeReadError turns it into a sentence
// at the render site, where the sentence is shown; classifying it here would
// cost isSuccess narrowing on data for every consumer.
export function useTokenLive(curve: Address): UseQueryResult<TokenLive> {
  const address = useWalletState().address;
  return useQuery({
    queryKey: ["token-live", curve, address ?? null],
    queryFn: () => readTokenLive(publicClient, curve, address),
    refetchInterval: LIVE_POLL_MS,
    ...LIVE_READ_QUERY_OPTIONS,
  });
}
