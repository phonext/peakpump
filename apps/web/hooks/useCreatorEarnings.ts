"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { type IndexerRows } from "@/hooks/useIndexerLists";
import { LIVE_POLL_MS } from "@/hooks/useTokenLive";
import { type FeeCreditRow, fetchFeeCredits, readVaultBalance6 } from "@/lib/creator-earnings";
import { LIVE_READ_QUERY_OPTIONS } from "@/lib/query";
import { publicClient } from "@/lib/viem";

// Two sources, deliberately: the claimable figure is what a creator acts on, so it
// comes off the vault at the live cadence with none of the caching shortcuts, and
// the history beside it is the indexer's. With NEXT_PUBLIC_INDEXER_URL unset the
// balance is still exact and only the list falls back to a written empty state.
export interface CreatorEarnings {
  claimable6: bigint | null;
  credits: IndexerRows<FeeCreditRow>;
}

export function useCreatorEarnings(
  curve: Address,
  creator: Address | undefined,
  limit: number,
): CreatorEarnings {
  const balance = useQuery({
    queryKey: ["vault-balance", creator ?? null],
    queryFn: creator === undefined ? skipToken : () => readVaultBalance6(publicClient, creator),
    refetchInterval: LIVE_POLL_MS,
    ...LIVE_READ_QUERY_OPTIONS,
  });
  const credits = useQuery({
    queryKey: ["fee-credits", curve, creator ?? null, limit],
    queryFn:
      creator === undefined ? skipToken : () => fetchFeeCredits(curve, creator, limit),
  });
  return {
    claimable6: balance.data ?? null,
    credits: credits.isError ? null : credits.data,
  };
}
