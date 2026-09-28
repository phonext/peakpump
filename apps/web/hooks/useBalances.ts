"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { LIVE_POLL_MS } from "@/hooks/useTokenLive";
import { LIVE_READ_QUERY_OPTIONS } from "@/lib/query";
import { type TokenBalances, readTokenBalances } from "@/lib/token-balances";
import { publicClient } from "@/lib/viem";
import { useWalletState } from "@/lib/wallet-state";

// A balance is what the Max button spends and what the sell field is checked
// against, so it takes the live cadence and none of the caching shortcuts. The
// creator's holding rides in the same batch because the dev-holdings badge needs
// it whether or not a wallet is connected.
//
// Null until useMarketParams has answered: the token and the creator are that
// read's output, and skipToken keeps this query from asking for balances at an
// address it does not have yet.
export function useBalances(
  token: Address | undefined,
  creator: Address | undefined,
): TokenBalances | null {
  const address = useWalletState().address;
  const query = useQuery({
    queryKey: ["token-balances", token ?? null, creator ?? null, address ?? null],
    queryFn:
      token === undefined || creator === undefined
        ? skipToken
        : () => readTokenBalances(publicClient, token, creator, address),
    refetchInterval: LIVE_POLL_MS,
    ...LIVE_READ_QUERY_OPTIONS,
  });
  return query.data ?? null;
}
