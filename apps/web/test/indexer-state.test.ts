import { describe, expect, it } from "vitest";
import type { IndexerRows } from "@/hooks/useIndexerLists";
import { type ListState, listState } from "@/lib/indexer-state";

// Four answers an indexer-backed panel has to tell apart, and the reason this release
// treats this as a correctness concern rather than a presentation one: with
// NEXT_PUBLIC_INDEXER_URL unset every list on the page takes the offline branch, and a
// panel that showed a skeleton there would shimmer for as long as the tab stayed open
// (DESIGN.md:175-177).
//
// The renderings themselves are markup, and the Vitest config here is node-only with an
// include of test/**/*.test.ts, so what is asserted is the verdict each panel switches
// on. TradesList, HoldersList and CreatorEarnings each carry four exclusive branches
// keyed on this kind, and the sentences are read in the offline proof.
const ROWS = [{ id: "0xabc-3" }, { id: "0xabc-4" }] as const;

function kindOf(rows: IndexerRows<{ id: string }>): ListState<{ id: string }>["kind"] {
  return listState(rows).kind;
}

describe("the four states of an indexer-backed list", () => {
  it("reads a pending query as still asking", () => {
    expect(kindOf(undefined)).toBe("loading");
  });

  it("reads a null as the indexer not answering", () => {
    // lib/graphql.ts answers null for an unset URL, a non-200, a GraphQL errors array
    // and a request that never completed. All four are the same fact to a reader.
    expect(kindOf(null)).toBe("offline");
  });

  it("reads an empty array as a market with no rows yet", () => {
    expect(kindOf([])).toBe("empty");
  });

  it("reads a populated array as rows, and hands them over", () => {
    const state = listState(ROWS);
    expect(state.kind).toBe("rows");
    // The rows travel with the verdict, so the branch that renders them does not
    // re-test a value it has finished testing.
    expect(state.kind === "rows" && state.rows).toBe(ROWS);
  });

  it("keeps the four apart", () => {
    const kinds = [undefined, null, [], ROWS].map((rows) => kindOf(rows));
    expect(new Set(kinds).size).toBe(4);
    // Named, so a refactor that collapsed offline into empty — the collapse this
    // suite exists to prevent — fails here and not only in a screenshot.
    expect(kinds).toEqual(["loading", "offline", "empty", "rows"]);
  });

  it("does not treat a single row as an edge of either end", () => {
    expect(kindOf([{ id: "0xabc-3" }])).toBe("rows");
  });
});
