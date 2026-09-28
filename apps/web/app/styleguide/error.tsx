"use client";

import { RouteError } from "@/components/boundary/RouteError";

export default function StyleguideError({
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
      title="The styleguide did not load"
      detail="A component on this page threw while rendering. Try again."
    />
  );
}
