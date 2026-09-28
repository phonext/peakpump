"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import {
  type CandleInterval,
  type CandleRow,
  type HolderRow,
  type TradeRow,
  fetchCandles,
  fetchHolders,
  fetchTrades,
} from "@/lib/graphql";

// Four states in one value, which is why these hooks return this rather than a
// react-query result: undefined is still asking, null is the indexer did not
// answer, an empty array is a market with no rows yet, and a populated array is
// rows. lib/graphql.ts keeps null and [] apart on purpose and every consumer
// renders a different sentence for each.
export type IndexerRows<T> = readonly T[] | null | undefined;

// No options: the client's defaults in lib/query.ts are already a 30 s staleTime
// with no refetch on focus, which is what an indexer-backed list wants. Nothing
// here is a number anyone can trade on.
//
// isError collapses into null deliberately. fetchTrades and its siblings do not
// throw for an unreachable host — indexerQuery answers null — so the only way to
// land here is a row whose amount would not parse, which is an indexer that
// answered uselessly. Leaving data undefined instead would hold the panel in its
// skeleton forever, and DESIGN.md:175-177 requires that loop to stop.
function useIndexerRows<T>(
  key: readonly unknown[],
  fetcher: (() => Promise<T[] | null>) | typeof skipToken,
): IndexerRows<T> {
  const query = useQuery({ queryKey: key, queryFn: fetcher });
  return query.isError ? null : query.data;
}

// Candle and Holder are keyed on the token address and Trade on the
// Trade event's own curve field, so the two arguments are not interchangeable. An
// undefined token is useMarketParams not having answered yet, which is still
// loading and not an empty list.
export function useCandles(
  token: Address | undefined,
  interval: CandleInterval,
  limit: number,
): IndexerRows<CandleRow> {
  return useIndexerRows(
    ["candles", token ?? null, interval, limit],
    token === undefined ? skipToken : () => fetchCandles(token, interval, limit),
  );
}

export function useTrades(curve: Address, limit: number): IndexerRows<TradeRow> {
  return useIndexerRows(["trades", curve, limit], () => fetchTrades(curve, limit));
}

export function useHolders(token: Address | undefined, limit: number): IndexerRows<HolderRow> {
  return useIndexerRows(
    ["holders", token ?? null, limit],
    token === undefined ? skipToken : () => fetchHolders(token, limit),
  );
}
