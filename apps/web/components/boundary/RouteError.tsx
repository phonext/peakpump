"use client";

import { Button } from "@peakpump/ui/Button";
import { EmptyState } from "@peakpump/ui/EmptyState";

export interface RouteErrorProps {
  // Next hands a boundary the thrown error and, in a production build, a digest that
  // identifies it in the server log. The message is not shown: production replaces it
  // with a generic string anyway, and the digest is the part that can be looked up.
  error: Error & { digest?: string };
  reset: () => void;
  title: string;
  detail: string;
}

// One component behind all six error.tsx files, which Next requires to be separate
// client modules. Each route passes its own two sentences and nothing else differs.
export function RouteError({ error, reset, title, detail }: RouteErrorProps) {
  return (
    <div className="flex flex-col items-center gap-3">
      <EmptyState
        title={title}
        detail={detail}
        action={
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
        }
      />
      {error.digest === undefined ? null : (
        <p className="mono text-small text-pp-text-faint">{error.digest}</p>
      )}
    </div>
  );
}
