"use client";

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { type MarketParams, readMarketParams } from "@/lib/curve-params";
import { publicClient } from "@/lib/viem";

// The one read in this product that may be held forever. DESIGN.md:257 allows
// caching only for values no one can trade on, and every field here is written
// once at initialize and has no setter, so a second fetch could only return the
// same answer. The connected address is not in the key because none of these
// values depends on who is asking.
export function useMarketParams(curve: Address): UseQueryResult<MarketParams> {
  return useQuery({
    queryKey: ["market-params", curve],
    queryFn: () => readMarketParams(publicClient, curve),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
}