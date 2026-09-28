import { formatAddress } from "@peakpump/shared/format";
import { Panel } from "@peakpump/ui/Panel";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAddress, isAddress } from "viem";
import { PriceChart } from "@/components/chart/PriceChart";
import { RouteChart } from "@/components/chart/RouteChart";
import { AddressLink } from "@/components/token/AddressLink";
import { Comments } from "@/components/social/Comments";
import { CreatorEarnings } from "@/components/token/CreatorEarnings";
import { HoldersList } from "@/components/token/HoldersList";
import { LivePrice } from "@/components/token/LivePrice";
import { MarketCap } from "@/components/token/MarketCap";
import { ProgressPanel } from "@/components/token/ProgressPanel";
import { SafetyBadges } from "@/components/token/SafetyBadges";
import { TokenIdentity } from "@/components/token/TokenIdentity";
import { TokenImage } from "@/components/token/TokenImage";
import { TradesList } from "@/components/token/TradesList";
import { WatchButton } from "@/components/token/WatchButton";
import { SummitCelebration } from "@/components/feedback/SummitCelebration";
import { StickyTradeBar } from "@/components/trade/StickyTradeBar";
import { TradePanel } from "@/components/trade/TradePanel";
import { fetchMarketsByIds } from "@/lib/markets";

// One grid, placed explicitly. The document order below is the stacking order DESIGN.md
// fixes — identity, trade panel, chart, progress, trades, holders, comments — and the
// three-column layout places each panel by column and row rather than reordering the
// markup, so a screen reader and a pointer follow the same sequence.
//
// It engages at lg, not md, because DESIGN.md:207 names a layout breakpoint without
// giving it a value and 280 / fluid / 360 does not fit at md: two fixed rails and two
// gaps commit 672px of the 736px a 768px viewport has, and the 64px left over is under
// the centre column's own min-content width, so the document scrolled sideways from
// 768px to about 845px. 1fr is 576px at lg, and lg is the one breakpoint the theme
// declares that nothing was using.
const PLACE = {
  identity: "lg:col-start-1 lg:row-start-1",
  trade: "lg:col-start-3 lg:row-start-1 lg:row-span-3",
  chart: "lg:col-start-2 lg:row-start-1",
  progress: "lg:col-start-1 lg:row-start-2",
  trades: "lg:col-start-2 lg:row-start-2",
  holders: "lg:col-start-1 lg:row-start-3",
  comments: "lg:col-start-2 lg:row-start-3",
} as const;

const SUBHEAD = "text-body font-medium text-pp-text";

// The one place a route segment becomes an Address. Every island below takes one and
// keys a read on it, so a segment that is not an address would fail eight reads over
// and print eight sentences about it; not-found.tsx says the one true thing instead.
// Checksummed, so /token/0xabc… and /token/0xABC… are one market and not two caches.
function readCurve(segment: string): `0x${string}` {
  if (!isAddress(segment)) notFound();
  return getAddress(segment);
}

// The title and the card come from the Token entity, the same snapshot the home
// page lists. The OG image carries identity only (see the route), so the
// metadata never has to race a price.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ curve: string }>;
}): Promise<Metadata> {
  const { curve: segment } = await params;
  if (!isAddress(segment)) return { title: "Token" };
  const curve = getAddress(segment);
  const markets = await fetchMarketsByIds([curve]);
  const market = markets === null ? null : (markets[0] ?? null);
  const name = market?.name ?? market?.symbol ?? formatAddress(curve);
  return {
    title: name,
    openGraph: { images: [{ url: `/api/og/token/${curve}`, width: 1200, height: 630 }] },
  };
}

export default async function TokenPage({ params }: { params: Promise<{ curve: string }> }) {
  // Next 16 hands params over as a promise.
  const { curve: segment } = await params;
  const curve = readCurve(segment);

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[280px_1fr_360px] lg:items-start">
      <Panel as="section" title="Token" className={PLACE.identity}>
        <div className="flex flex-col gap-4">
          {/* No src, so the deterministic identicon draws from the curve address. The
              alt is the address as it is printed below, not the word "token": the image
              identifies one market and two markets never draw the same. */}
          <TokenImage address={curve} alt={`Token ${formatAddress(curve)}`} size={64} />
          <TokenIdentity curve={curve} />
          <LivePrice curve={curve} />
          <MarketCap curve={curve} />

          {/* The address is a link when a block explorer is configured and plain text when
              none is. TokenIdentity prints the token's own address the same way, which is
              the pair SafetyBadges reasons about. */}
          <AddressLink label="Curve" address={curve} />

          <SafetyBadges curve={curve} />

          {/* The save control the watchlist's empty states point at: the panel is
              where a reader has just decided the market is worth returning to. */}
          <WatchButton market={curve} />
        </div>
      </Panel>

      {/* The whole panel goes at sm, not only its body: the bar at the foot of the page
          is the trade surface there (DESIGN.md:223), and a heading over an empty box
          would sit in the stack beside it. */}
      <Panel as="section" title="Trade" className={`${PLACE.trade} hidden md:block`}>
        <TradePanel curve={curve} />
      </Panel>

      <Panel as="section" title="Chart" className={PLACE.chart}>
        {/* The route first and the history second, because the route draws from the
            curve's own storage and is therefore the one view on this page that is never
            empty. With the indexer unset this panel still carries a chart. */}
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <h3 className={SUBHEAD}>The route to the Summit</h3>
            <RouteChart curve={curve} />
          </div>
          <div className="flex flex-col gap-3">
            <h3 className={SUBHEAD}>Price history</h3>
            <PriceChart curve={curve} />
          </div>
        </div>
      </Panel>

      <Panel as="section" title="Progress to the Summit" className={PLACE.progress}>
        <div className="flex flex-col gap-6">
          <ProgressPanel curve={curve} />
          {/* Under its own heading because the panel's is about the climb and this is
              about the fees the climb pays. It sits in this rail rather than in the trade
              column, which is hidden at sm, so a creator on a phone can still read it. */}
          <div className="flex flex-col gap-3">
            <h3 className={SUBHEAD}>Creator earnings</h3>
            <CreatorEarnings curve={curve} />
          </div>
        </div>
      </Panel>

      <Panel as="section" title="Trades" className={PLACE.trades}>
        <TradesList curve={curve} />
      </Panel>

      <Panel as="section" title="Holders" className={PLACE.holders}>
        <HoldersList curve={curve} />
      </Panel>

      <Panel as="section" title="Comments" className={PLACE.comments}>
        <Comments curve={curve} />
      </Panel>

      {/* The Summit announcement watches this market's phase from inside the
          page, and renders nothing until the edge it exists for happens. */}
      <SummitCelebration curve={curve} />

      {/* Last in the column so it reserves its own height at the end of the page: it is
          sticky rather than fixed, and the file says why. */}
      <StickyTradeBar curve={curve} />
    </div>
  );
}
