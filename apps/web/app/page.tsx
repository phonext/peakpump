import { formatUsdc6 } from "@peakpump/shared/format";
import { EmptyState } from "@peakpump/ui/EmptyState";
import type { Metadata } from "next";
import Link from "next/link";
import { MarketsTableBody, MarketRowLine, WatchlistTableBody } from "@/components/home/MarketsTable";
import { TokenCard } from "@/components/token/TokenCard";
import { fetchCandles } from "@/lib/graphql";
import { fetchMarketImage } from "@/lib/market-image";
import {
  ASCENT_FETCH_LIMIT,
  MARKET_PAGE_SIZE,
  MARKET_TABS,
  fetchGlobal,
  fetchMarkets,
  type MarketTab,
} from "@/lib/markets";

// A list page: every figure here is the indexer's copy, thirty seconds stale
// at most, and no quote or balance a reader could act on. The token route owns
// the live reads, and the revalidate window matches the indexer staleTime the
// client lists already use.
export const revalidate = 30;

export const metadata: Metadata = { title: "Markets" };

const RAIL_LIMIT = 8;
const SPARK_HOURS = 24;

// The tab strip is links, not the Tabs component: a tab here is a URL the
// reader can reload, share and prefetch, and the server renders whichever one
// it names. Watchlist is the fifth tab and the one exception — it is the
// viewer's own data, so its content is a client island below.
const TABS: readonly { id: MarketTab | "watchlist"; label: string }[] = [
  ...MARKET_TABS,
  { id: "watchlist" as const, label: "Watchlist" },
];

// min-h rather than padding alone: 44px is the floor DESIGN.md sets for a
// target, and the tabs are this page's primary navigation.
const TAB_BASE =
  "rounded-pp hairline bg-pp-surface-2 pp-press border inline-flex min-h-[44px] items-center px-3 py-2 text-small text-pp-text-muted";

// Each tab's empty and offline sentence states its own condition rather than
// sharing one generic line: what "nothing here" means is different per list.
const EMPTY_LINE: Record<MarketTab, string> = {
  all: "A market appears here the moment its curve is created.",
  volume: "Volume is ranked per market once the first trade fills.",
  ascent: "Markets above 80 percent of supply sold are listed here, closest first.",
  peak: "A market reaches PEAK when its whole pre-Summit supply has sold.",
};

const OFFLINE_LINE =
  "This list comes from the indexer. It is not answering right now; prices on a market's own page are read live and unaffected.";

const HEAD_BASE = "px-3 py-2 text-small font-medium text-pp-text-muted";
// wide columns drop at sm, leaving name, price and progress: the three that stay,
// and never a horizontal scroll.
const COLUMNS = [
  { label: "Token", wide: false },
  { label: "Price", wide: false },
  { label: "Progress", wide: false },
  { label: "Volume", wide: true },
  { label: "Created", wide: true },
] as const;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-pp-surface flex flex-col gap-1 px-4 py-3">
      <span className="text-small text-pp-text-muted">{label}</span>
      <span className="mono text-heading text-pp-text">{value}</span>
    </div>
  );
}

