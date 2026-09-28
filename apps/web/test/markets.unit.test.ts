import { afterEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import type { MarketRow } from "@/lib/markets";

// lib/markets.ts sits on lib/graphql.ts, which reads NEXT_PUBLIC_INDEXER_URL at
// module load. A case that changes the endpoint loads the module again, the
// pattern test/indexer.unit.test.ts established.
async function loadMarkets(url?: string) {
  vi.resetModules();
  if (url === undefined) {
    delete process.env.NEXT_PUBLIC_INDEXER_URL;
  } else {
    process.env.NEXT_PUBLIC_INDEXER_URL = url;
  }
  return await import("@/lib/markets");
}

const ENDPOINT = "https://indexer.invalid/v1/graphql";

type FetchStub = (input: string, init: RequestInit) => Promise<Response>;

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function stubFetch(impl: FetchStub) {
  const mock = vi.fn<FetchStub>(impl);
  vi.stubGlobal("fetch", mock);
  return mock;
}

// The one request every case makes: the module under test never fetches twice.
function lastQuery(fetchMock: ReturnType<typeof stubFetch>) {
  const init = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]?.[1];
  expect(init).toBeDefined();
  return JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
}

const CURVE = "0xe8eac808d04a8698fb33b2c4ce6fadd4ae93f7d2" as Address;

function makeMarket(overrides: Partial<MarketRow> = {}): MarketRow {
  return {
    id: CURVE,
    token: CURVE,
    creator: "0x14791697260e4d9b2e1935d29070c67e501a406d" as Address,
    marketId: 1,
    name: "Goat",
    symbol: "GOAT",
    metadataURI: null,
    phase: 0,
    // y0 - y = sold, the only fields progress derives from.
    y0: 1_000_000n,
    S: 1_000_000n,
    Ts: 1_000_000n,
    raised6: 0n,
    y: 400_000n,
    priceX18: 10n ** 18n,
    creatorFees6: 0n,
    holderCount: 1,
    tradeCount: 1,
    volume6: 0n,
    timestamp: 1n,
    ...overrides,
  };
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

describe("marketProgressBps", () => {
  // Pinned to Curve.sol:461's own expression: PEAK answers 10000 outright,
  // otherwise floor(sold * 10000 / Ts) with sold = y0 - y.
  it("floors a mid-curve ASCENT at the sold share", async () => {
    const { marketProgressBps } = await loadMarkets(ENDPOINT);
    // sold = 600000 of Ts = 1000000, exactly 6000 bps.
    expect(marketProgressBps(makeMarket())).toBe(6_000);
  });

  it("truncates rather than rounds", async () => {
    const { marketProgressBps } = await loadMarkets(ENDPOINT);
    // sold = 999999 of 1000000: floor is 9999, a round would say 10000.
    expect(marketProgressBps(makeMarket({ y: 1n }))).toBe(9_999);
  });

  it("answers 10000 in PEAK whatever the snapshot fields hold", async () => {
    const { marketProgressBps } = await loadMarkets(ENDPOINT);
    // y has no meaning in PEAK, so the phase alone decides — the contract's
    // own ternary.
    expect(marketProgressBps(makeMarket({ phase: 1, y: 0n }))).toBe(10_000);
  });

  it("answers 10000 on the sold-out ASCENT edge", async () => {
    const { marketProgressBps } = await loadMarkets(ENDPOINT);
    // sold == Ts is the frame _summit() fires in; 461's floor also says 10000.
    expect(marketProgressBps(makeMarket({ y: 0n }))).toBe(10_000);
  });
});

describe("fetchMarkets per-tab shape", () => {
  it("orders All on marketId descending", async () => {
    const { fetchMarkets } = await loadMarkets(ENDPOINT);
    const fetchMock = stubFetch(async () => answer({ data: { Token: [] } }));
    await fetchMarkets("all", 25);
    const sent = lastQuery(fetchMock);
    expect(sent.query).toContain("order_by: {marketId: desc}");
    expect(sent.variables).toEqual({ limit: 25 });
  });

  it("orders Volume on volume6 with a marketId tiebreak", async () => {
    const { fetchMarkets } = await loadMarkets(ENDPOINT);
    const fetchMock = stubFetch(async () => answer({ data: { Token: [] } }));
    await fetchMarkets("volume", 25);
    const sent = lastQuery(fetchMock);
    expect(sent.query).toContain("order_by: [{volume6: desc}, {marketId: desc}]");
  });

  it("filters In PEAK on phase 1", async () => {
    const { fetchMarkets } = await loadMarkets(ENDPOINT);
    const fetchMock = stubFetch(async () => answer({ data: { Token: [] } }));
    await fetchMarkets("peak", 25);
    const sent = lastQuery(fetchMock);
    expect(sent.query).toContain("phase: {_eq: 1}");
  });
});

describe("the marketId cursor", () => {
  it("sends a before query with the numeric marketId", async () => {
    const { fetchMarkets } = await loadMarkets(ENDPOINT);
    const fetchMock = stubFetch(async () => answer({ data: { Token: [] } }));
    await fetchMarkets("all", 25, { marketId: 7 });
    const sent = lastQuery(fetchMock);
    expect(sent.query).toContain("marketId: {_lt: $marketId}");
    expect(sent.variables).toEqual({ limit: 25, marketId: 7 });
  });

  it("carries the volume pair the Volume ordering sorts on", async () => {
    const { fetchMarkets } = await loadMarkets(ENDPOINT);
    const fetchMock = stubFetch(async () => answer({ data: { Token: [] } }));
    await fetchMarkets("volume", 25, { marketId: 3, volume6: 12_345n });
    const sent = lastQuery(fetchMock);
    expect(sent.query).toContain("volume6: {_lt: $volume6}");
    // Envio serves BigInt as Hasura's numeric scalar, so the cursor rides as a
    // decimal string in the variable set.
    expect(sent.variables).toEqual({ limit: 25, volume6: "12345", marketId: 3 });
  });
});

describe("the Final Ascent ranking", () => {
  it("keeps markets at or above 8000 bps, closest first", async () => {
    const { fetchMarkets } = await loadMarkets(ENDPOINT);
    // bps = (y0 - y) * 10000 / Ts with y0 = Ts = 1000000, so bps = (1000000 - y) / 100.
    // The server has already filtered to phase 0, so every stubbed row is ASCENT.
    const token = (marketId: number, y: bigint) => ({
      ...makeMarket({ marketId, y }),
      id: `${CURVE.slice(0, -2)}${marketId.toString(16).padStart(2, "0")}` as Address,
    });
    stubFetch(async () =>
      answer({
        data: {
          Token: [
            stringifyBigints(token(2, 200_000n)), // 8000 bps exactly, kept
            stringifyBigints(token(1, 50_000n)), // 9500 bps, ranked first
            stringifyBigints(token(3, 200_100n)), // 7999 bps, dropped
          ],
        },
      }),
    );
    const ranked = await fetchMarkets("ascent", 500);
    expect(ranked?.map((row) => row.marketId)).toEqual([1, 2]);
  });
});

// The wire form: every BigInt field as a string, the way graphql.ts receives it.
function stringifyBigints(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value]),
  );
}
