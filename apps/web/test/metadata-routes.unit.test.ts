import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/m/[hash]/route";
import { POST } from "@/app/api/metadata/route";
import { METADATA_CONTENT_TYPE, imageKey, metadataKey } from "@/lib/keys";
import { sha256Hex } from "@/lib/sha256";

// The bucket is a Map, so the two routes can be driven against each other: what POST
// stores is what GET serves, and the hash in the URI has to survive the round trip.
// Everything else in both handlers is real, including the canonicalizer and the limiter.
const bucket = vi.hoisted(() => ({
  objects: new Map<string, { bytes: Uint8Array; contentType: string }>(),
  configured: true,
  writeFails: false,
  writes: 0,
  reads: 0,
}));

vi.mock("@/lib/r2", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/r2")>();
  return {
    ...real,
    r2Config: () =>
      bucket.configured
        ? {
            accountId: "acct",
            accessKeyId: "key",
            secretAccessKey: "secret",
            bucket: "peakpump",
            publicBaseUrl: "https://images.peakpump.invalid",
          }
        : null,
    objectExists: async (_config: unknown, key: string) => bucket.objects.has(key),
    getObjectBytes: async (_config: unknown, key: string) => {
      bucket.reads += 1;
      return bucket.objects.get(key)?.bytes ?? null;
    },
    putObject: async (_config: unknown, key: string, bytes: Uint8Array, contentType: string) => {
      if (bucket.writeFails) throw new Error("R2 rejected the write of that key with 403");
      bucket.writes += 1;
      bucket.objects.set(key, { bytes, contentType });
    },
  };
});

// Cleared rather than assumed absent: a limiter configured in the shell would put this
// file on the network, and both routes ask the limiter before anything else.
const UPSTASH_VARS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];
const original = new Map(UPSTASH_VARS.map((name) => [name, process.env[name]]));
for (const name of UPSTASH_VARS) delete process.env[name];

const HASH = "d".repeat(64);
const DOCUMENT = { name: "Summit", symbol: "SUMMIT" };

type Body = Record<string, unknown>;

