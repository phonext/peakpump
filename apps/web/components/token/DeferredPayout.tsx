"use client";

import { formatUsdcWei } from "@peakpump/shared/format";
import { Button } from "@peakpump/ui/Button";
import type { Address } from "viem";
import { TradeStatus } from "@/components/trade/TradeStatus";
import { useGasEstimate } from "@/hooks/useGasEstimate";
import { useTokenLive } from "@/hooks/useTokenLive";
import { useTrade } from "@/hooks/useTrade";
import { withdrawDeferredCall } from "@/lib/curve-write";

// Read from curve.deferred(user) in the live batch and never from the indexer: this
// is money the reader is owed, so it comes off the chain at read time like every
// other figure they can act on.
//
// The amount is exact rather than capped, and that is a fact about the credit and
// not about the formatter: the contract credits exactly refund6 * 1e12, a whole
// multiple of 1e12, so formatUsdcWei's six-digit cap cannot truncate a digit that
// exists. The raw integer sits beside it anyway, because a recovery path should let
// someone check the number against the chain themselves.
export function DeferredPayout({ curve }: { curve: Address }) {
  const { data } = useTokenLive(curve);
  const run = useTrade();
  const deferred = data?.deferredWei ?? null;
  const owed = deferred === null || deferred === 0n ? null : deferred;
  const estimate = useGasEstimate(owed === null ? undefined : withdrawDeferredCall(curve));

  // Kept mounted through a settled withdrawal, which is what lets its report be
  // read: the balance goes to zero on the next poll and the panel would otherwise
  // take its own toast off screen with it. Dismissing resets the run, and then this
  // returns null.
  if (owed === null && run.stage === "idle") return null;

  return (
    <div className="hairline rounded-pp bg-pp-surface-2 flex flex-col gap-3 p-3">
      <p className="text-small text-pp-text-muted">Deferred payout</p>

      {owed === null ? (
        <p className="text-small text-pp-text-muted">
          Nothing is deferred on this market any more.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <p className="mono text-body text-pp-text break-all md:text-small">
              {formatUsdcWei(owed)} USDC
            </p>
            {/* The integer as the contract holds it, so the figure above can be
                checked against the chain without trusting this formatter. */}
            <p className="mono text-body text-pp-text-faint break-all md:text-small">
              {owed.toString()} wei
            </p>
          </div>

          <p className="text-small text-pp-text-muted">
            A transfer to your address did not go through, so the curve credited the amount
            here instead of losing it. Withdraw it whenever you like.
          </p>

          <Button
            variant="primary"
            onClick={() => {
              if (run.submit === undefined || estimate === null) return;
              run.submit(() => withdrawDeferredCall(curve), estimate);
            }}
            disabled={
              run.submit === undefined ||
              estimate === null ||
              run.stage === "signing" ||
              run.stage === "pending"
            }
          >
            Withdraw
          </Button>

          {estimate === null ? null : (
            <p className="text-small text-pp-text-muted">
              Gas <span className="mono text-body text-pp-text md:text-small">{estimate.usdc}</span>{" "}
              USDC
            </p>
          )}
        </>
      )}

      <TradeStatus
        run={run}
        settledMessage="Withdrawn. The deferred balance reads zero on the next read."
      />
    </div>
  );
}
