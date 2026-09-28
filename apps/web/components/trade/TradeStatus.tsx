"use client";

import { formatAddress } from "@peakpump/shared/format";
import { Toast } from "@peakpump/ui/Toast";
import type { TradeRun } from "@/hooks/useTrade";
import { txUrl } from "@/lib/explorer";

// One status row for every write on this page. The Toast carries the sentence and
// this row carries the link, because Toast takes a string message and widening it
// would mean editing a shipped packages/ui file; a hash that cannot be clicked is
// worse than a link that sits beside the toast rather than inside it.
//
// A settled withdrawal emits no log, so the sentence a caller passes in is the only
// report there is: the balance reading zero on the next poll is the other half.
export function TradeStatus({ run, settledMessage }: { run: TradeRun; settledMessage: string }) {
  const hash = run.hash;
  const url = hash === undefined ? undefined : txUrl(hash);
  const failed = run.error !== null;

  const sentence = run.stage === "signing"
    ? "Confirm in your wallet."
    : run.stage === "pending"
      ? "Sent. Waiting for the receipt."
      : null;

  return (
    <div className="flex flex-col gap-1">
      {sentence === null ? null : (
        // The settled outcome arrives in the Toast, which announces itself; the
        // two stages before it change nothing on screen and would otherwise be
        // silent for as long as the wallet or the node holds the trade.
        <p className="text-small text-pp-text-muted" aria-live="polite">
          {sentence}
        </p>
      )}
      {hash !== undefined ? (
        <p className="text-small text-pp-text-muted">
          Transaction{" "}
          {url === undefined ? (
            <span className="mono text-body text-pp-text md:text-small">{formatAddress(hash)}</span>
          ) : (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              // The same vertical-padding trick components/layout/Attribution.tsx
              // uses: padding on an inline box grows the target past 44px without
              // entering the line box, so a hash inside a sentence stays in the
              // sentence.
              className="mono rounded-pp py-4 text-body text-pp-text underline underline-offset-2 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-accent-bright md:text-small"
            >
              {formatAddress(hash)}
            </a>
          )}
        </p>
      ) : null}
      <Toast
        open={run.stage === "settled" || run.stage === "failed"}
        onClose={run.reset}
        tone={failed ? "down" : "up"}
        message={run.error !== null ? run.error.message : settledMessage}
        // A failure stays until it is dismissed; a success does not need to be read
        // twice, and the numbers it changed are already back on screen.
        autoCloseMs={failed ? undefined : 4_000}
      />
    </div>
  );
}
