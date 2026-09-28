"use client";

import { priceX18 } from "@peakpump/shared/curve";
import { formatPriceX18, formatTokenAmount } from "@peakpump/shared/format";
import { Skeleton } from "@peakpump/ui/Skeleton";
import { type ReactNode, useMemo } from "react";
import type { Address } from "viem";
import { CHART_HEIGHT } from "@/components/chart/ChartFrame";
import { ReadFailure } from "@/components/token/ReadFailure";
import { useMarketParams } from "@/hooks/useMarketParams";
import { useTokenLive } from "@/hooks/useTokenLive";
import type { MarketParams } from "@/lib/curve-params";
import type { TokenLive } from "@/lib/curve-reads";
import { type Simulation, useSimulation } from "@/lib/trade-simulation";

// The route to the Summit: price against tokens sold, drawn from the three stored fields
// a market can never change. It needs no history and no indexer, which makes it the one
// chart on this page that is never empty and the only one that draws with the chain
// alone.
//
// Hand-drawn SVG rather than the chart library: that library's horizontal axis is a time
// scale and this one is a token amount. It also keeps the signature view outside the
// 60 kB the price chart already spends.

const FIGURE = "mono text-body text-pp-text break-all md:text-small";

// Sixty-five points across the domain, which is finer than the pixels a 280px frame has
// for a curve that is smooth and monotone over the whole of it.
const SAMPLES = 64;

// The reserve at any point on the route, from the invariant rather than from a formula of
// this file's own: MATH [3] conserves k = x*y across every ASCENT trade, so x is x0*y0
// over the supply that is left. Floored, like every division on chain.
function reserveAt(params: MarketParams, y: bigint): bigint {
  return (params.x0 * params.y0) / y;
}

// A position inside the box, in percent. The ratio is taken in basis points so the only
// value ever coerced to a float is an integer below ten thousand and one and never a
// chain figure; a hundredth of a percent is a third of a pixel at this frame's height.
// Both ends are clamped because the pool's rounding runs in its own favour, which can put
// the live price a unit or two above the sampled route, and a marker outside the box
// would sit in the panel's padding.
function place(value: bigint, low: bigint, high: bigint): number {
  const bps = ((value - low) * 10_000n) / (high - low);
  return Number(bps < 0n ? 0n : bps > 10_000n ? 10_000n : bps) / 100;
}

// The two ends of the route are the two ends of the frame, so the curve touches all four
// sides and no axis needs a scale printed down it. The top is the price the contract will
// hold at the Summit — y1 as stored, with its own reserve — rather than an interpolation
// towards it.
interface Frame {
  Ts: bigint;
  low: bigint;
  high: bigint;
}

function frameOf(params: MarketParams): Frame {
  return {
    Ts: params.Ts,
    low: priceX18(params.x0, params.y0),
    high: priceX18(reserveAt(params, params.y1), params.y1),
  };
}

// One pass, two paths: the line and the fill under it. The viewBox is 100 by 100 and the
// SVG stretches it to the box, which is what lets these coordinates and the CSS
// percentages the markers are positioned with be the same numbers.
function routePaths(params: MarketParams, frame: Frame): { line: string; area: string } {
  const points: string[] = [];
  for (let i = 0; i <= SAMPLES; i += 1) {
    const sold = (frame.Ts * BigInt(i)) / BigInt(SAMPLES);
    const y = params.y0 - sold;
    const price = priceX18(reserveAt(params, y), y);
    const left = place(sold, 0n, frame.Ts).toFixed(2);
    const top = (100 - place(price, frame.low, frame.high)).toFixed(2);
    points.push(`${left},${top}`);
  }
  const line = `M${points.join("L")}`;
  return { line, area: `${line}L100,100L0,100Z` };
}

// Where the panel's current quote lands on the route. Both coordinates are the quote
// struct's own outputs applied to the live reserves: a buy adds net6 and takes tokensOut,
// a sell returns tokensIn and costs the pool gross6 rather than usdcOut6.
// Nothing here re-derives an amount, and the price it produces is a marginal price on a
// chart — every figure the trade is judged by is printed by the panel from the struct.
function landing(live: TokenLive, sim: Simulation): { sold: bigint; price: bigint } {
  if (sim.side === "buy") {
    const y = live.y - sim.tokensOut;
    return { sold: live.sold + sim.tokensOut, price: priceX18(live.x + sim.net6, y) };
  }
  const y = live.y + sim.tokensIn;
  return { sold: live.sold - sim.tokensIn, price: priceX18(live.x - sim.gross6, y) };
}

