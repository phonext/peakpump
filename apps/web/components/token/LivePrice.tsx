"use client";

import { formatPriceX18 } from "@peakpump/shared/format";
import { Skeleton } from "@peakpump/ui/Skeleton";
import type { Address } from "viem";
import { useTokenLive } from "@/hooks/useTokenLive";
import { ReadFailure } from "@/components/token/ReadFailure";
import { useFlashOnChange } from "@/lib/useFlashOnChange";

// The smallest component that can render the price, so a tick repaints these
// digits and nothing else on the page. It shares its query key with every other
// island reading this curve, so the whole page still costs one poll.
//
// break-all rather than a smaller step: priceX18 carries eighteen decimals and a
// mid-curve price can run past the rail's width, and DESIGN.md's Responsive
// section floors a number at the third step of the scale on a phone. A number that
// wraps is legible; a number that is clipped is wrong.
export function LivePrice({ curve, label = "Price" }: { curve: Address; label?: string }) {
  const { data, error, refetch } = useTokenLive(curve);
  const flash = useFlashOnChange(data?.priceX18);

  return (
    <div className="flex flex-col gap-1">
      <p className="text-small text-pp-text-muted">{label}</p>
      {error !== null ? (
        <ReadFailure error={error} onRetry={refetch} />
      ) : data === undefined ? (
        // Two line boxes, because the digits and the unit share one baseline-aligned
        // flex row and this rail never has room for both: the 18-decimal price is
        // ~240px of glyphs at the heading step, "USDC per token" ~109px more, and
        // the content box is 246px. Each wrapped line takes the tallest item on it,
        // so the unit's line is 26 and not its own 18 — the two bars below are the
        // measured 52 of content, and one 26 bar is a line short of it.
        <div className="flex flex-col">
          <Skeleton width={140} height={26} />
          <Skeleton width={120} height={26} />
        </div>
      ) : (
        <p className="flex items-baseline gap-2">
          <span
            // aria-live so a screen reader hears the tick rather than waiting for
            // a full page read; polite, because a price is information and not an
            // interruption.
            aria-live="polite"
            className="pp-flash mono text-heading break-all text-pp-text"
            data-pp-flash={flash?.dir}
            data-pp-flash-parity={flash === null ? undefined : flash.seq % 2}
          >
            {formatPriceX18(data.priceX18)}
          </span>
          {/* The unit sits outside the flashing span so the tint covers the digits
              only, and outside the number itself so no formatter has to carry it. */}
          <span className="mono text-small text-pp-text-muted">USDC per token</span>
        </p>
      )}
    </div>
  );
}
