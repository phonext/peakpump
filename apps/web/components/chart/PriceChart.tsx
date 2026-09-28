"use client";

import { PRICE_SCALE, marketCap6, priceX18 } from "@peakpump/shared/curve";
import { Button } from "@peakpump/ui/Button";
import { EmptyState } from "@peakpump/ui/EmptyState";
import { Skeleton } from "@peakpump/ui/Skeleton";
import { Tabs } from "@peakpump/ui/Tabs";
import { useMemo, useState } from "react";
import type { Address } from "viem";
import type { ChartFormat, ChartLevel, ChartSeries } from "@/components/chart/ChartCanvas";
import { CHART_HEIGHT, ChartFrame } from "@/components/chart/ChartFrame";
import { Attribution } from "@/components/layout/Attribution";
import { ReadFailure } from "@/components/token/ReadFailure";
import { useCandles } from "@/hooks/useIndexerLists";
import { useMarketParams } from "@/hooks/useMarketParams";
import type { MarketParams } from "@/lib/curve-params";
import type { CandleInterval } from "@/lib/graphql";
import { listState } from "@/lib/indexer-state";

// Four buckets and no fifth: CandleInterval is a closed union in lib/graphql.ts
// and the indexer aggregates exactly these, so a control offering a fifth would query
// something that does not exist.
const INTERVALS: readonly CandleInterval[] = ["1m", "5m", "1h", "1d"];

// Enough buckets to fill the frame at any of the four without asking for a year of
// one-minute candles that no pixel could show.
const LIMIT = 300;

// Where a chain integer becomes a float, because a canvas takes floats. Both converters
// floor first, so the coercion is of an integer a double holds exactly rather than of an
// eighteen-digit one: a billionth of a USDC per token, and a hundredth of a USDC of
// market cap, are both far finer than a pixel. No figure on this chart is one anyone
// submits — the panel beside it prints those from the curve's own quote.

function toPrice(priceValueX18: bigint): number {
  return Number(priceValueX18 / 1_000_000_000n) / 1e9;
}

function toCap(cap6: bigint): number {
  return Number(cap6 / 10_000n) / 100;
}

// The live market cap on this page is curve.marketCap6(), MATH [10] executed on chain.
// A candle carries a price and nothing else, and a cap is the x/y ratio times S, so
// this is the only route from a price series to a cap series: [10] algebraically,
// though not literally. It is labelled a chart series and never printed beside a
// submit control.
function capFromClose(closeX18: bigint, S: bigint): bigint {
  return (closeX18 * S) / PRICE_SCALE;
}

// MATH [3] gives x1*y1 = x0*y0, so the reserve at the Summit follows from three stored
// fields, and the price and the cap there come from the shared [9] and [10].
function summitLevel(params: MarketParams | undefined, format: ChartFormat): number | null {
  if (params === undefined) return null;
  const x1 = (params.x0 * params.y0) / params.y1;
  return format === "price"
    ? toPrice(priceX18(x1, params.y1))
    : toCap(marketCap6(x1, params.y1, params.S));
}

