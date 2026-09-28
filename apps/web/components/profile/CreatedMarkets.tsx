"use client";

import { formatPercent, formatUsdc6 } from "@peakpump/shared/format";
import { Button } from "@peakpump/ui/Button";
import { ProgressAscent } from "@peakpump/ui/ProgressAscent";
import Link from "next/link";
import { useState } from "react";
import type { Address } from "viem";
import { fetchCreatedMarkets, marketProgressBps, type MarketRow } from "@/lib/markets";

// The created list's rows and its "More". The first page is the server's, and
// every next one is the indexer's with the marketId cursor — the same total
// order the home page's All tab pages on, and never a timestamp.

const PAGE = 25;

export function CreatedMarketsBody({ creator, initialRows }: {
  creator: Address;
  initialRows: readonly MarketRow[];
}) {
  const [rows, setRows] = useState<readonly MarketRow[]>(initialRows);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(initialRows.length < PAGE);
  const [offline, setOffline] = useState(false);

  async function more() {
    const last = rows[rows.length - 1];
    if (last === undefined) return;
    setLoading(true);
    const page = await fetchCreatedMarkets(creator, PAGE, { marketId: last.marketId });
    setLoading(false);
    if (page === null) {
      setOffline(true);
      return;
    }
    setOffline(false);
    setRows((current) => [...current, ...page]);
    if (page.length < PAGE) setDone(true);
  }

  return (
    <div className="flex flex-col">
      <ul>
        {rows.map((market) => {
          const bps = marketProgressBps(market);
          const label = market.name ?? market.symbol ?? market.id;
          return (
            <li
              key={market.id}
              className="flex flex-col gap-2 border-b border-pp-hairline py-3 last:border-b-0 [content-visibility:auto] [contain-intrinsic-size:126px]"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link
                  href={`/token/${market.id}`}
                  className="text-body text-pp-text font-medium underline-offset-2 hover:underline md:text-small inline-flex min-h-[44px] items-center"
                >
                  {label}
                </Link>
                <span className="mono text-small text-pp-text-muted">
                  {market.phase === 1 ? "PEAK" : "ASCENT"}
                </span>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="mono text-body text-pp-text-muted md:text-small">
                  Fees earned <span className="text-pp-text">{formatUsdc6(market.creatorFees6)} USDC</span>
                </span>
              </div>
              <ProgressAscent bps={bps} valueText={formatPercent(BigInt(bps))} />
            </li>
          );
        })}
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
