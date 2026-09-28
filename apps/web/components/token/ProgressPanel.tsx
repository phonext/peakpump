"use client";

import { formatPercent, formatTokenAmount, formatUsdc6 } from "@peakpump/shared/format";
import { Chip } from "@peakpump/ui/Chip";
import { ProgressAscent } from "@peakpump/ui/ProgressAscent";
import { Skeleton } from "@peakpump/ui/Skeleton";
import type { Address } from "viem";
import { ReadFailure } from "@/components/token/ReadFailure";
import { useMarketParams } from "@/hooks/useMarketParams";
import { useTokenLive } from "@/hooks/useTokenLive";
import { useFlashOnChange } from "@/lib/useFlashOnChange";

// The phase chip lives here rather than in an island of its own: the phase and the
// bar are one fact from one batch, and progressBps is 10000 in PEAK by definition
// (Curve.sol:462), so a chip beside a full bar is the only reading of that bar
// which is not misleading.
//
// ASCENT takes the up tone because DESIGN.md:64 assigns --pp-up to ASCENT
// progress, which is also the colour the bar fills with. PEAK takes the accent,
// which by that same table signals neither direction: the Summit is not a price
// movement.
const FIGURE = "mono text-body text-pp-text break-all md:text-small";

export function ProgressPanel({ curve }: { curve: Address }) {
  const { data, error, refetch } = useTokenLive(curve);
  const params = useMarketParams(curve);
  const flash = useFlashOnChange(data?.sold);

  if (error !== null) return <ReadFailure error={error} onRetry={refetch} />;
  if (data === undefined) {
    return (
      <div className="flex flex-col gap-3">
        {/* The pending branch reserves the resolved branch's shape and not a flat
          bar: the four boxes below are four boxes whose heights the reads do not
          change, and a 40px reservation against a 163px column is the shift
          DESIGN.md:256 bars a skeleton from making. The phase is unknown while
          the read is out, but neither phase changes a line count — only the
          words — so every box below reserves correctly without it. */}
        <div className="flex flex-wrap items-center gap-2">
          {/* A Chip is text-small with py-1 and a hairline border: an 18.2 line,
            8 of padding and 2 of border. */}
          <span className="inline-flex">
            <Skeleton width={84} height={28.2} />
          </span>
        </div>
        {/* ProgressAscent's row: the bar is h-2 and the percentage beside it is a
          mono line box a step taller, so the row takes that line box. The figure
          changes step at a breakpoint and its line box does too. */}
        <div className="flex h-[24px] items-center gap-3 md:h-[18.2px]">
          <div className="h-2 flex-1">
            <Skeleton width="100%" height="100%" radius={false} />
          </div>
          <Skeleton width={52} height="100%" />
        </div>
        {["Sold, of the Summit target", "Raised to the Summit"].map((label) => (
          // The labels are the resolved branch's own, rendered as skeletons rather
          // than words because the phase picks between each pair and a wrong word
          // is worse than none. Both phases are one line, so the box is the same.
          <div key={label} className="flex flex-col gap-1">
            <Skeleton width={180} height={18.2} />
            <div className="h-[24px] md:h-[18.2px]">
              <Skeleton width={140} height="100%" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Number() on a bps integer is exact — progressBps is 0..10000 — and it feeds the
  // bar's geometry only. The figure a reader sees is formatPercent's, assembled in
  // BigInt, which is the pairing app/styleguide/page.tsx:275 already uses.
  const target = data.phase === "ASCENT" ? params.data?.Ts : params.data?.S;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={data.phase === "ASCENT" ? "up" : "accent"}>{data.phase}</Chip>
        {data.phase === "PEAK" ? (
          <span className="text-small text-pp-text-muted">Trading continues</span>
        ) : null}
      </div>

      <ProgressAscent bps={Number(data.progressBps)} valueText={formatPercent(data.progressBps)} />

      <div className="flex flex-col gap-1">
        <p className="text-small text-pp-text-muted">
          {data.phase === "ASCENT" ? "Sold, of the Summit target" : "Sold, of total supply"}
        </p>
        <p className={FIGURE}>
          <span
            // The bar above carries its own aria-valuetext, which a screen reader
            // holds until the control is focused; this is the figure a reader
            // scanning the panel hears move. Raised is left out: it is derived
            // from this same read and would announce twice per tick.
            aria-live="polite"
            className="pp-flash"
            data-pp-flash={flash?.dir}
            data-pp-flash-parity={flash === null ? undefined : flash.seq % 2}
          >
            {formatTokenAmount(data.sold)}
          </span>
          {target === undefined ? null : ` of ${formatTokenAmount(target)}`}
        </p>
      </div>

      {/* In PEAK this view returns the raised6 that _summit() wrote once
          (Curve.sol:397) and it stops moving, so it is labelled as the Summit
          figure rather than as a running total. */}
      <div className="flex flex-col gap-1">
        <p className="text-small text-pp-text-muted">
          {data.phase === "ASCENT" ? "Raised" : "Raised to the Summit"}
        </p>
        <p className={FIGURE}>{formatUsdc6(data.usdcRaised6)} USDC</p>
      </div>
    </div>
  );
}
