"use client";

import { formatPriceX18 } from "@peakpump/shared/format";
import { Button } from "@peakpump/ui/Button";
import { Dialog } from "@peakpump/ui/Dialog";
import { Skeleton } from "@peakpump/ui/Skeleton";
import { useState } from "react";
import type { Address } from "viem";
import { LivePrice } from "@/components/token/LivePrice";
import { TradePanel } from "@/components/trade/TradePanel";
import { useTokenLive } from "@/hooks/useTokenLive";
import { useFlashOnChange } from "@/lib/useFlashOnChange";

// DESIGN.md:223-225 replaces the trade panel with this at sm: a bar at the bottom edge
// carrying the live price and one control that opens the panel as a sheet, and the sheet
// never covers the number the trade is judged by. That number is therefore inside the
// sheet too, in the footer the Dialog holds outside its own scroll area — a phone in
// landscape is 390px tall and this panel is taller than that, so a price that lived only
// on the bar behind the sheet would be covered by it. It lands at the same height on the
// screen either way, which is the point.
//
// Sticky rather than fixed, and the last child of the page's own column. A fixed bar is
// out of flow, so it needs a spacer somewhere to keep the last thing on the page out from
// under it, and the last thing on this page is the footer's attribution — which is in the
// root layout and cannot be padded from here. Sticky reserves its own height at the end of
// the column instead: it holds the viewport's bottom edge for the whole page and then
// scrolls away with the column it belongs to, so the footer below is never covered.
// Nothing above it carries a transform (app/layout.tsx), which DESIGN.md:192-194 requires
// of an ancestor of a sticky element. z-30 leaves the sheet and the toast above it, both
// at z-50.

export function StickyTradeBar({ curve }: { curve: Address }) {
  const [open, setOpen] = useState(false);
  const { data, error } = useTokenLive(curve);
  const flash = useFlashOnChange(data?.priceX18);

  return (
    <>
      <div
        className={[
          "sticky bottom-0 z-30 -mx-4 flex items-center justify-between gap-3 md:hidden",
          // -mx-4 cancels the page's own gutter so the bar reaches both edges. The notch
          // is the layout's business and is already taken out of this box's width; the
          // home indicator is not, and it sits under this element.
          "border-t border-pp-hairline-top bg-pp-surface px-4 pt-3",
          "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        ].join(" ")}
      >
        {/* min-w-0 is what lets the number wrap instead of pushing the control off the
            edge. Body step, the floor DESIGN.md puts a number at on a phone, and a
            twenty-character price still fits on one line at 360px. */}
        <div className="flex min-w-0 flex-col">
          <span className="text-small text-pp-text-muted">Price</span>
          {error !== null ? (
            // The identity panel above prints why. Here there is room for the fact only.
            <span className="text-small text-pp-text-muted">Price unavailable</span>
          ) : data === undefined ? (
            <Skeleton width={120} height={22} />
          ) : (
            <span
              // The same announcement LivePrice makes, on the one price a phone
              // user can see while the sheet is closed. Without it a tick changes
              // the number on the bar and nothing is read.
              aria-live="polite"
              className="pp-flash mono text-body break-all text-pp-text"
              data-pp-flash={flash?.dir}
              data-pp-flash-parity={flash === null ? undefined : flash.seq % 2}
            >
              {formatPriceX18(data.priceX18)}
            </span>
          )}
        </div>

        <Button
          variant="primary"
          className="shrink-0"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          Trade
        </Button>
      </div>

      {/* Mounted only while it is open, which is what clears the route chart's marker
          when it closes: the panel publishes null as it unmounts. */}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Trade"
        footer={
          <div className="w-full">
            <LivePrice curve={curve} />
          </div>
        }
      >
        <TradePanel curve={curve} />
      </Dialog>
    </>
  );
}
