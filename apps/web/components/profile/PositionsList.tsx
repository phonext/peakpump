"use client";

import { formatTokenAmount, formatUsdc6 } from "@peakpump/shared/format";
import { Button } from "@peakpump/ui/Button";
import { EmptyState } from "@peakpump/ui/EmptyState";
import Link from "next/link";
import { useState } from "react";
import type { Address } from "viem";
import { fetchMarketsByIds, fetchPositions, type MarketRow, type PositionRow } from "@/lib/markets";

// The Held list. realised6 arrives net of fees — fees joined the basis on the
// buy side and reduced proceeds on the sell side when the indexer computed it —
// so it is printed as the PnL and feePaid6 stands beside it as its own line,
// spending information rather than a second subtraction.

const PAGE = 25;

// Signed PnL colour: a realised loss is the one figure on this page whose sign
// a reader scans for, and the product already owns the two words for it.
function pnlClass(realised6: bigint): string {
  return realised6 < 0n ? "text-pp-down" : realised6 > 0n ? "text-pp-up" : "text-pp-text";
}

function PositionLine({ position, market }: { position: PositionRow; market?: MarketRow }) {
  const label = market?.name ?? market?.symbol ?? position.token;
  return (
    // The intrinsic-size hint counts the new box: py-3 twice, a 44px target
    // line, two figure lines and the gaps between them.
    <li className="flex flex-col gap-2 border-b border-pp-hairline py-3 last:border-b-0 [content-visibility:auto] [contain-intrinsic-size:132px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link
          href={`/token/${position.token}`}
          className="text-body text-pp-text font-medium underline-offset-2 hover:underline md:text-small inline-flex min-h-[44px] items-center"
        >
          {label}
        </Link>
        <span className="mono text-body text-pp-text-muted md:text-small">
          {formatTokenAmount(position.tokensHeld)} held
        </span>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="mono text-body text-pp-text-muted md:text-small">
          Realised{" "}
          <span className={pnlClass(position.realised6)}>
            {position.realised6 < 0n ? "-" : ""}
            {formatUsdc6(
              position.realised6 < 0n ? -position.realised6 : position.realised6,
            )}{" "}
            USDC
          </span>
        </span>
        <span className="mono text-body text-pp-text-muted md:text-small">
          Fees paid <span className="text-pp-text">{formatUsdc6(position.feePaid6)} USDC</span>
        </span>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="mono text-body text-pp-text-muted md:text-small">
          Cost basis {formatUsdc6(position.costBasis6)} USDC
        </span>
        <span className="mono text-body text-pp-text-faint md:text-small">
          {position.buys} buys · {position.sells} sells
        </span>
      </div>
    </li>
  );
}

export function PositionsBody({ trader, initialRows, initialMarkets }: {
  trader: Address;
  initialRows: readonly PositionRow[];
  initialMarkets: readonly MarketRow[];
}) {
  const [rows, setRows] = useState<readonly PositionRow[]>(initialRows);
  // The join the Token entity cannot express: Position stores the curve address
  // as a string and the name lives on Token, so the page carries both halves and
  // "More" grows the market half one page at a time.
  const [markets, setMarkets] = useState<ReadonlyMap<string, MarketRow>>(
    () => new Map(initialMarkets.map((market) => [market.id.toLowerCase(), market])),
  );
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(initialRows.length < PAGE);
  const [offline, setOffline] = useState(false);

  async function more() {
    const last = rows[rows.length - 1];
    if (last === undefined) return;
    setLoading(true);
    const page = await fetchPositions(trader, PAGE, {
      costBasis6: last.costBasis6,
      id: last.id,
    });
    if (page === null) {
      setLoading(false);
      setOffline(true);
      return;
    }
    const unknown = page.map((position) => position.token).filter((token) => !markets.has(token.toLowerCase()));
    const joined = unknown.length === 0 ? [] : await fetchMarketsByIds(unknown);
    setLoading(false);
    if (joined === null) {
      setOffline(true);
      return;
    }
    setOffline(false);
    setRows((current) => [...current, ...page]);
    setMarkets((current) => {
      const next = new Map(current);
      for (const market of joined) next.set(market.id.toLowerCase(), market);
      return next;
    });
    if (page.length < PAGE) setDone(true);
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No positions"
        detail="A buy in any market puts a position here, with its realised PnL and fees paid."
      />
    );
  }

  return (
    <div className="flex flex-col">
      <ul>
        {rows.map((position) => (
          <PositionLine
            key={position.id}
            position={position}
            market={markets.get(position.token.toLowerCase())}
          />
        ))}
      </ul>
      {offline ? (
        <p className="py-3 text-small text-pp-text-muted">
          The next page did not load. The list above is what the indexer last sent.
        </p>
      ) : null}
      {!done ? (
        <div className="py-3">
          <Button size="sm" variant="ghost" disabled={loading} onClick={() => void more()}>
            {loading ? "Loading" : "More"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
