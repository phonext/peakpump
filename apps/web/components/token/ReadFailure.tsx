"use client";

import { Button } from "@peakpump/ui/Button";
import { describeReadError } from "@/lib/read-error";

// One sentence, one place. Six live islands each need to say that a read failed,
// and describeReadError already owns the wording; what this adds is that they all
// say it in the same voice and at the same type step.
//
// The retry is optional rather than universal: every read this sits on is a
// react-query result, and the ones on the live cadence re-read on their own
// interval already. Where a read is one-shot — market params, a vault balance —
// a failed read stays failed until something asks again, and that is what the
// control is for. The sentence alone is still the whole failure when no retry is
// handed in.
export function ReadFailure({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-small text-pp-text-muted">{describeReadError(error).message}</p>
      {onRetry === undefined ? null : (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
