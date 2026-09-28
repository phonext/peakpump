"use client";

import { RouteError } from "@/components/boundary/RouteError";

export default function TokenError({
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
      title="This market did not load"
      detail="No quote was read and no trade was sent. Try again."
    />
  );
}
