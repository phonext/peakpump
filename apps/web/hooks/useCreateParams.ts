"use client";

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { LIVE_POLL_MS } from "@/hooks/useTokenLive";
import { type CreateParams, readCreateParams } from "@/lib/factory-reads";
import { LIVE_READ_QUERY_OPTIONS } from "@/lib/query";
import { publicClient } from "@/lib/viem";

// No argument: there is one factory, and its address comes from the deployment
// file through @peakpump/shared/addresses. On the same cadence and the same live
// options as every other read that feeds a number next to a submit control — the
// owner can change all four, so a form left open must not charge yesterday's
// creation fee.
export function useCreateParams(): UseQueryResult<CreateParams> {
  return useQuery({
    queryKey: ["create-params"],
    queryFn: () => readCreateParams(publicClient),
    refetchInterval: LIVE_POLL_MS,
    ...LIVE_READ_QUERY_OPTIONS,
  });
}
