import type { IndexerRows } from "@/hooks/useIndexerLists";

// Four renderings, not three. The three the indexer distinguishes are separated by
// lib/graphql.ts on purpose — a host that did not answer is not a market with no
// trades — and "still asking" has to be a fourth, because DESIGN.md:175-177 stops
// the shimmer on the first frame content arrives and a skeleton doubling as the
// offline state would loop forever with NEXT_PUBLIC_INDEXER_URL unset.
//
// A union rather than four string constants: the rows travel with the verdict, so a
// caller that has decided it is rendering rows holds them already and no branch has
// to re-test a value it has finished testing.
export type ListState<T> =
  | { kind: "loading" }
  | { kind: "offline" }
  | { kind: "empty" }
  | { kind: "rows"; rows: readonly T[] };

export function listState<T>(rows: IndexerRows<T>): ListState<T> {
  if (rows === undefined) return { kind: "loading" };
  if (rows === null) return { kind: "offline" };
  return rows.length === 0 ? { kind: "empty" } : { kind: "rows", rows };
}
