"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { useCallback } from "react";

// The session as a plain fetch of Auth.js's own endpoint, rather than a
// SessionProvider: the provider would add a context module to every route for
// a value only three components read, and the JSON the endpoint serves is the
// whole truth — { user: { id, address } } or an empty object. A session is not
// a number anyone trades on, so the client's default staleTime applies.

export interface SessionInfo {
  address: Address | null;
  // True while the first read is in flight, so a caller can tell "signed out"
  // from "not yet known" — the same distinction listState makes for rows.
  pending: boolean;
}

interface SessionResponse {
  user?: { address?: string };
}

export function useSession(): SessionInfo & { refresh: () => void } {
  const query = useQuery({
    queryKey: ["session"],
    queryFn: async (): Promise<SessionResponse> => {
      const response = await fetch("/api/auth/session");
      if (!response.ok) return {};
      return (await response.json()) as SessionResponse;
    },
  });
  const client = useQueryClient();
  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: ["session"] });
  }, [client]);
  const address = query.data?.user?.address;
  return {
    address: address === undefined ? null : (address as Address),
    pending: query.isPending,
    refresh,
  };
}
