"use client";

import { formatAddress } from "@peakpump/shared/format";
import { EmptyState } from "@peakpump/ui/EmptyState";
import { Skeleton } from "@peakpump/ui/Skeleton";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { Address } from "viem";
import { fetchMarketsByIds, type MarketRow } from "@/lib/markets";
import { useFollowerList, useFollowingList } from "@/hooks/useFollows";
import { useWatchlist } from "@/hooks/useWatchlist";

// The profile's public social lists. Both are public facts about the profiled
// address — what it saved and who follows it — served by the database routes
// and read here in the browser, where each visitor's own rate limit and the
// route's CDN cache apply. Follower addresses link to their own profiles,
// because an address is a page in this product.

// The watchlist names markets, so its second half is the indexer's: the saved
// curve addresses become Token rows, in the order they were saved. The list
// itself is the shared query (hooks/useWatchlist), the same cache entry the
// token page's save button flips.
export function ProfileWatchlist({ address }: { address: Address }) {
  const saved = useWatchlist(address);

  const ids = saved.data;
  const markets = useQuery({
    queryKey: ["watchlist-markets", ids],
    enabled: ids !== undefined,
    queryFn: () => fetchMarketsByIds(ids ?? []),
  });

  if (saved.isPending || markets.isPending) {
    return (
      <div className="flex flex-col gap-2 py-3">
        {[0, 1, 2].map((slot) => (
          <Skeleton key={slot} width="55%" height={16} />
        ))}
      </div>
    );
  }

  if (saved.isError || markets.isError || markets.data === null) {
    return (
      <EmptyState
        title="The watchlist did not load"
        detail="Saved markets come from the database and their rows from the indexer. Try again in a moment."
      />
    );
  }

  if (markets.data.length === 0) {
    return (
      <EmptyState
        title="No saved markets"
        detail="This account has not saved a market. A market is saved from its own page."
      />
    );
  }

  return (
    <ul className="flex flex-col">
      {markets.data.map((market: MarketRow) => (
        <li key={market.id} className="border-b border-pp-hairline py-2 last:border-b-0">
          {/* A block box at the 44px target floor: each market sits on its own
              line, so the height can be exact. */}
          <Link
            href={`/token/${market.id}`}
            className="text-body text-pp-text underline-offset-2 hover:underline md:text-small flex min-h-[44px] items-center"
          >
            {market.name ?? market.symbol ?? market.id}
          </Link>
        </li>
      ))}
    </ul>
  );
}

// Follows read both ways on one route: the accounts this address follows, and
// the accounts that follow it. Both queries are the shared ones
// (hooks/useFollows), so the identity card's counts read the same cache
// entries these lists render.
export function ProfileFollows({ address }: { address: Address }) {
  const following = useFollowingList(address);
  const followers = useFollowerList(address);

  if (following.isPending || followers.isPending) {
    return (
      <div className="flex flex-col gap-2 py-3">
        {[0, 1].map((slot) => (
          <Skeleton key={slot} width="55%" height={16} />
        ))}
      </div>
    );
  }

  if (following.isError || followers.isError) {
    return (
      <EmptyState
        title="The follow lists did not load"
        detail="Both lists come from the database. Try again in a moment."
      />
    );
  }

  return (
    <div className="flex flex-col">
      <div className="border-b border-pp-hairline py-3">
        <p className="text-small text-pp-text-muted">Follows</p>
        {following.data.length === 0 ? (
          <p className="text-small text-pp-text-faint">No accounts followed.</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-2">
            {following.data.map((target) => (
              <li key={target}>
                {/* inline-flex rather than block: the addresses chip in a wrap,
                    and each chip is still a 44px target. */}
                <Link
                  href={`/profile/${target}`}
                  className="mono text-small text-pp-text underline-offset-2 hover:underline inline-flex min-h-[44px] items-center"
                >
                  {formatAddress(target)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="py-3">
        <p className="text-small text-pp-text-muted">Followed by</p>
        {followers.data.length === 0 ? (
          <p className="text-small text-pp-text-faint">No followers yet.</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-2">
            {followers.data.map((follower) => (
              <li key={follower}>
                <Link
                  href={`/profile/${follower}`}
                  className="mono text-small text-pp-text underline-offset-2 hover:underline inline-flex min-h-[44px] items-center"
                >
                  {formatAddress(follower)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
