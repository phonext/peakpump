import { formatPercent, formatPriceX18 } from "@peakpump/shared/format";
import { ProgressAscent } from "@peakpump/ui/ProgressAscent";
import Link from "next/link";
import { TokenImage } from "@/components/token/TokenImage";
import { marketProgressBps, type MarketRow } from "@/lib/markets";

// The rail card. A market is identity, one price and its distance to the
// Summit, plus the last day of closes as a single line — the stat-tile form,
// not a chart: no axes, no grid, no tooltip, and the current price printed as
// text beside it, so the sparkline carries trend only and never a value the
// reader has to estimate off pixels. The whole card is one link; hovering it
// is what prefetches the token route.

const SPARK_WIDTH = 120;
const SPARK_HEIGHT = 32;
const SPARK_STROKE = 2;
const SPARK_PAD = 2;

// One series, so there is no legend and no identity to encode: the line wears
// the recessive ink and the current period is the one accent point, which is
// the stat-tile contract the sparkline form comes with.
function Sparkline({ closes }: { closes: readonly bigint[] }) {
  if (closes.length < 2) return null;

  // Normalised to the series' own min and max, because a sparkline's job is
  // shape, not scale. A flat series (max == min, including a one-price market)
  // centres rather than dividing by zero.
  let min = closes[0]!;
  let max = closes[0]!;
  for (const close of closes) {
    if (close < min) min = close;
    if (close > max) max = close;
  }
  const span = max - min;
  const step = SPARK_WIDTH / (closes.length - 1);
  const y = (close: bigint) =>
    span === 0n
      ? SPARK_HEIGHT / 2
      : SPARK_PAD + Number(((max - close) * BigInt(SPARK_HEIGHT - SPARK_PAD * 2)) / span);
  const points = closes.map((close, index) => `${index * step},${y(close)}`).join(" ");
  const lastX = (closes.length - 1) * step;
  const lastY = y(closes[closes.length - 1]!);

  const first = closes[0]!;
  const last = closes[closes.length - 1]!;
  const direction = last > first ? "rose" : last < first ? "fell" : "was flat";

  return (
    <svg
      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
      width="100%"
      height={SPARK_HEIGHT}
      role="img"
      aria-label={`Price ${direction} over the last ${closes.length} hours`}
      className="text-pp-text-faint"
    >
      {/* non-scaling-stroke keeps the 2px line 2px however wide the card
          stretches the viewBox; the width is otherwise free of layout. */}
      <polyline
        points={points}
        fill="none"
        stroke="var(--pp-text-faint)"
        strokeWidth={SPARK_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lastX} cy={lastY} r={3} fill="var(--pp-accent-bright)" />
    </svg>
  );
}

export function TokenCard({
  market,
  sparkline,
  image,
}: {
  market: MarketRow;
  sparkline: readonly bigint[] | null;
  // The market's own picture, resolved from its metadataURI by the page. Null is the
  // identicon's case, and the component keeps its own failed-load fallback, so a
  // document whose image is unreachable still renders something rather than breaking
  // the card it sits in.
  image: string | null;
}) {
  const bps = marketProgressBps(market);
  const label = market.name ?? market.symbol ?? market.id;

  return (
    <Link
      href={`/token/${market.id}`}
      className="hairline rounded-pp bg-pp-surface pp-press pp-lift flex w-[220px] shrink-0 flex-col gap-3 p-4 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-accent-bright"
    >
      <div className="flex items-center gap-3">
        <TokenImage address={market.id} alt={`Image for ${label}`} size={64} src={image ?? undefined} />
        <div className="min-w-0">
          <p className="text-body text-pp-text truncate font-medium">{label}</p>
          {market.symbol !== null ? (
            <p className="mono text-small text-pp-text-muted">{market.symbol}</p>
          ) : null}
        </div>
      </div>
      <p className="mono text-heading text-pp-text">{formatPriceX18(market.priceX18)}</p>
      <ProgressAscent bps={bps} valueText={formatPercent(BigInt(bps))} />
      {sparkline !== null ? <Sparkline closes={sparkline} /> : null}
    </Link>
  );
}