export default async function MarketsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const requested = TABS.find((tab) => tab.id === params.tab);
  const tab: MarketTab | "watchlist" = requested === undefined ? "all" : requested.id;

  // The tab's first page depends on nothing the rail reads, so it starts now and
  // is awaited last: in a serial version it waited behind the whole rail — the
  // totals, the ascent set, and then one sparkline fetch per card.
  const rowsPromise = tab === "watchlist" ? null : fetchMarkets(tab, MARKET_PAGE_SIZE);

  // The rail and the Final Ascent tab share one fetch: progress is derived,
  // not stored, so both rank the same whole-ASCENT set (markets.ts).
  const [global, ascent] = await Promise.all([
    fetchGlobal(),
    fetchMarkets("ascent", ASCENT_FETCH_LIMIT),
  ]);

  const railMarkets = ascent === null ? null : ascent.slice(0, RAIL_LIMIT);
  // One sparkline per rail card: the last day of hourly closes, a list figure
  // from the indexer like everything else on this page.
  const railSparklines =
    railMarkets === null
      ? null
      : await Promise.all(
          railMarkets.map(async (market) => {
            const candles = await fetchCandles(market.id, "1h", SPARK_HOURS);
            return candles === null ? null : candles.map((candle) => candle.close);
          }),
        );
  // One picture per rail card, resolved beside its sparkline because both are the
  // card's own data and neither depends on the other. A market whose metadataURI is
  // empty, foreign or unreachable answers null, and the identicon draws instead —
  // the same contract a failed image load falls back to inside TokenImage itself.
  const railImages =
    railMarkets === null
      ? null
      : await Promise.all(railMarkets.map(async (market) => fetchMarketImage(market.metadataURI)));

  // The server-rendered tabs' first page. Watchlist skips this: its rows are
  // the viewer's own and arrive in the island.
  const rows = rowsPromise === null ? null : await rowsPromise;

  // One picture per row, resolved the same way the rail's are: the chain stores only
  // the metadataURI, and that URI is a content address rather than the image's
  // location, so a row is not drawable until the document it names has been read.
  // The indexer is offline in the visual baseline and every null it produces is one
  // fewer read here, so an unreachable list costs nothing.
  const rowImages = await Promise.all(
    (rows ?? []).map((market) => fetchMarketImage(market.metadataURI)),
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-title font-medium text-pp-text">Markets</h1>

      {/* Platform totals, the indexer's own Global entity. The fourth figure is
          the one the product owes creators: every fee credited to every creator
          across every market. */}
      <section aria-label="Platform totals">
        {global === null ? (
          <EmptyState
            title="Platform totals are not connected"
            detail={OFFLINE_LINE}
          />
        ) : (
          <div className="hairline rounded-pp bg-pp-hairline grid grid-cols-2 gap-px overflow-hidden md:grid-cols-4">
            <Stat label="Markets" value={String(global.totalMarkets)} />
            <Stat label="Trades" value={String(global.totalTrades)} />
            <Stat label="Volume" value={`${formatUsdc6(global.totalVolume6)} USDC`} />
            <Stat label="Fees paid to creators" value={`${formatUsdc6(global.totalCreatorFees6)} USDC`} />
          </div>
        )}
      </section>

      {/* A horizontal rail above a dense table, never a grid of equal cards.
          At sm it is a scroll strip with snap points and an edge fade; the
          cards keep one width so the snap points are one card apart. */}
      <section aria-label="Final Ascent" className="flex flex-col gap-3">
        <h2 className="text-heading font-medium text-pp-text">Final Ascent</h2>
        {railMarkets === null ? (
          <EmptyState
            title="The Final Ascent rail is not connected"
            detail={OFFLINE_LINE}
          />
        ) : railMarkets.length === 0 ? (
          <EmptyState
            title="No markets in the Final Ascent"
            detail={EMPTY_LINE.ascent}
          />
        ) : (
          <ul
            className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 max-md:[mask-image:linear-gradient(to_right,transparent,black_16px,black_calc(100%-16px),transparent)]"
          >
            {/* max-md is the sm range: the theme declares no sm breakpoint
                because sm is the unprefixed base, so a max-sm variant would
                name a breakpoint that does not exist and compile to nothing. */}
            {railMarkets.map((market, index) => (
              <li
                key={market.id}
                // content-visibility keeps the cards past the fade out of paint
                // until they scroll in. The size is the card's own — 220px wide
                // like the card, so the scroll extent and snap points the
                // reader has already used do not move when a card paints in.
                className="snap-start [content-visibility:auto] [contain-intrinsic-size:220px_220px]"
              >
                <TokenCard
                  market={market}
                  sparkline={railSparklines?.[index] ?? null}
                  image={railImages?.[index] ?? null}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Markets" className="flex flex-col gap-3">
        <nav aria-label="Market lists" className="flex flex-wrap gap-2">
          {TABS.map((entry) => (
            <Link
              key={entry.id}
              href={`/?tab=${entry.id}`}
              aria-current={entry.id === tab ? "page" : undefined}
              className={
                entry.id === tab
                  ? `${TAB_BASE} bg-pp-surface text-pp-text`
                  : TAB_BASE
              }
            >
              {entry.label}
            </Link>
          ))}
        </nav>

        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-pp-hairline">
              {COLUMNS.map((column) => (
                <th
                  key={column.label}
                  scope="col"
                  className={column.wide ? `hidden md:table-cell ${HEAD_BASE}` : HEAD_BASE}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tab === "watchlist" ? (
              <WatchlistTableBody />
            ) : rows === null ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-4">
                  <EmptyState title="This list is not connected" detail={OFFLINE_LINE} />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-4">
                  <EmptyState
                    title={
                      tab === "all"
                        ? "No markets yet"
                        : tab === "volume"
                          ? "No volume to rank"
                          : tab === "ascent"
                            ? "No markets in the Final Ascent"
                            : "No markets in PEAK"
                    }
                    detail={EMPTY_LINE[tab]}
                  />
                </td>
              </tr>
            ) : tab === "ascent" ? (
              // Final Ascent ranks a derived value, so it has no stored cursor
              // to page on: the ranked set arrives whole and there is no More.
              rows.map((market, index) => (
                <MarketRowLine key={market.id} market={market} image={rowImages[index]} />
              ))
            ) : (
              <MarketsTableBody tab={tab} initialRows={rows} initialImages={rowImages} />
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
