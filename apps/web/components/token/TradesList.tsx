"use client";

import {
  formatTimeAgo,
  formatTokenAmount,
  formatUsdc6,
} from "@peakpump/shared/format";
import { EmptyState } from "@peakpump/ui/EmptyState";
import { Skeleton } from "@peakpump/ui/Skeleton";
import type { Address } from "viem";
import { InlineAddressLink } from "@/components/layout/InlineAddressLink";
import { useTrades } from "@/hooks/useIndexerLists";
import { useMarketParams } from "@/hooks/useMarketParams";
import { useChainSeconds } from "@/hooks/useTrade";
import { useVirtualRows } from "@/hooks/useVirtualRows";
import type { TradeRow } from "@/lib/graphql";
import { listState } from "@/lib/indexer-state";

// Three lines at every width, and the same height at every width, which is what
// lets the virtualiser be arithmetic instead of a measurement: DESIGN.md:228 turns
// a table row into a stacked block at sm, and a row that restacked at md would need
// two row heights and a matchMedia read that cannot run before hydration. The box
// stays 88px and only the type inside it shrinks.
//
// 88 is the sm case: three lines of the third type step at 1.5 is 72px, plus two
// 4px gaps. At md the same three lines are 55px and sit centred in the same box.
const ROW_HEIGHT = 88;

// Four rows exactly, so the scroller never cuts a row in half at its bottom edge.
// Keep h-[88px] and max-h-[352px] below in step with these two.
const VISIBLE_ROWS = 4;
const VIEWPORT = ROW_HEIGHT * VISIBLE_ROWS;

// One page of history. Ordering is the indexer's (blockNumber, logIndex) and never
// a timestamp; the cursor is the one lib/graphql.ts exports.
const LIMIT = 100;

const FIGURE = "mono text-body text-pp-text break-all md:text-small";
const FIGURE_MUTED = "mono text-body text-pp-text-muted break-all md:text-small";
const FIGURE_FAINT = "mono text-body text-pp-text-faint break-all md:text-small";
const LINE = "flex items-baseline justify-between gap-2";

// The two amounts a reader wants are on opposite sides of the trade, so which field
// carries them depends on the side: a buy spends usdcIn6 and receives tokenOut, a
// sell gives up tokenIn and receives usdcOut6. Both figures are the indexer's copy
// of the Trade event, which is why nothing here is beside a submit control.
function Row({
  row,
  symbol,
  nowSec,
}: {
  row: TradeRow;
  symbol: string | undefined;
  nowSec: bigint | null;
}) {
  const usdc6 = row.isBuy ? row.usdcIn6 : row.usdcOut6;
  const tokens = row.isBuy ? row.tokenOut : row.tokenIn;

  return (
    // content-visibility earns its keep on the overscan rows: they are in the DOM so
    // a flick paints filled rows, and this keeps them out of paint until they are.
    // The height is explicit, so no intrinsic-size hint is needed and nothing shifts.
    <li className="border-b border-pp-hairline flex h-[88px] flex-col justify-center gap-1 px-3 [content-visibility:auto]">
      <div className={LINE}>
        <span
          className={
            row.isBuy
              ? "text-body font-medium text-pp-up md:text-small"
              : "text-body font-medium text-pp-down md:text-small"
          }
        >
          {row.isBuy ? "Buy" : "Sell"}
        </span>
        <span className={FIGURE}>{formatUsdc6(usdc6)} USDC</span>
      </div>

      <div className={LINE}>
        <span className={FIGURE_MUTED}>
          {formatTokenAmount(tokens)}
          {symbol === undefined ? null : ` ${symbol}`}
        </span>
        {/* Blank until the chain's own second lands. A browser clock differenced
            against a chain timestamp would read an age that no block agrees with. */}
        <span className="text-small text-pp-text-faint">
          {nowSec === null ? null : formatTimeAgo(row.timestamp, nowSec)}
        </span>
      </div>

      <div className={LINE}>
        <span className="text-small text-pp-text-muted">
          Fee <span className={FIGURE_FAINT}>{formatUsdc6(row.fee6)}</span> USDC
        </span>
        <InlineAddressLink address={row.trader} className={FIGURE_FAINT} />
      </div>
    </li>
  );
}

export function TradesList({ curve }: { curve: Address }) {
  const rows = useTrades(curve, LIMIT);
  const params = useMarketParams(curve);
  const nowSec = useChainSeconds();
  const state = listState(rows);
  const count = state.kind === "rows" ? state.rows.length : 0;
  const view = useVirtualRows(count, ROW_HEIGHT, VIEWPORT);

  if (state.kind === "loading") {
    return (
      <ul className="flex flex-col">
        {[0, 1, 2, 3].map((slot) => (
          <li key={slot} className="border-b border-pp-hairline flex h-[88px] flex-col justify-center gap-2 px-3">
            <Skeleton width="45%" height={16} />
            <Skeleton width="70%" height={16} />
          </li>
        ))}
      </ul>
    );
  }

  if (state.kind === "offline") {
    return (
      <EmptyState
        title="Trade history is not connected"
        detail="Fills come from the indexer. Price, progress and quotes on this page are read from the curve and are unaffected."
      />
    );
  }

  if (state.kind === "empty") {
    return (
      <EmptyState
        title="No trades yet"
        detail="This market has not been traded. The first buy appears here."
      />
    );
  }

  const visible = state.rows.slice(view.start, view.end);

  return (
    <div
      ref={view.ref}
      // Focusable so the list can be scrolled from the keyboard, with the same focus
      // styling every other target on the page carries.
      tabIndex={0}
      className="max-h-[352px] overflow-y-auto rounded-pp outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-accent-bright"
    >
      <div style={{ height: view.padTop }} />
      <ul className="flex flex-col">
        {visible.map((row) => (
          <Row key={row.id} row={row} symbol={params.data?.symbol} nowSec={nowSec} />
        ))}
      </ul>
      <div style={{ height: view.padBottom }} />
    </div>
  );
}
