"use client";

import type { Address } from "viem";
import { formatAddress } from "@peakpump/shared/format";
import { TokenImage } from "@/components/token/TokenImage";
import { InlineAddressLink } from "@/components/layout/InlineAddressLink";
import { FollowButton } from "@/components/social/FollowButton";
import { useFollowerList, useFollowingList } from "@/hooks/useFollows";

// The identity header of the profile page. An address has no display name to
// edit (profile editing is out of scope by ruling), so the card is the
// address, its identicon and the two social counts the follows route answers.
// The counts are the lengths of the shared list queries (hooks/useFollows):
// the card asks the same question the lists below it render, so it reads the
// cache entry they already hold instead of fetching a second copy under the
// same key.

function useCounts(address: Address) {
  const followers = useFollowerList(address);
  const following = useFollowingList(address);
  return { followers, following };
}

// A count is either the number or the honest word for "unknown": the sentence
// the written empty states elsewhere use, never a blank the reader has to
// interpret. Zero is a real count and shows as 0.
function countOf(query: { data?: Address[]; isError: boolean }): string {
  if (query.isError) return "unavailable";
  return query.data === undefined ? "…" : String(query.data.length);
}

export function ProfileCard({ address }: { address: Address }) {
  const { followers, following } = useCounts(address);

  return (
    <div className="hairline rounded-pp bg-pp-surface flex flex-wrap items-center gap-4 p-4">
      <TokenImage address={address} alt={`Identicon for ${formatAddress(address)}`} size={64} />
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="mono text-heading break-all text-pp-text">
          <InlineAddressLink address={address} className="text-pp-text" />
        </h1>
        {/* Body on mobile: counts are numbers, floored at the scale's third
            step there, then Small from md up like every other list figure. */}
        <p className="mono text-body text-pp-text-muted md:text-small">
          {countOf(followers)} followers · {countOf(following)} following
        </p>
      </div>
      <div className="ml-auto">
        <FollowButton target={address} />
      </div>
    </div>
  );
}
