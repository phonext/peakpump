import { afterEach, describe, expect, it, vi } from "vitest";

import { sha256Hex } from "@/lib/sha256";
import { hashFromUri, verifyMetadata } from "@/lib/verify-metadata";

const BODY = '{"name":"Summit","symbol":"SUMMIT"}';

// The real Response, so ok, status and arrayBuffer() behave as the module will see them
// rather than as a hand-written stand-in decides.
function answer(body: string, status = 200): Response {
  return new Response(body, { status });
}

function stubFetch(impl: () => Promise<Response>) {
  const mock = vi.fn(impl);
  vi.stubGlobal("fetch", mock);
  return mock;
}

async function uriFor(body: string): Promise<string> {
  return `https://peakpump.invalid/m/${await sha256Hex(new TextEncoder().encode(body))}`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifying what a URI serves", () => {
  it("verifies bytes that hash to the segment in the URI", async () => {
    stubFetch(async () => answer(BODY));
    const result = await verifyMetadata(await uriFor(BODY));
    expect(result.kind).toBe("verified");
    if (result.kind !== "verified") throw new Error("unreachable, narrowed above");
    expect(result.document.symbol).toBe("SUMMIT");
  });

  it("reports divergence when the bytes changed under the same URI", async () => {
    // The case the whole helper exists for: the URI is fixed but the bytes behind it are
    // only hash-verifiable, so a page must be able to say they no longer match.
    const uri = await uriFor(BODY);
    stubFetch(async () => answer('{"name":"Summit","symbol":"OTHER"}'));
    const result = await verifyMetadata(uri);
    expect(result.kind).toBe("diverged");
    if (result.kind !== "diverged") throw new Error("unreachable, narrowed above");
    expect(result.actual).not.toBe(result.expected);
  });

  it("verifies the bytes as served and not a re-serialization of them", async () => {
    // Whitespace changes the bytes and therefore the hash. A helper that parsed and
    // re-stringified would call this verified against the hash of the compact form.
    const spaced = '{ "name": "Summit", "symbol": "SUMMIT" }';
    stubFetch(async () => answer(spaced));
    expect((await verifyMetadata(await uriFor(BODY))).kind).toBe("diverged");

    stubFetch(async () => answer(spaced));
    expect((await verifyMetadata(await uriFor(spaced))).kind).toBe("verified");
  });

  it("reports a host that did not answer as unavailable", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    expect((await verifyMetadata(await uriFor(BODY))).kind).toBe("unavailable");
  });

  it("reports a non-200 as unavailable without reading the body", async () => {
    const fetchMock = stubFetch(async () => answer(BODY, 502));
    // A proxy in front of a cold origin answers 502 with a body of its own, which would
    // hash to something and must not be compared.
    expect((await verifyMetadata(await uriFor(BODY))).kind).toBe("unavailable");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reports a matching body that is not a document", async () => {
    // Reachable, because create() takes whatever URI its caller passes and the bytes at
    // the far end need not have come from our own route.
    const notJson = "peak";
    stubFetch(async () => answer(notJson));
    const result = await verifyMetadata(await uriFor(notJson));
    expect(result.kind).toBe("unavailable");
    if (result.kind !== "unavailable") throw new Error("unreachable, narrowed above");
    expect(result.message).toContain("not a metadata document");
  });

  it("does not ask for a URI that carries no hash at all", async () => {
    const fetchMock = stubFetch(async () => answer(BODY));
    const result = await verifyMetadata("ipfs://QmSomethingOlder");
    expect(result.kind).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("finding the hash in a URI", () => {
  it("takes the last path segment and ignores what follows it", async () => {
    const hash = await sha256Hex(new TextEncoder().encode(BODY));
    expect(hashFromUri(`https://peakpump.invalid/m/${hash}`)).toBe(hash);
    expect(hashFromUri(`https://peakpump.invalid/m/${hash}?v=2`)).toBe(hash);
    expect(hashFromUri(`https://peakpump.invalid/m/${hash}#top`)).toBe(hash);
  });

  it("refuses anything that is not 64 lowercase hex", () => {
    expect(hashFromUri("https://peakpump.invalid/m/" + "A".repeat(64))).toBeNull();
    expect(hashFromUri("https://peakpump.invalid/m/" + "a".repeat(63))).toBeNull();
    expect(hashFromUri("https://peakpump.invalid/m/")).toBeNull();
  });
});
