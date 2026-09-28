import { afterEach, describe, expect, it, vi } from "vitest";

// lib/graphql.ts reads NEXT_PUBLIC_INDEXER_URL once, at module load, because Next
// inlines that variable at build time and there is no later value to re-read. The
// URL is a property of the module instance, so a case that changes it loads the
// module again rather than reassigning a field.
async function loadIndexer(url?: string) {
  vi.resetModules();
  if (url === undefined) {
    delete process.env.NEXT_PUBLIC_INDEXER_URL;
  } else {
    process.env.NEXT_PUBLIC_INDEXER_URL = url;
  }
  return await import("@/lib/graphql");
}

const ENDPOINT = "https://indexer.invalid/v1/graphql";
const CURVE = "0xe8eac808d04a8698fb33b2c4ce6fadd4ae93f7d2";
const QUERY = "query Q { Trade { id } }";

type FetchStub = (input: string, init: RequestInit) => Promise<Response>;

// The real Response, so ok, status and json() behave as the module will see them
// rather than as a hand-written stand-in decides.
function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function stubFetch(impl: FetchStub) {
  const mock = vi.fn<FetchStub>(impl);
  vi.stubGlobal("fetch", mock);
  return mock;
}

const configured = process.env.NEXT_PUBLIC_INDEXER_URL;

afterEach(() => {
  vi.unstubAllGlobals();
  if (configured === undefined) {
    delete process.env.NEXT_PUBLIC_INDEXER_URL;
  } else {
    process.env.NEXT_PUBLIC_INDEXER_URL = configured;
  }
});

describe("the indexer being off", () => {
  // Both cases stub a healthy answer rather than a failing one, so a request that
  // did escape would return data and fail the null assertion too.
  it("answers null without a request when no URL is configured", async () => {
    const fetchMock = stubFetch(async () => answer({ data: { Trade: [] } }));
    const { indexerQuery } = await loadIndexer();
    expect(await indexerQuery(QUERY, {})).toBeNull();
    // SPEC 6.2 makes the indexer a convenience layer, so an unset URL is a
    // configuration rather than a failure: nothing is attempted at all.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats the empty value .env.example ships as unset", async () => {
    const fetchMock = stubFetch(async () => answer({ data: { Trade: [] } }));
    const { indexerQuery } = await loadIndexer("");
    expect(await indexerQuery(QUERY, {})).toBeNull();
    // .env.example carries NEXT_PUBLIC_INDEXER_URL= with nothing after it, which
    // arrives as "" and not as undefined, so this is the shipped default.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("a configured indexer", () => {
  it("returns the data a healthy answer carries", async () => {
    const fetchMock = stubFetch(async () => answer({ data: { Trade: [{ id: "1" }] } }));
    const { indexerQuery } = await loadIndexer(ENDPOINT);
    // Without a passing case the null cases below would hold just as well against
    // a function that returned null unconditionally.
    expect(await indexerQuery(QUERY, { limit: 1 })).toEqual({ Trade: [{ id: "1" }] });
    expect(fetchMock).toHaveBeenCalledWith(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { limit: 1 } }),
      // The deadline is the only thing stopping a hung host from holding a panel
      // in its skeleton for as long as the socket stays open.
      signal: expect.any(AbortSignal),
    });
  });

  it("answers null on a non-200 even when the body is usable", async () => {
    stubFetch(async () => answer({ data: { Trade: [{ id: "1" }] } }, 502));
    const { indexerQuery } = await loadIndexer(ENDPOINT);
    // A proxy in front of a cold indexer answers 502 with a JSON body of its own,
    // so response.ok decides and the payload is not consulted.
    expect(await indexerQuery(QUERY, {})).toBeNull();
  });

  it("answers null on an errors array even beside usable data", async () => {
    stubFetch(async () =>
      answer({ errors: [{ message: "field not found" }], data: { Trade: [] } }),
    );
    const { indexerQuery } = await loadIndexer(ENDPOINT);
    // A partial answer is what schema drift produces, and half a list is worse
    // than none: the consumer renders an empty panel instead of a wrong one.
    expect(await indexerQuery(QUERY, {})).toBeNull();
  });

  it("answers null when a 200 carries no data", async () => {
    stubFetch(async () => answer({}));
    const { indexerQuery } = await loadIndexer(ENDPOINT);
    expect(await indexerQuery(QUERY, {})).toBeNull();
  });

  it("answers null when the request never completes", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const { indexerQuery } = await loadIndexer(ENDPOINT);
    // fetch rejects rather than resolving on a DNS failure and on an abort, which
    // is the one thing the module's try/catch is there for.
    expect(await indexerQuery(QUERY, {})).toBeNull();
  });
});

describe("the list queries", () => {
  it("separates an unreachable indexer from a market with no trades", async () => {
    stubFetch(async () => answer({ data: { Trade: [] } }));
    const live = await loadIndexer(ENDPOINT);
    expect(await live.fetchTrades(CURVE, 50)).toEqual([]);
    const off = await loadIndexer();
    expect(await off.fetchTrades(CURVE, 50)).toBeNull();
  });

  it("parses the bigint fields a row carries as JSON strings", async () => {
    stubFetch(async () =>
      answer({
        data: {
          Trade: [
            {
              id: "0xabc-3",
              trader: CURVE,
              isBuy: true,
              usdcIn6: "1000000",
              usdcOut6: "0",
              tokenIn: "0",
              tokenOut: "263138414814066417862214",
              fee6: "12500",
              timestamp: "1757000000",
              blockNumber: "60437363",
              logIndex: 3,
            },
          ],
        },
      }),
    );
    const { fetchTrades } = await loadIndexer(ENDPOINT);
    const row = (await fetchTrades(CURVE, 1))?.[0];
    expect(row).toBeDefined();
    expect(row?.tokenOut).toBe(263_138_414_814_066_417_862_214n);
    expect(row?.fee6).toBe(12_500n);
    // logIndex stays a number: it is the tiebreak in an ORDER BY, not an amount.
    expect(row?.logIndex).toBe(3);
  });
});
