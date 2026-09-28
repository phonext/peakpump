import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

// The route's own logic — address gate, cache law, and which card the market
// data selects — tested with @vercel/og replaced, because the rasterizer is a
// wasm pipeline whose pixels the build and the browser look at, not a unit
// test. The mock serialises the element tree the route chose to render, and
// the card's own text carries that decision.

const ENDPOINT = "https://indexer.invalid/v1/graphql";

// The words a card prints, so a test can tell the market card from the generic
// one without decoding pixels.
function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node !== null && typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: unknown } }).props.children);
  }
  return "";
}

class FakeImageResponse extends Response {
  constructor(element: ReactElement) {
    super(JSON.stringify({ text: textOf(element) }), { status: 200 });
  }
}

vi.mock("@vercel/og", () => ({ ImageResponse: FakeImageResponse }));

async function loadRoute(url?: string) {
  vi.resetModules();
  if (url === undefined) {
    delete process.env.NEXT_PUBLIC_INDEXER_URL;
  } else {
    process.env.NEXT_PUBLIC_INDEXER_URL = url;
  }
  return await import("@/app/api/og/token/[address]/route");
}

const CURVE = "0xe8eac808d04a8698fb33b2c4ce6fadd4ae93f7d2";

function okToken(): Record<string, unknown> {
  return {
    data: {
      Token: [
        {
          id: CURVE,
          token: CURVE,
          creator: "0x14791697260e4d9b2e1935d29070c67e501a406d",
          marketId: 1,
          name: "Goat",
          symbol: "GOAT",
          metadataURI: null,
          phase: 0,
          y0: "1000000",
          S: "1000000",
          Ts: "1000000",
          raised6: "0",
          y: "400000",
          priceX18: "1000000000000000000",
          creatorFees6: "0",
          holderCount: 1,
          tradeCount: 1,
          volume6: "0",
          timestamp: "1",
        },
      ],
    },
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

describe("the OG image route", () => {
  it("answers 404 for a segment that is not an address", async () => {
    const { GET } = await loadRoute(ENDPOINT);
    const response = await GET(new Request("https://peakpump.test/api/og/token/not-an-address"), {
      params: Promise.resolve({ address: "not-an-address" }),
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("serves a known market with the immutable cache law", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(okToken()), { status: 200 })));
    const { GET, OG_CACHE_CONTROL } = await loadRoute(ENDPOINT);
    const response = await GET(new Request(`https://peakpump.test/api/og/token/${CURVE}`), {
      params: Promise.resolve({ address: CURVE }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(OG_CACHE_CONTROL);
    expect(OG_CACHE_CONTROL).toBe("public, max-age=31536000, s-maxage=31536000, immutable");
    const body = (await response.json()) as { text: string };
    expect(body.text).toContain("Goat");
    expect(body.text).toContain("ASCENT");
  });

  it("renders the generic card when the indexer answers nothing", async () => {
    // A GraphQL errors array is indexerQuery's null, and null is the generic
    // card — the route never 500s on an indexer that is down.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: "down" }] }), { status: 200 })),
    );
    const { GET, OG_CACHE_CONTROL } = await loadRoute(ENDPOINT);
    const response = await GET(new Request(`https://peakpump.test/api/og/token/${CURVE}`), {
      params: Promise.resolve({ address: CURVE }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(OG_CACHE_CONTROL);
    const body = (await response.json()) as { text: string };
    expect(body.text).toContain("Create a token or trade one on the curve.");
    expect(body.text).not.toContain("Goat");
  });

  it("renders the generic card for an unknown market", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: { Token: [] } }), { status: 200 })),
    );
    const { GET } = await loadRoute(ENDPOINT);
    const response = await GET(new Request(`https://peakpump.test/api/og/token/${CURVE}`), {
      params: Promise.resolve({ address: CURVE }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { text: string };
    expect(body.text).toContain("Create a token or trade one on the curve.");
  });
});
