"use client";

import { formatMarketCap } from "@peakpump/shared/format";
import { Skeleton } from "@peakpump/ui/Skeleton";
import type { Address } from "viem";
import { ReadFailure } from "@/components/token/ReadFailure";
import { useTokenLive } from "@/hooks/useTokenLive";
import { useFlashOnChange } from "@/lib/useFlashOnChange";

// marketCap6() executed on chain, which is MATH [10] evaluated by the contract
// itself. The chart's market-cap series is a different thing and says so where it
// is drawn: this is the figure, and it is the only one that appears as one.
export function MarketCap({ curve }: { curve: Address }) {
  const { data, error, refetch } = useTokenLive(curve);
  const flash = useFlashOnChange(data?.marketCap6);

  return (
    <div className="flex flex-col gap-1">
      <p className="text-small text-pp-text-muted">Market cap</p>
      {error !== null ? (
        <ReadFailure error={error} onRetry={refetch} />
      ) : data === undefined ? (
        <Skeleton width={110} height={26} />
      ) : (
        <span
          // The same tick the price above announces, on the figure that sits
          // beside it. Both come from the one live read, so they move together.
          aria-live="polite"
          className="pp-flash mono text-heading text-pp-text"
          data-pp-flash={flash?.dir}
          data-pp-flash-parity={flash === null ? undefined : flash.seq % 2}
        >
          {formatMarketCap(data.marketCap6)}
        </span>
      )}
    </div>
  );
}
