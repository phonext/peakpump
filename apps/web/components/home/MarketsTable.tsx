"use client";

import { formatPercent, formatPriceX18, formatUsdc6 } from "@peakpump/shared/format";
import { Button } from "@peakpump/ui/Button";
import { EmptyState } from "@peakpump/ui/EmptyState";
import { ProgressAscent } from "@peakpump/ui/ProgressAscent";
import { Skeleton } from "@peakpump/ui/Skeleton";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import type { Address } from "viem";
import { SignInDialog } from "@/components/social/SignInDialog";
import { TokenImage } from "@/components/token/TokenImage";
import { useSession } from "@/hooks/useSession";
import { useWatchlist } from "@/hooks/useWatchlist";
import {
  MARKET_PAGE_SIZE,
  fetchMarkets,
  fetchMarketsByIds,
  marketProgressBps,
  type MarketRow,
  type MarketTab,
} from "@/lib/markets";

// The table body of the home page: the server hands over the first page it
// already rendered, and "More" appends by asking the indexer directly with the
// cursor the tab actually sorts on — marketId, the factory's own counter, never
// a timestamp. No value here is a quote or a balance; every figure is
// the indexer's list copy, so the client's default staleTime discipline is
// already the right one and nothing polls.

// The one date format in this island runs on the server render and again at
// hydration, so it is pinned to UTC: a server clock and a reader's local clock
// would otherwise print two different dates in the same cell.
const CREATED = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const NUMBER = "mono text-body text-pp-text whitespace-nowrap md:text-small";
const MUTED = "mono text-body text-pp-text-muted whitespace-nowrap md:text-small";

function cursorFor(tab: MarketTab, rows: readonly MarketRow[]) {
  const last = rows[rows.length - 1];
  if (last === undefined) return undefined;
  return tab === "volume"
    ? { marketId: last.marketId, volume6: last.volume6 }
    : { marketId: last.marketId };
}

export function MarketRowLine({
  market,
  image,
}: {
  market: MarketRow;
  // The market's own picture, resolved from its metadataURI by the page the way the
  // rail card's is. Undefined is the identicon's case — a market made without a
  // picture, or a row "More" appended, which arrives from the client and has no
  // server resolution. A list renders with or without a picture either way.
  image?: string | null;
}) {
  const bps = marketProgressBps(market);
  const label = market.name ?? market.symbol ?? market.id;
  return (
    // The stretched link covers the row from the first cell, so the whole row
    // is one target while the name stays the focusable element. py-3 puts that
    // target at 48px (a 24px line box plus padding), over the 44px floor, and
    // the intrinsic-size hint repeats the same 48px so an off-screen row
    // reserves what it will occupy — the plan's bound on a list that can run to
    // hundreds of entries.
    <tr className="relative border-b border-pp-hairline [content-visibility:auto] [contain-intrinsic-size:48px]">
      <td className="px-3 py-3">
        <Link
          href={`/token/${market.id}`}
          className="after:absolute after:inset-0 after:z-10 flex min-w-0 items-center gap-2 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-accent-bright"
        >
          <TokenImage
            address={market.id}
            alt={`Image for ${label}`}
            size={24}
            src={image ?? undefined}
            className="shrink-0"
          />
          <span className="text-body text-pp-text truncate font-medium md:text-small">{label}</span>
          {market.symbol !== null ? (
            <span className={MUTED}>{market.symbol}</span>
          ) : null}
        </Link>
      </td>
      <td className="px-3 py-3 text-right md:text-left">
        <span className={NUMBER}>{formatPriceX18(market.priceX18)}</span>
      </td>
      <td className="px-3 py-3 md:w-[38%]">
        <ProgressAscent bps={bps} valueText={formatPercent(BigInt(bps))} />
      </td>
      <td className="hidden px-3 py-3 md:table-cell">
        <span className={NUMBER}>{formatUsdc6(market.volume6)} USDC</span>
      </td>
      <td className="hidden px-3 py-3 md:table-cell">
        <span className={MUTED}>{CREATED.format(new Date(Number(market.timestamp) * 1000))}</span>
      </td>
    </tr>
  );
}

