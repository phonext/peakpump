"use client";

import { formatPercent, formatTokenAmount } from "@peakpump/shared/format";
import { EmptyState } from "@peakpump/ui/EmptyState";
import { Skeleton } from "@peakpump/ui/Skeleton";
import type { Address } from "viem";
import { InlineAddressLink } from "@/components/layout/InlineAddressLink";
import { useHolders } from "@/hooks/useIndexerLists";
import { useMarketParams } from "@/hooks/useMarketParams";
import { useVirtualRows } from "@/hooks/useVirtualRows";
import type { HolderRow } from "@/lib/graphql";
import { listState } from "@/lib/indexer-state";
import { holdingBps } from "@/lib/token-balances";

// Two lines, one height at every width, for the reason components/token/TradesList.tsx
// gives. The address gets a line of its own rather than sharing one with the balance:
// a holder of most of a 1e9 supply prints sixteen digits, and at the third type step
// that plus a truncated address is wider than a 360px viewport has room for.
const ROW_HEIGHT = 64;
const VISIBLE_ROWS = 5;
const VIEWPORT = ROW_HEIGHT * VISIBLE_ROWS;

// Keep h-[64px] and max-h-[320px] below in step with the two constants above.
const LIMIT = 100;

const FIGURE = "mono text-body text-pp-text break-all md:text-small";
const FIGURE_MUTED = "mono text-body text-pp-text-muted break-all md:text-small";
const LINE = "flex items-baseline justify-between gap-2";

// The share is holdingBps on two reads that are not the same read: the balance is the
// indexer's, the supply is the curve's own S. It is floored, it is not a fee or a
// quote, and it is not beside a submit control.
function Row({
  row,
  symbol,
  totalSupply,
  isCreator,
}: {
  row: HolderRow;
  symbol: string | undefined;
  totalSupply: bigint | undefined;
  isCreator: boolean;
}) {
  return (
    <li className="border-b border-pp-hairline flex h-[64px] flex-col justify-center gap-1 px-3 [content-visibility:auto]">
      <div className={LINE}>
        <InlineAddressLink address={row.address} className={FIGURE} />
        {isCreator ? <span className="text-small text-pp-text-muted">creator</span> : null}
      </div>
      <div className={LINE}>
        <span className={FIGURE_MUTED}>
          {formatTokenAmount(row.balance)}
          {symbol === undefined ? null : ` ${symbol}`}
        </span>
        <span className="text-small text-pp-text-faint">
          {totalSupply === undefined ? null : (
            <>
              <span className={FIGURE_MUTED}>
                {formatPercent(holdingBps(row.balance, totalSupply))}
              </span>{" "}
              of supply
            </>
          )}
        </span>
      </div>
    </li>
  );
}

export function HoldersList({ curve }: { curve: Address }) {
  const params = useMarketParams(curve);
  // A holder is keyed on the token, not the curve, so this list cannot be
  // asked for before useMarketParams has answered. Undefined is still loading. The
  // order is the indexer's own, balance descending, and nothing is sorted here.
  const rows = useHolders(params.data?.token, LIMIT);
  const state = listState(rows);
  const count = state.kind === "rows" ? state.rows.length : 0;
  const view = useVirtualRows(count, ROW_HEIGHT, VIEWPORT);
  const creator = params.data?.creator.toLowerCase();

  if (state.kind === "loading") {
    return (
      <ul className="flex flex-col">
        {[0, 1, 2, 3, 4].map((slot) => (
          <li
            key={slot}
            className="border-b border-pp-hairline flex h-[64px] flex-col justify-center gap-2 px-3"
          >
            <Skeleton width="40%" height={16} />
            <Skeleton width="65%" height={16} />
          </li>
        ))}
      </ul>
    );
  }

  if (state.kind === "offline") {
    return (
      <EmptyState
        title="Holders are not connected"
        detail="Balances come from the indexer. The creator's own share is read from the token contract and is shown with the safety badges."
      />
    );
  }

  if (state.kind === "empty") {
    return (
      <EmptyState
        title="No holders yet"
        detail="Every token is still on the curve. The first buy puts one here."
      />
    );
  }

  const visible = state.rows.slice(view.start, view.end);

  return (
    <div
      ref={view.ref}
      tabIndex={0}
      className="max-h-[320px] overflow-y-auto rounded-pp outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-accent-bright"
    >
      <div style={{ height: view.padTop }} />
      <ul className="flex flex-col">
        {visible.map((row) => (
          <Row
            key={row.address}
            row={row}
            symbol={params.data?.symbol}
            totalSupply={params.data?.totalSupply}
            isCreator={row.address.toLowerCase() === creator}
          />
        ))}
      </ul>
      <div style={{ height: view.padBottom }} />
    </div>
  );
}
