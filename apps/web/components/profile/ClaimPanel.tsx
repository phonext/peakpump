"use client";

import { FeeVaultAbi } from "@peakpump/contracts-abi";
import { formatUsdc6 } from "@peakpump/shared/format";
import { FEE_VAULT } from "@peakpump/shared/addresses";
import { EmptyState } from "@peakpump/ui/EmptyState";
import { Skeleton } from "@peakpump/ui/Skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { isAddressEqual, type Address } from "viem";
import { SubmitTrade } from "@/components/trade/SubmitTrade";
import { useGasEstimate } from "@/hooks/useGasEstimate";
import { LIVE_POLL_MS } from "@/hooks/useTokenLive";
import { useTrade } from "@/hooks/useTrade";
import { readVaultBalance6 } from "@/lib/creator-earnings";
import { LIVE_READ_QUERY_OPTIONS } from "@/lib/query";
import { publicClient } from "@/lib/viem";
import { useWalletState } from "@/lib/wallet-state";

// The claim control the token page's earnings panel deliberately leaves to this
// page: claim() pulls the vault's whole balance for the signing address, so it
// belongs on the account that owns it. The claimable figure is a live vault
// read — money the creator acts on is never an indexer copy — and the gas
// figure beside the button is priced the same way a trade's is.

export function ClaimPanel({ address }: { address: Address }) {
  const viewer = useWalletState().address;
  const client = useQueryClient();

  const balance = useQuery({
    queryKey: ["vault-balance", address],
    queryFn: () => readVaultBalance6(publicClient, address),
    refetchInterval: LIVE_POLL_MS,
    ...LIVE_READ_QUERY_OPTIONS,
  });

  const onSettled = useCallback(() => {
    // A settled claim changes the figure this panel prices everything against,
    // so it is dropped from the cache rather than marked stale.
    void client.invalidateQueries({ queryKey: ["vault-balance", address] });
  }, [client, address]);

  const run = useTrade(onSettled);

  const owns = viewer !== undefined && isAddressEqual(viewer, address);
  // Priced only for the account that can send it, because eth_estimateGas
  // executes against a balance — the same rule useGasEstimate states.
  const claimCall = {
    address: FEE_VAULT,
    abi: FeeVaultAbi,
    functionName: "claim",
    args: [],
  } as const;
  const estimate = useGasEstimate(owns ? claimCall : undefined);

  const claimable6 = balance.data ?? null;
  // A zero balance has nothing to pull, and the vault refuses a claim of
  // nothing; the button says why rather than sending a call that reverts.
  const build =
    claimable6 !== null && claimable6 > 0n ? () => ({ ...claimCall, args: [...claimCall.args] }) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-small text-pp-text-muted">Claimable in the fee vault</p>
        {balance.isPending ? (
          <Skeleton width={140} height={26} />
        ) : balance.isError ? (
          <EmptyState
            title="The claimable figure did not load"
            detail="It is read from the fee vault contract at read time. Try again in a moment."
          />
        ) : (
          <p className="mono text-heading text-pp-text break-all">
            {formatUsdc6(claimable6 ?? 0n)} USDC
          </p>
        )}
      </div>

      {owns ? (
        <SubmitTrade
          label="Claim"
          run={run}
          build={build}
          estimate={estimate}
          reason={
            claimable6 === 0n
              ? "No fees to claim yet. A credit lands on the first trade in a market this account created."
              : null
          }
          settledMessage="Claimed. The balance moved to this wallet."
        />
      ) : (
        <p className="text-small text-pp-text-muted">
          Only this account can claim its balance, by signing as this address.
        </p>
      )}
    </div>
  );
}
