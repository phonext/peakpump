"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";

// One query per follow list, declared here and shared by every reader: the
// profile page renders the lists themselves, the identity card derives its
// counts from their lengths, and the follow button tests membership in one.
// A second queryFn under the same key is how the profile page once crashed —
// a count number landed in a list's cache entry, and the list called .map on
// a number — so the list is the one shape the cache holds and everything
// else is derived from it.
//
// Social rows are Postgres, not the chain, so the client default staleTime
// (30s, lib/query.ts) applies like every other social read; the route itself
// answers max-age=60.

export function followingKey(address: Address | null) {
  return ["follows", "following", address] as const;
}

// The viewer can be unknown while the session loads, and "who does this
// address follow" has no answer then: the query waits for an address rather
// than fetching with null in the URL.
export function useFollowingList(address: Address | null) {
  return useQuery({
    queryKey: followingKey(address),
    enabled: address !== null,
    queryFn: async (): Promise<Address[]> => {
      const response = await fetch(`/api/follows?address=${address}`);
      if (!response.ok) throw new Error("offline");
      return ((await response.json()) as { following: Address[] }).following;
    },
  });
}

export function followerKey(address: Address) {
  return ["follows", "followers", address] as const;
}

export function useFollowerList(address: Address) {
  return useQuery({
    queryKey: followerKey(address),
    queryFn: async (): Promise<Address[]> => {
      const response = await fetch(`/api/follows?target=${address}`);
      if (!response.ok) throw new Error("offline");
      return ((await response.json()) as { followers: Address[] }).followers;
    },
  });
}
