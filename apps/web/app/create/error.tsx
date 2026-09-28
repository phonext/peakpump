"use client";

import { RouteError } from "@/components/boundary/RouteError";

export default function CreateError({
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
      title="The create form did not load"
      detail="No token was created. Try again."
    />
  );
}
