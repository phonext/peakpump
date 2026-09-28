"use client";

import { RouteError } from "@/components/boundary/RouteError";

export default function BrandError({
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
      title="This page did not load"
      detail="The trademark and attribution text is also in the footer of every page."
    />
  );
}
