"use client";

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { type MarketParams, readMarketParams } from "@/lib/curve-params";
import { publicClient } from "@/lib/viem";

// The one read in this product that may be held forever. DESIGN.md:257 allows
// caching only for values no one can trade on, and every field here is fixed at
// initialize. x0 is the exception in shape only: _summit() zeroes it at the Summit
// and never restores it, so a market held open across its own crossing keeps a
// cached pre-Summit value. That is not a stale read, because the route chart draws
// the ASCENT geometry and x0's pre-Summit value is the scale that geometry was
// priced in — a page loaded after the crossing reads 0n instead, and recovers the
// same scale from the frozen raise. Either order answers the same question. The
// connected address is not in the key because none of these values depends on who
// is asking.
export function useMarketParams(curve: Address): UseQueryResult<MarketParams> {
  return useQuery({
    queryKey: ["market-params", curve],
    queryFn: () => readMarketParams(publicClient, curve),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
}