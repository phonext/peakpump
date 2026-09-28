"use client";

import { formatTokenAmount } from "@peakpump/shared/format";
import { Skeleton } from "@peakpump/ui/Skeleton";
import type { Address } from "viem";
import { AddressLink } from "@/components/token/AddressLink";
import { ReadFailure } from "@/components/token/ReadFailure";
import { useMarketParams } from "@/hooks/useMarketParams";

// What PeakToken writes at initialize and never changes, plus its own address, which is
// why this island is the one on the page that does not poll. Name and symbol stay on
// their own lines rather than sharing one: the skeletons below reserve a box each, and a
// wrapped pair would land on one line for a short name and two for a long one, which is
// a layout shift the exact-size skeleton exists to prevent.
export function TokenIdentity({ curve }: { curve: Address }) {
  const { data, error, refetch } = useMarketParams(curve);

  if (error !== null) return <ReadFailure error={error} onRetry={refetch} />;
  if (data === undefined) {
    return (
      <div className="flex flex-col gap-2">
        {/* Each height below is the resolved line box, not the type step's size: a
          heading at 20px carries a 1.3 line height (26) and small at 13px a 1.4 one
          (18.2), and a skeleton reserving the step alone is a fraction short of the
          line that replaces it. Two such fractions in this stack are what made the
          pending block round one pixel below the resolved one. */}
        <Skeleton width={160} height={26} />
        <Skeleton width={96} height={18.2} />
        {/* The two rows below label themselves, so the label is printed and only the
            figure shimmers — the same shape AddressLink holds while it waits. */}
        <div className="flex flex-col gap-1">
          <p className="text-small text-pp-text-muted">Total supply</p>
          {/* The figure's own class changes step at a breakpoint, so its line box does
            too: body at 16px is a 24 line and small at 13px an 18.2 one. One fixed
            height is right at one width and six pixels tall at the other; the small
            step's line box is fractional, so its wrapper carries the fraction. */}
          <div className="h-[24px] md:h-[18.2px]">
            <Skeleton width={140} height="100%" />
          </div>
        </div>
        <AddressLink label="Token" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-heading font-medium text-pp-text">{data.name}</p>
      <p className="mono text-small text-pp-text-muted">{data.symbol}</p>
      {/* Stated here and not only inside the badge below it: the badge proves the
          supply cannot change, and this is the number it cannot change from. */}
      <div className="flex flex-col gap-1">
        <p className="text-small text-pp-text-muted">Total supply</p>
        <p className="mono text-body text-pp-text break-all md:text-small">
          {formatTokenAmount(data.totalSupply)}
        </p>
      </div>
      {/* The token, beside the curve the page prints above it. SafetyBadges proves this
          address is a clone of the token implementation, and a proof about an address
          the page never shows is one a reader cannot check. */}
      <AddressLink label="Token" address={data.token} />
    </div>
  );
}
