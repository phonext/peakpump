"use client";

import { RouteError } from "@/components/boundary/RouteError";

export default function MarketsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      reset={reset}
      title="The market list did not load"
      detail="Nothing was traded and nothing was cached. Try again."
    />
  );
}
