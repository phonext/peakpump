import { describe, expect, it } from "vitest";

import { metadataKey } from "@/lib/keys";
import {
  canonicalMetadataBytes,
  canonicalMetadataJson,
  metadataDocument,
  metadataImage,
  metadataRequestSchema,
  type MetadataDocument,
} from "@/lib/metadata";
import { sha256Hex } from "@/lib/sha256";
import type { R2Config } from "@/lib/r2";

const CONFIG: R2Config = {
  accountId: "acct",
  accessKeyId: "key",
  secretAccessKey: "secret",
  bucket: "peakpump",
  // A trailing slash on purpose: the value comes from a human editing .env.local.
  publicBaseUrl: "https://images.peakpump.invalid/",
};

const IMAGE_SHA = "b".repeat(64);

describe("the canonical form", () => {
  it("gives one byte string for two orderings of the same document", async () => {
    const one: MetadataDocument = {
      name: "Summit",
      symbol: "SUMMIT",
      description: "A test document.",
      image: metadataImage(CONFIG, IMAGE_SHA),
    };
    // The same fields, written in a different order, which is what two clients built
    // from the same form will do.
    const other: MetadataDocument = {
      image: metadataImage(CONFIG, IMAGE_SHA),
      description: "A test document.",
      symbol: "SUMMIT",
      name: "Summit",
    };

    expect(canonicalMetadataJson(one)).toBe(canonicalMetadataJson(other));
    expect(await sha256Hex(canonicalMetadataBytes(one))).toBe(
      await sha256Hex(canonicalMetadataBytes(other)),
    );
  });

  it("sorts keys, writes no whitespace and omits what is absent", () => {
    const json = canonicalMetadataJson({ symbol: "SUMMIT", name: "Summit" });
    // description and image are absent rather than null: a null would be a value the
    // hash covers, and a reader would have to decide what it meant.
    expect(json).toBe('{"name":"Summit","symbol":"SUMMIT"}');
  });

  it("keeps the nested image object canonical too", () => {
    const json = canonicalMetadataJson({
      name: "Summit",
      symbol: "SUMMIT",
      image: metadataImage(CONFIG, IMAGE_SHA),
    });
    // String order, so "256" and "512" precede "64" and sha256 comes last.
    expect(json.indexOf('"256"')).toBeLessThan(json.indexOf('"512"'));
    expect(json.indexOf('"512"')).toBeLessThan(json.indexOf('"64"'));
    expect(json.indexOf('"64"')).toBeLessThan(json.indexOf('"sha256"'));
  });

  it("stores the bytes it canonicalized and nothing re-serialized", async () => {
    const document: MetadataDocument = { name: "Summit", symbol: "SUMMIT" };
    const bytes = canonicalMetadataBytes(document);
    const hash = await sha256Hex(bytes);

    // What /m/[hash] serves is these bytes, so the round trip a client makes — fetch,
    // hash, compare with the path — has to close here.
    expect(new TextDecoder().decode(bytes)).toBe(canonicalMetadataJson(document));
    expect(metadataKey(hash)).toBe(`metadata/${hash}.json`);
    expect(await sha256Hex(new TextEncoder().encode(canonicalMetadataJson(document)))).toBe(hash);
  });

  it("escapes without leaving the bytes ill-formed", async () => {
    // A lone high surrogate cannot be encoded as UTF-8. JSON.stringify has been
    // required to escape it since ES2019, which is what keeps the stored bytes valid.
    const json = canonicalMetadataJson({ name: "peak \ud800", symbol: "PEAK" });
    expect(json).toContain("\\ud800");
    expect(await sha256Hex(new TextEncoder().encode(json))).toHaveLength(64);
  });
});

describe("the request schema", () => {
  it("expands one hash into the three absolute URLs", () => {
    const image = metadataImage(CONFIG, IMAGE_SHA);
    expect(image.sha256).toBe(IMAGE_SHA);
    expect(image["64"]).toBe(`https://images.peakpump.invalid/uploads/${IMAGE_SHA}/64.webp`);
    expect(image["512"]).toBe(`https://images.peakpump.invalid/uploads/${IMAGE_SHA}/512.webp`);
  });

  it("rejects an unknown key rather than dropping it", () => {
    const result = metadataRequestSchema.safeParse({
      name: "Summit",
      symbol: "SUMMIT",
      website: "https://peakpump.invalid",
    });
    // A dropped key would change the canonical bytes silently and the caller would get
    // back a URI for a document that is not the one they described.
    expect(result.success).toBe(false);
  });

  it("takes the image as a hash and not as a URL", () => {
    expect(metadataRequestSchema.safeParse({ name: "S", symbol: "S", image: IMAGE_SHA }).success).toBe(true);
    expect(
      metadataRequestSchema.safeParse({ name: "S", symbol: "S", image: IMAGE_SHA.toUpperCase() })
        .success,
    ).toBe(false);
    expect(
      metadataRequestSchema.safeParse({
        name: "S",
        symbol: "S",
        image: `https://images.peakpump.invalid/uploads/${IMAGE_SHA}/64.webp`,
      }).success,
    ).toBe(false);
  });

  it("applies the rules from packages/shared and not a copy of them", () => {
    // One rejection per rule, each with shared's own sentence, so a drift between the
    // two implementations would have to show up here as a passing input.
    const cases = [
      { input: { name: "", symbol: "SUMMIT" }, says: "Name must be 1 to 32 characters" },
      { input: { name: "a​b", symbol: "SUMMIT" }, says: "zero-width" },
      { input: { name: "Summit", symbol: "summit" }, says: "Symbol must use only A-Z and 0-9" },
      { input: { name: "Summit", symbol: "USDC" }, says: "Symbol is reserved" },
      { input: { name: "Summit", symbol: "ARCADE" }, says: "must not begin with ARC" },
      {
        input: { name: "Summit", symbol: "SUMMIT", description: "d".repeat(501) },
        says: "at most 500",
      },
    ];
    for (const { input, says } of cases) {
      const result = metadataRequestSchema.safeParse(input);
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.message).join(" ")).toContain(says);
    }
  });

  it("omits a description that was not sent", () => {
    const parsed = metadataRequestSchema.parse({ name: "Summit", symbol: "SUMMIT" });
    expect(canonicalMetadataJson(metadataDocument(parsed, null))).toBe(
      '{"name":"Summit","symbol":"SUMMIT"}',
    );
  });
});