export function MarketsTableBody({
  tab,
  initialRows,
  initialImages,
}: {
  tab: Exclude<MarketTab, "ascent">;
  initialRows: readonly MarketRow[];
  // Paired with initialRows by position, the way the rail's sparklines and
  // pictures are. A row appended by "More" has no entry here and draws the
  // identicon.
  initialImages: readonly (string | null)[];
}) {
  const [rows, setRows] = useState<readonly MarketRow[]>(initialRows);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(initialRows.length < MARKET_PAGE_SIZE);
  const [offline, setOffline] = useState(false);

  async function more() {
    const before = cursorFor(tab, rows);
    if (before === undefined) return;
    setLoading(true);
    const page = await fetchMarkets(tab, MARKET_PAGE_SIZE, before);
    setLoading(false);
    if (page === null) {
      setOffline(true);
      return;
    }
    setOffline(false);
    setRows((current) => [...current, ...page]);
    if (page.length < MARKET_PAGE_SIZE) setDone(true);
  }

  return (
    <>
      {rows.map((market, index) => (
        <MarketRowLine key={market.id} market={market} image={initialImages[index]} />
      ))}
      {offline ? (
        <tr>
          <td colSpan={5} className="px-3 py-4">
            <p className="text-small text-pp-text-muted">
              The next page did not load. The list above is what the indexer last sent.
            </p>
          </td>
        </tr>
      ) : null}
      {!done ? (
        <tr>
          <td colSpan={5} className="px-3 py-3">
            <Button size="sm" variant="ghost" disabled={loading} onClick={() => void more()}>
              {loading ? "Loading" : "More"}
            </Button>
          </td>
        </tr>
      ) : null}
    </>
  );
}

// The fifth tab. A watchlist is the viewer's own saved markets, so it can never
// be part of the server-rendered page: the revalidate window would pin one
// visitor's list into every visitor's HTML. It runs as this island instead.
export function WatchlistTableBody() {
  const { address, pending } = useSession();
  const [signInOpen, setSignInOpen] = useState(false);

  // The shared watchlist query (hooks/useWatchlist): the same cache entry the
  // token page's save button flips, so a market saved there is already on this
  // tab's list when the viewer returns to it.
  const saved = useWatchlist(address);

  const ids = saved.data;
  const rows = useQuery({
    queryKey: ["watchlist-markets", ids],
    enabled: ids !== undefined,
    queryFn: () => fetchMarketsByIds(ids ?? []),
  });

  if (pending) {
    return (
      <>
        {[0, 1, 2].map((slot) => (
          <tr key={slot}>
            <td colSpan={5} className="px-3 py-3">
              <Skeleton width="60%" height={16} />
            </td>
          </tr>
        ))}
      </>
    );
  }

  if (address === null) {
    return (
      <tr>
        <td colSpan={5} className="px-3 py-4">
          <EmptyState
            title="Sign in to see your watchlist"
            detail="A watchlist is saved per account. Reading and trading never need a session."
            action={
              <Button size="sm" onClick={() => setSignInOpen(true)}>
                Sign in
              </Button>
            }
          />
          <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
        </td>
      </tr>
    );
  }

  if (saved.isError || rows.isError || rows.data === null) {
    return (
      <tr>
        <td colSpan={5} className="px-3 py-4">
          <EmptyState
            title="The watchlist did not load"
            detail="Saved markets come from the database and their rows from the indexer. Try again in a moment."
          />
        </td>
      </tr>
    );
  }

  if (rows.data !== undefined && rows.data.length === 0) {
    return (
      <tr>
        <td colSpan={5} className="px-3 py-4">
          <EmptyState
            title="No saved markets"
            detail="Save a market from its page and it is ranked here next visit."
          />
        </td>
      </tr>
    );
  }

  if (rows.data === undefined) {
    return (
      <>
        {[0, 1, 2].map((slot) => (
          <tr key={slot}>
            <td colSpan={5} className="px-3 py-3">
              <Skeleton width="60%" height={16} />
            </td>
          </tr>
        ))}
      </>
    );
  }

  return (
    <>
      {rows.data.map((market) => (
        <MarketRowLine key={market.id} market={market} />
      ))}
    </>
  );
}