export function PriceChart({ curve }: { curve: Address }) {
  const [interval, chooseInterval] = useState<CandleInterval>("5m");
  const [format, setFormat] = useState<ChartFormat>("price");
  const params = useMarketParams(curve);
  // Candles are keyed on the token and the token is the params read's answer, so this
  // query is skipped until that one lands (hooks/useIndexerLists.ts).
  const rows = useCandles(params.data?.token, interval, LIMIT);
  // Memoised on the query's own array, which is what gives the series below a stable
  // identity: it is an effect dependency inside the chart, and a fresh object on every
  // render would rebuild the series rather than extend it.
  const state = useMemo(() => listState(rows), [rows]);
  const S = params.data?.S;

  const series = useMemo<ChartSeries | null>(() => {
    if (state.kind !== "rows") return null;
    if (format === "price") {
      return {
        kind: "candles",
        data: state.rows.map((row) => ({
          // A bucket boundary, not a fill time: the indexer aggregates on it and a time
          // axis has no other coordinate. Ordering stays the indexer's own.
          time: Number(row.bucketStart),
          open: toPrice(row.open),
          high: toPrice(row.high),
          low: toPrice(row.low),
          close: toPrice(row.close),
        })),
      };
    }
    if (S === undefined) return null;
    return {
      kind: "line",
      data: state.rows.map((row) => ({
        time: Number(row.bucketStart),
        value: toCap(capFromClose(row.close, S)),
      })),
    };
  }, [state, format, S]);

  const levels = useMemo<ChartLevel[]>(() => {
    const price = summitLevel(params.data, format);
    return price === null ? [] : [{ price, title: "Summit" }];
  }, [params.data, format]);

  // First, because the token address, S and the Summit all come from this one read: if
  // it failed there is nothing to ask the indexer for either, and the skeleton below
  // would shimmer for as long as the page stayed open.
  if (params.isError) return <ReadFailure error={params.error} onRetry={params.refetch} />;

  if (state.kind === "offline") {
    return (
      <EmptyState
        title="Price history is not connected"
        detail="Candles come from the indexer. The price, the progress to the Summit and every quote on this page are read from the curve and are unaffected."
      />
    );
  }

  if (state.kind === "empty") {
    return (
      <EmptyState
        title="No price history yet"
        detail="This market has not been traded. The first buy opens the first candle."
      />
    );
  }

  // The remaining not-ready state, and the one the shimmer is for: the params read has
  // not answered, so neither has the candle query it keys.
  if (series === null) {
    // The block that replaces this is not the canvas alone: two format buttons, a
    // four-item interval strip, the canvas, then the attribution below it. Reserving
    // the canvas alone left every one of those unreserved, and the panel grew by the
    // buttons, the strip and the notice on arrival. The strip's height is its own
    // p-1 plus a 44px tab, and the buttons are the 44px sm floor.
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {[72, 104].map((width) => (
            <span key={width} className="inline-flex min-h-[44px] items-center">
              <Skeleton width={width} height={30} />
            </span>
          ))}
        </div>
        <div className="hairline rounded-pp bg-pp-surface flex gap-2 p-1">
          {[0, 1, 2, 3].map((slot) => (
            <span key={slot} className="min-h-[44px] min-w-[44px] flex-1">
              <Skeleton width="100%" height="100%" />
            </span>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton width="100%" height={CHART_HEIGHT} radius={false} />
          <Skeleton width="100%" height={18.2} />
        </div>
      </div>
    );
  }

  const symbol = params.data?.symbol;
  const unit = symbol === undefined ? "" : ` for ${symbol}`;
  const label =
    format === "price"
      ? `Candlestick price history${unit}, ${interval} buckets, USDC per token`
      : `Market cap series${unit}, ${interval} buckets, USDC`;

  const chart = (
    <div className="flex flex-col gap-2">
      <ChartFrame
        series={series}
        levels={levels}
        format={format}
        height={CHART_HEIGHT}
        label={label}
      />
      {/* The library's own attribution logo is switched off inside the canvas, so the
          notice it would have stood in for sits here beside the chart, verbatim and with
          its link. The footer block is separate and independent of this one. */}
      <Attribution className="text-small text-pp-text-muted" />
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Chart series" className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={format === "price" ? "primary" : "secondary"}
          aria-pressed={format === "price"}
          onClick={() => setFormat("price")}
        >
          Price
        </Button>
        <Button
          size="sm"
          variant={format === "marketCap" ? "primary" : "secondary"}
          aria-pressed={format === "marketCap"}
          onClick={() => setFormat("marketCap")}
        >
          Market cap
        </Button>
      </div>

      {/* One node in all four items, which is what keeps the canvas mounted across an
          interval change: React reconciles it at the same position, so the series is
          replaced rather than the chart rebuilt. */}
      <Tabs
        label="Candle interval"
        value={interval}
        onValueChange={(next) => {
          // Tabs speaks in strings and these four ids came from the union above, so
          // matching one back narrows it without an assertion.
          const picked = INTERVALS.find((id) => id === next);
          if (picked !== undefined) chooseInterval(picked);
        }}
        items={INTERVALS.map((id) => ({ id, label: id, content: chart }))}
      />
    </div>
  );
}
