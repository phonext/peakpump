"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import { LIVE_POLL_MS } from "@/hooks/useTokenLive";
import { type GasEstimate, type GasRequest, estimateGasCostUsdc } from "@/lib/gas";
import { LIVE_READ_QUERY_OPTIONS } from "@/lib/query";
import { publicClient } from "@/lib/viem";
import { useWalletState } from "@/lib/wallet-state";

// The caller describes the call; the account comes from the wallet, so no route
// has to thread an address into a tx builder to price it.
export type GasCall = Omit<GasRequest, "account">;

// Flat scalars on every call this product makes — an address, a bigint, a bool —
// so String covers them and, unlike the JSON.stringify react-query hashes a key
// with, it does not throw on a bigint.
function argsKey(args: readonly unknown[] | undefined): string {
  return args === undefined ? "" : args.map(String).join(",");
}

// Null while there is no wallet: eth_estimateGas executes against a balance, and
// an estimate taken at the zero address is a number for a transaction nobody is
// sending. Same cadence as every other live read, because this figure sits next
// to a submit control and DESIGN.md forbids a stale fee there.
export function useGasEstimate(call: GasCall | undefined): GasEstimate | null {
  const address = useWalletState().address;
  const request: GasRequest | undefined =
    call === undefined || address === undefined ? undefined : { ...call, account: address };
  const query = useQuery({
    queryKey: [
      "gas",
      address ?? null,
      call?.address ?? null,
      call?.functionName ?? null,
      argsKey(call?.args),
      call?.value?.toString() ?? null,
    ],
    queryFn:
      request === undefined ? skipToken : () => estimateGasCostUsdc(publicClient, request),
    refetchInterval: LIVE_POLL_MS,
    ...LIVE_READ_QUERY_OPTIONS,
  });
  return query.data ?? null;
}