// 8px, and rounded-pp on an 8px box is a circle: CSS clamps a radius at half the side, so
// the one radius DESIGN.md declares covers a dot as well as a panel. The colour repeats
// what the legend row beside it says in words, which is why it is hidden from the tree.
function Dot({ left, top, tone }: { left: number; top: number; tone: string }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-pp border border-pp-bg ${tone}`}
      style={{ left: `${left}%`, top: `${top}%` }}
    />
  );
}

function Legend({ tone, label, children }: { tone: string; label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="flex items-center gap-2 text-small text-pp-text-muted">
        <span aria-hidden className={`h-2 w-2 rounded-pp ${tone}`} />
        {label}
      </span>
      <span className={FIGURE}>{children}</span>
    </div>
  );
}

// Every rule in this frame is one physical pixel whatever the box is. The viewBox is
// stretched to fit, so an ordinary stroke would come out thicker across than down.
function Rule({
  x1,
  y1,
  x2,
  y2,
  tone,
  width = 1,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  tone: string;
  width?: number;
}) {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      strokeWidth={width}
      vectorEffect="non-scaling-stroke"
      className={tone}
    />
  );
}

export function RouteChart({ curve }: { curve: Address }) {
  const params = useMarketParams(curve);
  const live = useTokenLive(curve);
  const sim = useSimulation();

  // Keyed on the query's own object, which never changes: useMarketParams holds these
  // fields forever because none of them has a setter. So the path is built once per
  // market and a two-second price poll re-runs none of this.
  const plot = useMemo(() => {
    const data = params.data;
    if (data === undefined) return null;
    const frame = frameOf(data);
    return { frame, ...routePaths(data, frame) };
  }, [params.data]);

  if (params.isError) return <ReadFailure error={params.error} onRetry={params.refetch} />;
  if (plot === null) {
    // The block that replaces this is not the canvas alone: below it sit a caption
    // and a legend group, and a flat 280 reserves the canvas and nothing else, so
    // the panel grew by the height of both on arrival. The two legends are the two
    // that render once the live read lands alongside the params one this gate waits
    // on; a simulation adds a third, and that is a reader's own action rather than
    // content arriving.
    return (
      <div className="flex flex-col gap-3">
        <Skeleton width="100%" height={CHART_HEIGHT} radius={false} />
        <p className="text-small text-pp-text-muted">
          Price in USDC per token, against tokens sold. The route ends at the Summit.
        </p>
        <div className="flex flex-col gap-2">
          {[0, 1].map((slot) => (
            // A legend row is a text-small label beside a FIGURE, and FIGURE steps down
            // to small at md, so the row's line box is 24 below that and 18.2 above.
            <div key={slot} className="flex h-[24px] items-baseline justify-between gap-2 md:h-[18.2px]">
              <Skeleton width={88} height="100%" />
              <Skeleton width={120} height="100%" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const frame = plot.frame;
  // PEAK is not plotted: y is S - sold there rather than y0 - sold, and this domain is the
  // ASCENT domain. Past the Summit the route is the climb the market already made, so it
  // still draws and it carries no marker.
  const data = live.data;
  const ascent = data !== undefined && data.phase === "ASCENT" ? data : undefined;
  const here =
    ascent === undefined
      ? null
      : {
          left: place(ascent.sold, 0n, frame.Ts),
          top: 100 - place(ascent.priceX18, frame.low, frame.high),
          price: ascent.priceX18,
        };
  const landed = ascent === undefined || sim === null ? null : landing(ascent, sim);
  const there =
    landed === null
      ? null
      : {
          left: place(landed.sold, 0n, frame.Ts),
          top: 100 - place(landed.price, frame.low, frame.high),
          price: landed.price,
        };
  // A buy walks up the route and a sell walks down it, which is exactly what DESIGN.md
  // assigns the two directional colours to.
  const tone = sim?.side === "sell" ? "bg-pp-down" : "bg-pp-up";

  const label = `Price against tokens sold, from ${formatPriceX18(frame.low)} to ${formatPriceX18(frame.high)} USDC per token across the ${formatTokenAmount(frame.Ts)} tokens the ascent sells`;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative w-full" style={{ height: CHART_HEIGHT }}>
        <svg
          role="img"
          aria-label={label}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          {/* Depth from a surface step and a hairline, which is where DESIGN.md takes it
              from. No shadow, no gradient. */}
          <path d={plot.area} className="fill-pp-surface-2" />
          {here === null ? null : (
            <>
              <Rule x1={0} y1={here.top} x2={here.left} y2={here.top} tone="stroke-pp-hairline-top" />
              <Rule x1={here.left} y1={here.top} x2={here.left} y2={100} tone="stroke-pp-hairline-top" />
            </>
          )}
          {/* The Summit is the right edge, because the route ends where ASCENT does. Solid
              rather than dashed: a dash pattern stretches with a viewBox this one does,
              and non-scaling-stroke holds the width without holding the gaps. */}
          <Rule x1={100} y1={0} x2={100} y2={100} tone="stroke-pp-accent" width={2} />
          <path
            d={plot.line}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className="stroke-pp-text"
          />
        </svg>
        {here === null ? null : <Dot left={here.left} top={here.top} tone="bg-pp-text" />}
        {there === null ? null : <Dot left={there.left} top={there.top} tone={tone} />}
      </div>
      {/* Both axes named once, so the figures below can be bare prices. */}
      <p className="text-small text-pp-text-muted">
        Price in USDC per token, against tokens sold. The route ends at the Summit.
      </p>

      <div className="flex flex-col gap-2">
        {here === null ? null : (
          <Legend tone="bg-pp-text" label="Now">
            {formatPriceX18(here.price)}
          </Legend>
        )}
        {there === null || sim === null ? null : (
          <Legend tone={tone} label={sim.side === "buy" ? "After this buy" : "After this sell"}>
            {formatPriceX18(there.price)}
          </Legend>
        )}
        <Legend tone="bg-pp-accent" label="Summit">
          {formatPriceX18(frame.high)}
        </Legend>
      </div>

      {data?.phase === "PEAK" ? (
        <p className="text-small text-pp-text-muted">
          This market is past the Summit, so nothing is marked on the route. What is drawn
          is the ascent it climbed.
        </p>
      ) : null}

      {/* The route is the stored geometry and draws without the live read, so a failure of
          that read costs the two markers and nothing else. */}
      {live.isError ? <ReadFailure error={live.error} onRetry={live.refetch} /> : null}
    </div>
  );
}
