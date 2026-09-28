"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";

// One query per watchlist, declared here and shared by every reader: the home
// page's Watchlist tab and the profile page render the list, and the token
// page's save button writes the same cache entry optimistically. A second
// queryFn under one key is how the follow lists once crashed — a count number
// landed in a list's cache entry, and the list called .map on a number — so
// the address list is the one shape the cache holds and everything else is
// derived from it.
//
// A watchlist is Postgres, not the chain, so the client default staleTime
// (30s, lib/query.ts) applies like every other social read; the route itself
// answers max-age=60.

export function watchlistKey(address: Address | null) {
  return ["watchlist", address] as const;
}

// The viewer can be unknown while the session loads, and "what has this
// address saved" has no answer then: the query waits for an address rather
// than fetching with null in the URL.
export function useWatchlist(address: Address | null) {
  return useQuery({
    queryKey: watchlistKey(address),
    enabled: address !== null,
    queryFn: async (): Promise<Address[]> => {
      const response = await fetch(`/api/watchlist?address=${address}`);
      if (!response.ok) throw new Error("offline");
      return ((await response.json()) as { markets: Address[] }).markets;
    },
  });
}
