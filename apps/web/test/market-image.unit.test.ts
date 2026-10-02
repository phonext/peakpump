import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { fetchMarketImage } from "@/lib/market-image";
import { metadataKey } from "@/lib/keys";
import type { MetadataDocument } from "@/lib/metadata";

// lib/market-image.ts reaches the bucket rather than the indexer, so the module under
// test is isolated at the r2 boundary: the one S3 call it makes is a Map lookup, and
// no network is involved. hashFromUri and the document's own shape stay real, because
// those are the contract this module exists to read.

const ORIGIN = "https://images.peakpump.invalid";
const DOC_HASH = "d".repeat(64);
const IMAGE_HASH = "a".repeat(64);

const state = vi.hoisted(() => ({
  objects: new Map<string, Uint8Array>(),
  configured: true,
}));

vi.mock("@/lib/r2", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/r2")>();
  return {
    ...real,
    r2Config: () =>
      state.configured
        ? {
            accountId: "acct",
            accessKeyId: "key",
            secretAccessKey: "secret",
            bucket: "peakpump",
            publicBaseUrl: ORIGIN,
          }
        : null,
    getObjectBytes: async (_config: unknown, key: string) => state.objects.get(key) ?? null,
  };
});

// Cleared rather than assumed absent: a limiter configured in the shell would reach a
// network this module never touches.
const UPSTASH_VARS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];
const original = new Map(UPSTASH_VARS.map((name) => [name, process.env[name]]));
for (const name of UPSTASH_VARS) delete process.env[name];

function storeDocument(document: MetadataDocument, hash: string = DOC_HASH): void {
  state.objects.set(metadataKey(hash), new TextEncoder().encode(JSON.stringify(document)));
}

function documentWithImage(): MetadataDocument {
  return {
    name: "Summit",
    symbol: "SUMMIT",
    image: {
      sha256: IMAGE_HASH,
      "64": `${ORIGIN}/uploads/${IMAGE_HASH}/64.webp`,
      "256": `${ORIGIN}/uploads/${IMAGE_HASH}/256.webp`,
      "512": `${ORIGIN}/uploads/${IMAGE_HASH}/512.webp`,
    },
  };
}

afterEach(() => {
  state.objects.clear();
  state.configured = true;
});

afterAll(() => {
  for (const [name, value] of original) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("a market with a picture", () => {
  it("answers the 64px rendition of the document's own image", async () => {
    storeDocument(documentWithImage());

    expect(await fetchMarketImage(`https://peakpump.invalid/m/${DOC_HASH}`)).toBe(
      `${ORIGIN}/uploads/${IMAGE_HASH}/64.webp`,
    );
  });

  it("rebuilds the URL from the configured origin, not the document's stored one", async () => {
    // A deployment that moved its bucket keeps the picture it already has: the hash
    // is what the document contributes, and the origin is what the deployment has.
    const document = documentWithImage();
    document.image!["64"] = "https://old.peakpump.invalid/stale.webp";
    storeDocument(document);

    expect(await fetchMarketImage(`https://peakpump.invalid/m/${DOC_HASH}`)).toBe(
      `${ORIGIN}/uploads/${IMAGE_HASH}/64.webp`,
    );
  });

  it("ignores a query and a fragment on the URI", async () => {
    storeDocument(documentWithImage());

    expect(await fetchMarketImage(`https://peakpump.invalid/m/${DOC_HASH}?v=1#${DOC_HASH}`)).toBe(
      `${ORIGIN}/uploads/${IMAGE_HASH}/64.webp`,
    );
  });
});

describe("a market without a picture", () => {
  it("answers null for an empty URI, the indexer's own form for a market made without one", async () => {
    expect(await fetchMarketImage("")).toBeNull();
    expect(await fetchMarketImage(null)).toBeNull();
  });

  it("answers null for a URI that is not this deployment's own hash form", async () => {
    storeDocument(documentWithImage());

    // create() takes any string a caller passes, and a market made by a script can
    // carry one that is not content-addressed at all.
    expect(await fetchMarketImage("ipfs://probe")).toBeNull();
    expect(await fetchMarketImage("https://peakpump.invalid/m/short")).toBeNull();
  });

  it("answers null for a document that carries no image field", async () => {
    storeDocument({ name: "Summit", symbol: "SUMMIT" });

    expect(await fetchMarketImage(`https://peakpump.invalid/m/${DOC_HASH}`)).toBeNull();
  });

  it("answers null for a document that is not JSON", async () => {
    state.objects.set(metadataKey(DOC_HASH), new TextEncoder().encode("not a document"));

    expect(await fetchMarketImage(`https://peakpump.invalid/m/${DOC_HASH}`)).toBeNull();
  });

  it("answers null when the document is absent, so the identicon draws instead", async () => {
    // The hash names a key that was never written: a market whose metadataURI points
    // at nothing this deployment stored.
    expect(await fetchMarketImage(`https://peakpump.invalid/m/${DOC_HASH}`)).toBeNull();
  });

  it("answers null when the bucket is not configured", async () => {
    state.configured = false;
    storeDocument(documentWithImage());

    expect(await fetchMarketImage(`https://peakpump.invalid/m/${DOC_HASH}`)).toBeNull();
  });
});
