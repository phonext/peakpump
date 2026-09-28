"use client";

import { formatMarketCap, formatPriceX18 } from "@peakpump/shared/format";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type PriceFormatCustom,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";

// The only importer of lightweight-charts in the repository, which is why
// components/chart/ChartFrame.tsx reaches it through a dynamic import: the library
// gzips to about 60 kB, a quarter of the whole route budget in DESIGN.md:252.
//
// It draws a series and nothing else — no fetch, no quote, no figure anyone submits a
// trade against. It takes floats because a canvas takes floats; every caller does its
// scaling in BigInt and converts at the last step.

export type ChartFormat = "price" | "marketCap";

export type ChartCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type ChartLine = { time: number; value: number };

// A horizontal line at a fixed price, drawn in the accent because a threshold is
// neither a rise nor a fall and DESIGN.md keeps green and red for those. The Summit is
// the only one, and it is a line rather than a marker because the indexer records no
// block for it: there is no position on a time axis to put one at.
export type ChartLevel = { price: number; title: string };

export type ChartSeries =
  | { kind: "candles"; data: readonly ChartCandle[] }
  | { kind: "line"; data: readonly ChartLine[] };

// DESIGN.md's tokens, read off the live element rather than restated here. font-family
// is taken from the computed style and not from the custom property behind it, because
// next/font writes its own generated family name into that property and only a
// computed font-family is guaranteed to have the substitution already done.
function readTheme(el: HTMLElement) {
  const style = getComputedStyle(el);
  const token = (name: string): string => style.getPropertyValue(name).trim();
  const rootPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return {
    family: style.fontFamily,
    // The small step of the type scale, in the pixels a canvas measures in.
    fontSize: Math.round(Number.parseFloat(token("--pp-size-small")) * rootPx),
    surface: token("--pp-surface"),
    hairline: token("--pp-hairline"),
    text: token("--pp-text"),
    muted: token("--pp-text-muted"),
    faint: token("--pp-text-faint"),
    up: token("--pp-up"),
    down: token("--pp-down"),
    accent: token("--pp-accent"),
  };
}

// The axis label, back through the shared formatter at the scale the series was built
// from, so the axis reads in the units the panels print. Tick values land on multiples
// of minMove, which is what makes the widening below exact rather than a rounding of
// its own.
function priceFormat(format: ChartFormat): PriceFormatCustom {
  if (format === "price") {
    return {
      type: "custom",
      minMove: 1e-9,
      formatter: (value: number) => formatPriceX18(BigInt(Math.round(value * 1e9)) * 10n ** 9n),
    };
  }
  return {
    type: "custom",
    minMove: 0.01,
    formatter: (value: number) => formatMarketCap(BigInt(Math.round(value * 1e6))),
  };
}

// Called at the head of the data effect rather than from a cleanup of it: React tears
// effects down in declaration order, so on unmount the chart is disposed by the effect
// above before a cleanup here would run, and removePriceLine would be reaching for a
// series that is already gone.
function replaceLevels<T extends "Candlestick" | "Line">(
  series: ISeriesApi<T>,
  previous: readonly IPriceLine[],
  levels: readonly ChartLevel[],
  color: string,
): IPriceLine[] {
  for (const held of previous) series.removePriceLine(held);
  return levels.map((level) =>
    series.createPriceLine({
      price: level.price,
      title: level.title,
      color,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
    }),
  );
}

export function ChartCanvas({
  series,
  format,
  levels,
  height,
  label,
}: {
  // Both of these are effect dependencies, so the caller memoises them: a fresh array
  // on every two-second poll would rebuild the series instead of extending it.
  series: ChartSeries;
  levels: readonly ChartLevel[];
  format: ChartFormat;
  // The skeleton in ChartFrame is this tall, so nothing shifts when the chart arrives.
  height: number;
  // A canvas has no text for a screen reader. The figures anyone acts on are printed
  // as text elsewhere on the page; this says what the shape is of.
  label: string;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const line = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLines = useRef<IPriceLine[]>([]);
  const levelColor = useRef("");
  const fitted = useRef(false);

  // A series' type and a price format are both fixed at creation — lightweight-charts
  // changes neither in place — so the two toggles above the chart rebuild it. The data
  // effect below runs after this one on the same commit and fills it.
  useEffect(() => {
    const el = box.current;
    if (el === null) return;
    const theme = readTheme(el);
    const api = createChart(el, {
      autoSize: true,
      layout: {
        // The notice this switch-off makes mandatory is rendered as text beside the
        // chart, which is what DESIGN.md:284-292 asks for anyway.
        attributionLogo: false,
        background: { type: ColorType.Solid, color: theme.surface },
        textColor: theme.muted,
        fontFamily: theme.family,
        fontSize: theme.fontSize,
      },
      grid: { vertLines: { color: theme.hairline }, horzLines: { color: theme.hairline } },
      rightPriceScale: { borderColor: theme.hairline },
      timeScale: { borderColor: theme.hairline, timeVisible: true, secondsVisible: false },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: theme.faint },
        horzLine: { color: theme.faint },
      },
    });
    chart.current = api;
    fitted.current = false;
    // Kept for the data effect, which draws the levels and has no reason of its own to
    // touch the stylesheet: a getComputedStyle on every poll is a style recalculation
    // for a colour that cannot have changed.
    levelColor.current = theme.accent;
    if (series.kind === "candles") {
      candles.current = api.addSeries(CandlestickSeries, {
        upColor: theme.up,
        downColor: theme.down,
        wickUpColor: theme.up,
        wickDownColor: theme.down,
        borderVisible: false,
        priceFormat: priceFormat(format),
        priceLineVisible: false,
      });
    } else {
      // Neutral rather than accent: DESIGN.md keeps the orange for a primary action
      // and the brand mark, and green and red mean up and down. A series is neither.
      line.current = api.addSeries(LineSeries, {
        color: theme.text,
        lineWidth: 2,
        priceFormat: priceFormat(format),
        priceLineVisible: false,
      });
    }
    return () => {
      api.remove();
      chart.current = null;
      candles.current = null;
      line.current = null;
      // The lines went with the series. Emptying the list here is what stops the effect
      // below from removing one off a chart that no longer exists.
      priceLines.current = [];
    };
  }, [series.kind, format]);

  // The whole series is replaced on every answer instead of appended to, because the
  // indexer returns a window rather than a delta. lightweight-charts keeps the visible
  // logical range across a setData, so a poll does not pull a panned chart back.
  useEffect(() => {
    const candleSeries = candles.current;
    const lineSeries = line.current;
    if (series.kind === "candles") {
      if (candleSeries === null) return;
      candleSeries.setData(series.data.map((bar) => ({ ...bar, time: bar.time as UTCTimestamp })));
      priceLines.current = replaceLevels(
        candleSeries,
        priceLines.current,
        levels,
        levelColor.current,
      );
    } else {
      if (lineSeries === null) return;
      lineSeries.setData(
        series.data.map((point) => ({ ...point, time: point.time as UTCTimestamp })),
      );
      priceLines.current = replaceLevels(lineSeries, priceLines.current, levels, levelColor.current);
    }

    const api = chart.current;
    // Once, on the first answer. Doing it on every poll would undo a zoom the reader
    // chose, and doing it never would leave a one-candle market at the default range.
    if (api !== null && !fitted.current && series.data.length > 0) {
      api.timeScale().fitContent();
      fitted.current = true;
    }
  }, [series, levels]);

  return <div ref={box} role="img" aria-label={label} className="mono w-full" style={{ height }} />;
}
