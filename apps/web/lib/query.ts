import { QueryClient } from "@tanstack/react-query";

// A factory rather than a module singleton. A client built at module scope on the
// server is shared by every request, so one visitor's cached reads would be handed to
// the next; providers.tsx builds one per mount inside useState instead.
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 30 s is this file's own figure, not a document's: SPEC 6.7 defers concrete
        // cache values to this layer. It governs the indexer-backed lists, where a
        // half-minute-old row is still true.
        staleTime: 30_000,
        // A refetch on every tab focus is a burst of requests the reader did not ask
        // for. LIVE_READ_QUERY_OPTIONS turns it back on where it earns the cost.
        refetchOnWindowFocus: false,
      },
    },
  });
}

// DESIGN.md: "No performance measure may cache, stale-serve or locally recompute a
// number a user could trade on." Every read behind a price, a quote, a balance or a
// fee spreads these, so the defaults above can never reach one. gcTime 0 matters as
// much as staleTime 0: a cached-but-stale entry is what a remount would paint first.
export const LIVE_READ_QUERY_OPTIONS = {
  staleTime: 0,
  gcTime: 0,
  refetchOnMount: "always",
  refetchOnWindowFocus: true,
} as const;
