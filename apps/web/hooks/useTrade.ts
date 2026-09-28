"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { Abi, Address, Hash } from "viem";
import { type TradeErrorReport, describeTradeError } from "@/lib/curve-errors";
import { readChainSeconds } from "@/lib/deadline";
import type { GasEstimate } from "@/lib/gas";
import { publicClient } from "@/lib/viem";
import { useWalletState } from "@/lib/wallet-state";

// A deadline that cannot expire, used only to price a call. Gas does not depend on
// the value: both sides of the contract's block.timestamp <= deadline comparison
// are the same code, and the difference in calldata cost between this word and a
// real one is 24 units on a six-figure estimate, in the direction of a limit that
// is slightly generous rather than one that runs out. Pricing against a clock
// instead would make the printed gas figure vanish the moment that clock drifted
// past the deadline, which is a worse failure than 24 units of headroom.
export const PRICING_DEADLINE = 2n ** 48n - 1n;

// The chain's own second, for the one thing that needs a clock without needing it to
// be exact: the age of a trade in a list. The deadline that goes on chain is read
// fresh at the moment of signing instead (lib/deadline.ts says why). A minute is
// finer than any age this renders, so it takes a cadence of its own rather than the
// live one, and a browser clock is not used because the timestamps it is differenced
// against are the chain's.
const CLOCK_POLL_MS = 60_000;

export function useChainSeconds(): bigint | null {
  const query = useQuery({
    queryKey: ["chain-seconds"],
    queryFn: () => readChainSeconds(publicClient),
    refetchInterval: CLOCK_POLL_MS,
    staleTime: CLOCK_POLL_MS,
    refetchOnWindowFocus: false,
  });
  return query.data ?? null;
}

// The shape lib/curve-write.ts produces. Abi rather than each builder's own
// const-asserted type, because all three of them and lib/gas.ts's GasRequest meet
// here.
export interface TradeCall {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
}

// idle -> signing -> pending -> settled or failed. There is no confirming stage:
// finality on Arc is deterministic and immediate, so the receipt ends the story and
// no confirmation count is waited on.
export type TradeStage = "idle" | "signing" | "pending" | "settled" | "failed";

// The call is built after the user has committed, not before, because one of its
// arguments cannot exist earlier: the deadline is a second read off the chain at
// the moment of signing. So the caller hands over a thunk rather than a call, which
// also keeps the deadline's position — second for buy, third for sell — inside
// lib/curve-write.ts with the rest of the argument order, and lets a path that has
// no deadline at all (withdrawDeferred) build synchronously and read no clock.
export type TradeCallBuilder = () => TradeCall | Promise<TradeCall>;

export interface TradeRun {
  stage: TradeStage;
  hash: Hash | undefined;
  error: TradeErrorReport | null;
  // Undefined with no wallet connected, so a caller narrows by rendering a connect
  // control rather than a disabled submit that cannot say why it is disabled.
  submit: ((build: TradeCallBuilder, estimate: GasEstimate) => void) | undefined;
  reset: () => void;
}

// A mined revert is a real outcome and not a defensive branch: another buy can land
// between the estimate and inclusion and move the price past minTokensOut. The
// reason is not decoded — recovering it would mean re-executing the call against a
// state this transaction has already changed, and a confidently wrong sentence is
// worse than naming the outcome and pointing at the receipt.
const REVERTED: TradeErrorReport = {
  kind: "reverted",
  message: "The transaction was mined and reverted, so nothing was traded. Gas was still paid.",
  known: false,
};

export function useTrade(onSettled?: () => void): TradeRun {
  const walletClient = useWalletState().walletClient;
  const [stage, setStage] = useState<TradeStage>("idle");
  const [hash, setHash] = useState<Hash | undefined>(undefined);
  const [error, setError] = useState<TradeErrorReport | null>(null);

  const reset = useCallback(() => {
    setStage("idle");
    setHash(undefined);
    setError(null);
  }, []);

  const send = useCallback(
    async (build: TradeCallBuilder, estimate: GasEstimate) => {
      if (walletClient === undefined) return;
      setError(null);
      setHash(undefined);
      setStage("signing");
      try {
        // Inside the try, so a clock read that fails on the way to a deadline is
        // reported as the failure it is rather than as an unhandled rejection.
        const call = await build();
        const sent = await walletClient.writeContract({
          address: call.address,
          abi: call.abi,
          functionName: call.functionName,
          args: call.args,
          value: call.value,
          // The three bounds the panel priced, sent verbatim: feeCeiling in
          // packages/shared/src/chain.ts computed the two fee caps and nothing here
          // touches them, and the gas limit is the estimate whose USDC figure the
          // user read before pressing.
          maxFeePerGas: estimate.maxFeePerGas,
          maxPriorityFeePerGas: estimate.maxPriorityFeePerGas,
          gas: estimate.gasUnits,
        });
        setHash(sent);
        setStage("pending");
        const receipt = await publicClient.waitForTransactionReceipt({ hash: sent });
        if (receipt.status === "success") {
          setStage("settled");
          onSettled?.();
        } else {
          setError(REVERTED);
          setStage("failed");
        }
      } catch (thrown) {
        setError(describeTradeError(thrown));
        setStage("failed");
      }
    },
    [walletClient, onSettled],
  );

  return {
    stage,
    hash,
    error,
    submit:
      walletClient === undefined
        ? undefined
        : (build, estimate) => {
            void send(build, estimate);
          },
    reset,
  };
}
