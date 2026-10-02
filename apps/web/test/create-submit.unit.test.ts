import { afterEach, describe, expect, it, vi } from "vitest";

import { storeIdentityDocument, UPLOAD_UNREACHABLE, METADATA_UNREACHABLE } from "@/lib/create-submit";
import type { CreateState } from "@/lib/create-state";

// The submit sequence is two fetches against routes whose contracts are fixed, so it
// is tested at the fetch boundary: a stub answers for each route and the sequence's
// own decisions are what is asserted. No component, no wallet, no DOM — the component
// is thin, and what it does after this is a transaction this module never sees.

const METADATA_URI = `https://peakpump.invalid/m/${"c".repeat(64)}`;
const IMAGE_SHA = "a".repeat(64);

type FetchStub = (input: string, init?: RequestInit) => Promise<Response>;

interface Stubs {
  upload: ReturnType<typeof vi.fn<FetchStub>>;
  metadata: ReturnType<typeof vi.fn<FetchStub>>;
  calls: { input: string; init: RequestInit | undefined }[];
}

// Each route gets its own stub, and every call is recorded in one list so a test can
// ask "what was sent, in what order" without reconstructing it from two mocks.
function stubRoutes(upload: FetchStub, metadata: FetchStub): Stubs {
  const calls: { input: string; init: RequestInit | undefined }[] = [];
  const record = (impl: FetchStub) =>
    vi.fn<FetchStub>(async (input, init) => {
      calls.push({ input, init });
      return await impl(input, init);
    });
  const uploadMock = record(upload);
  const metadataMock = record(metadata);
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    if (input.includes("/api/upload")) return await uploadMock(input, init);
    return await metadataMock(input, init);
  });
  return { upload: uploadMock, metadata: metadataMock, calls };
}

function json(body: unknown, status = 200): Response {
  // Response derives ok from the status, so it is not passed: stating it twice would
  // be a second place a status could disagree with its own truth.
  return new Response(JSON.stringify(body), { status });
}

function failure(body: unknown, status: number): Response {
  return new Response(body === null ? null : JSON.stringify(body), { status });
}

// The failure branch's message, read through a narrowing expect() cannot give the
// type checker: the union is discriminated on kind, and a runtime assertion is not a
// narrowing, so the failure is selected here once and every test reads it.
function failureMessage(result: Awaited<ReturnType<typeof storeIdentityDocument>>): string {
  const stored = result.stored;
  if (stored.kind !== "failed") throw new Error("the sequence stored a document it should have refused");
  return stored.message;
}

function identity(image: CreateState["identity"]["image"] = null): CreateState["identity"] {
  return { name: "Summit", symbol: "SUMMIT", description: "A test.", image };
}

const IMAGE = {
  bytes: new Uint8Array([1, 2, 3]),
  sha256: IMAGE_SHA,
  previewUrl: "blob:https://peakpump.invalid/cropped",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a market without an image", () => {
  it("stores the document and answers its URI", async () => {
    const stubs = stubRoutes(
      async () => json({}),
      async () => json({ metadataURI: METADATA_URI, sha256: "d".repeat(64), written: true }, 201),
    );

    const result = await storeIdentityDocument(identity());

    expect(result.stored).toEqual({ kind: "stored", metadataURI: METADATA_URI });
    expect(result.imageSha256).toBeNull();
    // The upload route is never called, because there is nothing to store.
    expect(stubs.upload).not.toHaveBeenCalled();
    expect(stalls(stubs)).toEqual(["/api/metadata"]);
  });

  it("omits an empty description rather than sending an empty string", async () => {
    let sent: unknown;
    stubRoutes(
      async () => json({}),
      async (_input, init) => {
        sent = JSON.parse(String(init?.body));
        return json({ metadataURI: METADATA_URI }, 201);
      },
    );

    await storeIdentityDocument({ ...identity(), description: "" });

    expect(sent).toEqual({ name: "Summit", symbol: "SUMMIT" });
  });
});

describe("a market with an image", () => {
  it("uploads first, then sends the document the upload's sha256", async () => {
    let sent: unknown;
    const stubs = stubRoutes(
      async () => json({ sha256: IMAGE_SHA, images: {}, written: true }, 201),
      async (_input, init) => {
        sent = JSON.parse(String(init?.body));
        return json({ metadataURI: METADATA_URI }, 201);
      },
    );

    const result = await storeIdentityDocument(identity(IMAGE));

    // The order is the point: the metadata route confirms the renditions exist, so a
    // document naming an upload that has not happened is a 422.
    expect(stalls(stubs)).toEqual(["/api/upload", "/api/metadata"]);
    expect(sent).toEqual({
      name: "Summit",
      symbol: "SUMMIT",
      description: "A test.",
      image: IMAGE_SHA,
    });
    expect(result).toEqual({ stored: { kind: "stored", metadataURI: METADATA_URI }, imageSha256: IMAGE_SHA });
  });

  it("sends the cropper's bytes as the upload body, untouched", async () => {
    let body: unknown;
    stubRoutes(
      async (_input, init) => {
        body = init?.body;
        return json({ sha256: IMAGE_SHA }, 201);
      },
      async () => json({ metadataURI: METADATA_URI }, 201),
    );

    await storeIdentityDocument(identity(IMAGE));

    expect(body).toBe(IMAGE.bytes);
  });
});

describe("what the sequence refuses", () => {
  it("reports a failed upload and does not store the document", async () => {
    const stubs = stubRoutes(
      async () => failure({ error: "Sign in to do that." }, 401),
      async () => json({ metadataURI: METADATA_URI }, 201),
    );

    const result = await storeIdentityDocument(identity(IMAGE));

    expect(result.stored.kind).toBe("failed");
    // The route's own sentence, so the reader is told the one thing they can fix.
    expect(failureMessage(result)).toBe(UPLOAD_UNREACHABLE);
    expect(stubs.metadata).not.toHaveBeenCalled();
  });

  it("reports a failed document store and does not answer a URI", async () => {
    stubRoutes(
      async () => json({ sha256: IMAGE_SHA }, 201),
      async () => failure({ error: "That image has not been uploaded." }, 422),
    );

    const outcome = await storeIdentityDocument(identity(IMAGE));

    expect(outcome.stored.kind).toBe("failed");
    expect(failureMessage(outcome)).toBe("That image has not been uploaded.");
    expect(outcome.imageSha256).toBeNull();
  });

  it("falls back to its own sentence when the route answers nothing", async () => {
    stubRoutes(
      async () => json({ sha256: IMAGE_SHA }, 201),
      async () => failure(null, 502),
    );

    const outcome = await storeIdentityDocument(identity());

    expect(outcome.stored).toEqual({ kind: "failed", message: METADATA_UNREACHABLE });
  });

  it("reports a network failure rather than throwing", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network gone");
    });

    const outcome = await storeIdentityDocument(identity());

    expect(outcome.stored).toEqual({ kind: "failed", message: METADATA_UNREACHABLE });
  });
});

// The inputs the two stubs saw, in order — the sequence's ordering is a behaviour and
// not an implementation detail, so a test reads it rather than trusting it.
function stalls(stubs: Stubs): string[] {
  return stubs.calls.map((call) => new URL(call.input, "https://peakpump.invalid").pathname);
}
