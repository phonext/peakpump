import { Panel } from "@peakpump/ui/Panel";
import { Skeleton } from "@peakpump/ui/Skeleton";

// The route's Suspense fallback, and the reason a shimmer on this page now terminates:
// every box below is replaced by a panel that renders content or a written sentence, and
// each island inside that panel reserves its own final size (DESIGN.md:175-177).
//
// The seven placements are page.tsx's own, repeated rather than shared: the two files have
// to occupy the same cells, and moving the map out of the page would put the layout a
// reader is looking at in a third file.
const PLACE = {
  identity: "lg:col-start-1 lg:row-start-1",
  trade: "lg:col-start-3 lg:row-start-1 lg:row-span-3",
  chart: "lg:col-start-2 lg:row-start-1",
  progress: "lg:col-start-1 lg:row-start-2",
  trades: "lg:col-start-2 lg:row-start-2",
  holders: "lg:col-start-1 lg:row-start-3",
  comments: "lg:col-start-2 lg:row-start-3",
} as const;

// Three rows at the height a list row renders at, which is what the two lists reserve
// before the indexer answers. Comments are not one of those two: their card is taller
// than a trade row, so the two take separate heights from the components that draw them.
const TRADE_ROW_HEIGHT = 88;
const HOLDER_ROW_HEIGHT = 64;
const COMMENT_ROW_HEIGHT = 152;

function Rows({ height }: { height: number }) {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((slot) => (
        <Skeleton key={slot} width="100%" height={height} />
      ))}
    </div>
  );
}

export default function TokenLoading() {
  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[280px_1fr_360px] lg:items-start">
      <Panel as="section" title="Token" className={PLACE.identity}>
        <div className="flex flex-col gap-4">
          {/* The identicon needs no read and draws in the first frame, so what stands in
              for it is its box and not a shimmer of a different shape. */}
          <Skeleton width={64} height={64} />
          <Skeleton width={160} height={20} />
          <Skeleton width={96} height={16} />
          <Skeleton width={140} height={20} />
          <Skeleton width={110} height={20} />
          <Skeleton width={140} height={26} />
          <Skeleton width={110} height={26} />
        </div>
      </Panel>

      {/* Hidden at sm for the same reason as in the page: the trade surface there is the
          bar at the foot of the column. */}
      <Panel as="section" title="Trade" className={`${PLACE.trade} hidden md:block`}>
        <div className="flex flex-col gap-4">
          <Skeleton width="100%" height={72} />
          <Skeleton width="100%" height={44} />
          <Skeleton width="100%" height={44} />
        </div>
      </Panel>

      <Panel as="section" title="Chart" className={PLACE.chart}>
        {/* Square-cornered and 280 tall, twice: both charts draw at that height and carry
            their own edges. */}
        <div className="flex flex-col gap-6">
          <Skeleton width="100%" height={280} radius={false} />
          <Skeleton width="100%" height={280} radius={false} />
        </div>
      </Panel>

      <Panel as="section" title="Progress to the Summit" className={PLACE.progress}>
        <div className="flex flex-col gap-6">
          <Skeleton width="100%" height={8} />
          <Skeleton width={140} height={26} />
        </div>
      </Panel>

      <Panel as="section" title="Trades" className={PLACE.trades}>
        <Rows height={TRADE_ROW_HEIGHT} />
      </Panel>

      <Panel as="section" title="Holders" className={PLACE.holders}>
        <Rows height={HOLDER_ROW_HEIGHT} />
      </Panel>

      {/* The real comments read on mount and paint their own skeletons inside the
          reserved box, so what stands in here is the list's shape: the same
          three rows the other lists reserve. */}
      <Panel as="section" title="Comments" className={PLACE.comments}>
        <Rows height={COMMENT_ROW_HEIGHT} />
      </Panel>
    </div>
  );
}
