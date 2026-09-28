"use client";

import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useState } from "react";
import type { Address } from "viem";
import { LIVE_POLL_MS } from "@/hooks/useTokenLive";
import {
  type BuyQuoteRead,
  type SellQuoteRead,
  readBuyQuote,
  readSellQuote,
} from "@/lib/curve-quote";
import { LIVE_READ_QUERY_OPTIONS } from "@/lib/query";
import { publicClient } from "@/lib/viem";

// Long enough that a typed digit does not cost a round trip, short enough that
// the number lands before a finger reaches the submit control.
const DEBOUNCE_MS = 250;

// Three fields, not react-query's whole result: quote is the deferred value and
// data is not, so returning both would leave two versions of one number in reach
// of a render. refetch is the one non-value that comes along, because a failed
// quote is the one read on this cadence that a user may want to ask for by hand.
export interface QuoteState<T> {
  quote: T | undefined;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
}

function useDebounced(value: bigint | undefined, ms: number): bigint | undefined {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

// The value the query is keyed on and the value it submits are the same bigint,
// so the number on screen is always the one the contract answered for that exact
// input. useDeferredValue governs when the answer is painted, never what it says.
function useQuoteRead<T>(
  name: string,
  curve: Address,
  amount: bigint | undefined,
  read: (amount: bigint) => Promise<T>,
): QuoteState<T> {
  const debounced = useDebounced(amount, DEBOUNCE_MS);
  const amountIn = debounced ?? 0n;
  const query = useQuery({
    // Stringified because react-query hashes a key with JSON.stringify, which
    // throws on a bigint.
    queryKey: [name, curve, amountIn.toString()],
    queryFn: () => read(amountIn),
    // Zero only. An amount under the minimum is quoted deliberately: MATH.md:343
    // has quoteBuy return BelowMinimum instead of reverting, and that status is
    // what produces the sentence. An empty field is not an error, so it asks
    // nothing.
    enabled: amountIn > 0n,
    refetchInterval: LIVE_POLL_MS,
    ...LIVE_READ_QUERY_OPTIONS,
  });
  return {
    quote: useDeferredValue(query.data),
    isFetching: query.isFetching,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}

export function useBuyQuote(curve: Address, usdcIn6: bigint | undefined): QuoteState<BuyQuoteRead> {
  return useQuoteRead("quote-buy", curve, usdcIn6, (amount) =>
    readBuyQuote(publicClient, curve, amount),
  );
}

export function useSellQuote(
  curve: Address,
  tokensIn: bigint | undefined,
): QuoteState<SellQuoteRead> {
  return useQuoteRead("quote-sell", curve, tokensIn, (amount) =>
    readSellQuote(publicClient, curve, amount),
  );
}
