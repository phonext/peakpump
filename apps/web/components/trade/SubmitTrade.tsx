"use client";

import { Button } from "@peakpump/ui/Button";
import { ConnectWallet } from "@/components/wallet/ConnectWallet";
import { TradeStatus } from "@/components/trade/TradeStatus";
import type { TradeCallBuilder, TradeRun } from "@/hooks/useTrade";
import type { GasEstimate } from "@/lib/gas";

// One control, no approve step: PeakToken has no allowance path for the curve to
// spend through, so a sell is one signature and a buy is one payable
// call. There is no second press for this control to wait on.
//
// The panel decides whether the trade is ready and says why in one sentence; this
// file decides only the two things it owns — that an unpriced call cannot be sent,
// and that a wallet has to exist before a submit control means anything.
export function SubmitTrade({
  label,
  run,
  build,
  estimate,
  reason,
  settledMessage,
}: {
  label: string;
  run: TradeRun;
  // Null while the amount or the quote is not usable. The builder is a thunk because
  // the deadline inside it is read from the chain at the moment of signing.
  build: TradeCallBuilder | null;
  estimate: GasEstimate | null;
  // The panel's reason, printed verbatim. Null when the panel is happy.
  reason: string | null;
  settledMessage: string;
}) {
  const submit = run.submit;

  if (submit === undefined) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-small text-pp-text-muted">Connect a wallet to trade.</p>
        <ConnectWallet />
      </div>
    );
  }

  const busy = run.stage === "signing" || run.stage === "pending";
  // A wallet is connected, the panel has a call, and there is no gas figure for it.
  // Two states share that shape: the estimate is in flight, which is the ordinary
  // case for one round trip after every amount change, and the node refuses to price
  // the call at all. The sentence below names neither, because at the moment of
  // painting it this file cannot tell them apart — and asserting a refusal that the
  // next response contradicts is worse than describing what is missing.
  const unpriced = build !== null && estimate === null;

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="primary"
        className="w-full"
        aria-busy={busy}
        disabled={build === null || estimate === null || busy}
        onClick={() => {
          if (build === null || estimate === null) return;
          run.reset();
          submit(build, estimate);
        }}
      >
        {label}
      </Button>

      {reason === null ? null : (
        // The panel's verdict on this amount. It arrives while focus is still in
        // the amount field, so aria-describedby reads it there; this region is
        // for the moment it changes under a reader who has already moved on —
        // a quote landing, or a balance read finally answering.
        <p className="text-small text-pp-text-muted" aria-live="polite">
          {reason}
        </p>
      )}

      {unpriced ? (
        <p className="text-small text-pp-text-muted">
          This trade has no gas estimate yet, so it cannot be sent. The estimate is taken
          again every two seconds.
        </p>
      ) : null}

      {/* The gas figure in the asset the user pays it in. Gwei is a unit for a node,
          not for a person spending USDC on a chain whose native asset is USDC. */}
      {estimate === null ? null : (
        <p className="text-small text-pp-text-muted">
          Gas <span className="mono text-body text-pp-text md:text-small">{estimate.usdc}</span>{" "}
          USDC
        </p>
      )}

      <TradeStatus run={run} settledMessage={settledMessage} />
    </div>
  );
}
