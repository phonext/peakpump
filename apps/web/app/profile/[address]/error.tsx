"use client";

import { RouteError } from "@/components/boundary/RouteError";

export default function ProfileError({
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
      title="This profile did not load"
      detail="No balance was read. Try again."
    />
  );
}
