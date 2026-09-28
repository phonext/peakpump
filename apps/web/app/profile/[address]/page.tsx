import { formatAddress, formatUsdc6 } from "@peakpump/shared/format";
import { EmptyState } from "@peakpump/ui/EmptyState";
import { Panel } from "@peakpump/ui/Panel";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAddress, isAddress } from "viem";
import { ClaimPanel } from "@/components/profile/ClaimPanel";
import { CreatedMarketsBody } from "@/components/profile/CreatedMarkets";
import { PositionsBody } from "@/components/profile/PositionsList";
import { ProfileFollows, ProfileWatchlist } from "@/components/profile/SocialLists";
import { ProfileCard } from "@/components/social/ProfileCard";
import {
  fetchCreatedMarkets,
  fetchCreator,
  fetchMarketsByIds,
  fetchPositions,
} from "@/lib/markets";

// Every profile purpose in one page: what the address created and earned,
// what it holds, and its social lists. The created and held lists are the
// indexer's, so the page takes the home page's revalidate window; the claimable
// figure and the claim button are the one live exception, an island reading the
// vault at the live cadence inside the cached frame.
export const revalidate = 30;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const { address } = await params;
  return { title: isAddress(address) ? `Profile ${formatAddress(address)}` : "Profile" };
}

const PAGE = 25;

const OFFLINE_LINE =
  "This list comes from the indexer. It is not answering right now; a market's own page reads its price live.";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  // Next 16 hands params over as a promise.
  const { address: segment } = await params;
  if (!isAddress(segment)) notFound();
  // Checksummed, the form the queries send the indexer.
  const address = getAddress(segment);

  // The name join below depends on positions alone, so it starts the moment
  // that promise resolves rather than after the two reads beside it. Position
  // stores the curve as a string and Token owns the name, so the join is one
  // by-ids query; null only costs the names, not the rows.
  const positionsPromise = fetchPositions(address, PAGE);
  const positionMarketsPromise = positionsPromise.then(async (rows) =>
    rows === null ? [] : ((await fetchMarketsByIds(rows.map((row) => row.token))) ?? []),
  );

  const [creator, created, positions] = await Promise.all([
    fetchCreator(address),
    fetchCreatedMarkets(address, PAGE),
    positionsPromise,
  ]);

  const positionMarkets = await positionMarketsPromise;

  return (
    <div className="flex flex-col gap-6">
      <ProfileCard address={address} />

      <div className="flex flex-col gap-4 md:grid md:grid-cols-2 md:items-start">
        <Panel as="section" title="Creator earnings">
          <div className="flex flex-col gap-4">
            {creator === null ? (
              <p className="text-small text-pp-text-muted">{OFFLINE_LINE}</p>
            ) : (
              <div className="hairline rounded-pp bg-pp-hairline grid grid-cols-3 gap-px overflow-hidden">
                <div className="bg-pp-surface flex flex-col gap-1 px-3 py-2">
                  <span className="text-small text-pp-text-muted">Markets</span>
                  <span className="mono text-body text-pp-text">{creator.marketCount}</span>
                </div>
                <div className="bg-pp-surface flex flex-col gap-1 px-3 py-2">
                  <span className="text-small text-pp-text-muted">Lifetime fees</span>
                  <span className="mono text-body text-pp-text">
                    {formatUsdc6(creator.totalCreatorFees6)} USDC
                  </span>
                </div>
                <div className="bg-pp-surface flex flex-col gap-1 px-3 py-2">
                  <span className="text-small text-pp-text-muted">Claimed</span>
                  <span className="mono text-body text-pp-text">
                    {formatUsdc6(creator.claimed6)} USDC
                  </span>
                </div>
              </div>
            )}
            <ClaimPanel address={address} />
          </div>
        </Panel>

        <Panel as="section" title="Created">
          {created === null ? (
            <EmptyState title="Created markets are not connected" detail={OFFLINE_LINE} />
          ) : created.length === 0 ? (
            <EmptyState
              title="No markets created"
              detail="A market this account creates appears here with the fees it earned."
            />
          ) : (
            <CreatedMarketsBody creator={address} initialRows={created} />
          )}
        </Panel>

        <Panel as="section" title="Held">
          {positions === null ? (
            <EmptyState title="Positions are not connected" detail={OFFLINE_LINE} />
          ) : (
            <PositionsBody trader={address} initialRows={positions} initialMarkets={positionMarkets} />
          )}
        </Panel>

        <Panel as="section" title="Watchlist">
          <ProfileWatchlist address={address} />
        </Panel>

        <Panel as="section" title="Follows">
          <ProfileFollows address={address} />
        </Panel>
      </div>
    </div>
  );
}