async function post(payload: unknown, headers: Record<string, string> = {}) {
  const response = await POST(
    new Request("https://peakpump.invalid/api/metadata", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
  );
  return { response, body: (await response.json()) as Body };
}

async function get(hash: string) {
  return await GET(new Request(`https://peakpump.invalid/m/${hash}`), {
    params: Promise.resolve({ hash }),
  });
}

afterEach(() => {
  bucket.objects.clear();
  bucket.configured = true;
  bucket.writeFails = false;
  bucket.writes = 0;
  bucket.reads = 0;
});

afterAll(() => {
  for (const [name, value] of original) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("posting a document", () => {
  it("stores the canonical bytes under their own digest", async () => {
    const { response, body } = await post(DOCUMENT);

    expect(response.status).toBe(201);
    expect(body.written).toBe(true);
    const sha256 = body.sha256 as string;
    expect(body.metadataURI).toBe(`https://peakpump.invalid/m/${sha256}`);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const stored = bucket.objects.get(metadataKey(sha256));
    expect(stored?.contentType).toBe(METADATA_CONTENT_TYPE);
    // The digest of what was stored, recomputed here rather than read back from the
    // answer that is meant to be checked.
    expect(await sha256Hex(stored?.bytes ?? new Uint8Array())).toBe(sha256);
  });

  it("answers the same URI for the same document without writing twice", async () => {
    const first = await post({ name: "Summit", symbol: "SUMMIT", description: "A test." });
    // The same fields in a different order, which is what two clients built from the
    // same form will send.
    const second = await post({ description: "A test.", symbol: "SUMMIT", name: "Summit" });

    expect(second.body.metadataURI).toBe(first.body.metadataURI);
    expect(second.response.status).toBe(200);
    expect(second.body.written).toBe(false);
    expect(bucket.writes).toBe(1);
  });

  it("builds the URI from the proxy's own host when there is one", async () => {
    // Behind a proxy the request URL carries the internal host, and a URI built from it
    // would go on chain pointing nowhere.
    const { body } = await post(DOCUMENT, {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "peakpump.xyz",
    });
    expect(body.metadataURI).toBe(`https://peakpump.xyz/m/${body.sha256 as string}`);
  });
});

describe("what posting refuses", () => {
  it("refuses a body past the cap", async () => {
    const { response, body } = await post(JSON.stringify({ name: "S", pad: "p".repeat(9_000) }));
    // 9 KB against a cap of 8 KiB. The largest legal document is under 2.5 KB, so
    // nothing a caller of this route can legitimately send comes near it.
    expect(response.status).toBe(413);
    expect(body.error).toBeTypeOf("string");
    expect(bucket.writes).toBe(0);
  });

  it("refuses a body that is not JSON", async () => {
    expect((await post("peak")).response.status).toBe(400);
  });

  it("refuses an unknown key and a bad symbol in the shared rules' own words", async () => {
    const unknown = await post({ ...DOCUMENT, website: "https://peakpump.invalid" });
    expect(unknown.response.status).toBe(400);

    const symbol = await post({ name: "Summit", symbol: "summit" });
    expect(symbol.response.status).toBe(400);
    // packages/shared wrote this sentence; the route passes the first issue through
    // rather than composing one of its own.
    expect(symbol.body.error).toContain("Symbol must use only A-Z and 0-9");
  });

  it("refuses an image that was never uploaded, and takes one that was", async () => {
    const absent = await post({ ...DOCUMENT, image: HASH });
    // A document is addressed by its own bytes, so one naming objects that do not exist
    // would be permanently wrong and could never be corrected in place.
    expect(absent.response.status).toBe(422);
    expect(bucket.writes).toBe(0);

    for (const size of [64, 256, 512] as const) {
      bucket.objects.set(imageKey(HASH, size), { bytes: new Uint8Array([1]), contentType: "image/webp" });
    }
    const present = await post({ ...DOCUMENT, image: HASH });
    expect(present.response.status).toBe(201);

    const stored = bucket.objects.get(metadataKey(present.body.sha256 as string));
    const document = JSON.parse(new TextDecoder().decode(stored?.bytes)) as {
      image: Record<string, string>;
    };
    // The stored document is self-describing to a third party: the hash expands to the
    // three absolute URLs here and never in the request.
    expect(document.image.sha256).toBe(HASH);
    expect(document.image["512"]).toBe(`https://images.peakpump.invalid/uploads/${HASH}/512.webp`);
  });

  it("answers 503 with no bucket, before it looks at the body", async () => {
    bucket.configured = false;
    // Unparseable on purpose: a route that parsed first would answer 400 here and a
    // caller would go looking for a mistake of their own.
    expect((await post("not json at all")).response.status).toBe(503);
  });

  it("answers 502 when the write fails rather than a URI for absent bytes", async () => {
    bucket.writeFails = true;
    const { response, body } = await post(DOCUMENT);
    expect(response.status).toBe(502);
    expect(body.metadataURI).toBeUndefined();
  });
});

describe("serving a document", () => {
  it("serves the bytes that were posted, and the URI verifies", async () => {
    const { body } = await post(DOCUMENT);
    const sha256 = body.sha256 as string;

    const response = await get(sha256);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(METADATA_CONTENT_TYPE);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, s-maxage=31536000, immutable",
    );
    // Strong, and true by construction: the body is the preimage of the name.
    expect(response.headers.get("etag")).toBe(`"${sha256}"`);

    // The round trip this suite is for: what comes back hashes to the segment in
    // the URI, so a client can prove the bytes are the ones that hash was taken from.
    const served = new Uint8Array(await response.arrayBuffer());
    expect(await sha256Hex(served)).toBe(sha256);
  });

  it("caches a miss for a minute, because that hash can become valid", async () => {
    const response = await get(HASH);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("answers 404 and not 400 for a hash that is not one, without a read", async () => {
    const response = await get("peak");
    // One meaning for this URL: it either is a document or is not. It also keeps an
    // arbitrary path segment out of a storage key.
    expect(response.status).toBe(404);
    expect(bucket.reads).toBe(0);
  });

  it("answers 404 with no bucket", async () => {
    bucket.configured = false;
    expect((await get(HASH)).status).toBe(404);
  });
});
