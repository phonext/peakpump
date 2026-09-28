import sharp from "sharp";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/upload/route";
import { imageKey } from "@/lib/keys";
import { sha256Hex } from "@/lib/sha256";

// The pipeline itself is tested separately. This file tests the
// route around it: the auth gate, the caps, the rejection mapping, and the
// content-addressed write against a Map bucket. The session is replaced at the
// lib/session boundary so no Auth.js machinery runs.
const state = vi.hoisted(() => ({
  session: "signed-in" as "signed-in" | "signed-out",
  bucket: new Map<string, Uint8Array>(),
  writeFails: false,
  uploads: [] as { sha256: string; byteSize: number; uploaderWalletId: string }[],
}));

vi.mock("@/lib/session", () => ({
  requireSession: async () =>
    state.session === "signed-in"
      ? { kind: "ok", session: { user: { id: "wallet-1", address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" } } }
      : {
          kind: "denied",
          response: Response.json({ error: "Sign in to do that." }, { status: 401, headers: { "cache-control": "no-store" } }),
        },
}));

vi.mock("@/lib/r2", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/r2")>();
  return {
    ...real,
    r2Config: () => ({ accountId: "acct", accessKeyId: "key", secretAccessKey: "secret", bucket: "peakpump", publicBaseUrl: "https://images.peakpump.invalid" }),
    objectExists: async (_config: unknown, key: string) => state.bucket.has(key),
    putObject: async (_config: unknown, key: string, bytes: Uint8Array) => {
      if (state.writeFails) throw new Error("R2 rejected the write of that key with 403");
      state.bucket.set(key, bytes);
    },
  };
});

vi.mock("@/lib/db", () => ({
  db: () => ({
    upload: {
      upsert: async ({ where, create }: { where: { sha256: string }; create: { sha256: string; byteSize: number; uploaderWalletId: string } }) => {
        const existing = state.uploads.find((row) => row.sha256 === where.sha256);
        if (existing === undefined) state.uploads.push(create);
        return existing ?? create;
      },
    },
  }),
}));

const UPSTASH_VARS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];
const original = new Map(UPSTASH_VARS.map((name) => [name, process.env[name]]));
for (const name of UPSTASH_VARS) delete process.env[name];

async function png(): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: 24, height: 24, channels: 3, background: "#ff0000" } }).png().toBuffer(),
  );
}

async function post(bytes: Uint8Array) {
  return await POST(
    new Request("https://peakpump.invalid/api/upload", { method: "POST", body: bytes }),
  );
}

afterEach(() => {
  state.session = "signed-in";
  state.bucket.clear();
  state.writeFails = false;
  state.uploads = [];
});

afterAll(() => {
  for (const [name, value] of original) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("the wallet-auth gate", () => {
  it("refuses an unauthenticated request before it reads a byte", async () => {
    state.session = "signed-out";

    // Bytes that would pass every check: if the route read them first, the
    // answer would still be wrong, so the assertion is on the status alone.
    const response = await post(await png());
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.bucket.size).toBe(0);
    expect(state.uploads).toHaveLength(0);
  });
});

describe("a signed-in upload", () => {
  it("stores the three renditions under the digest and records the row", async () => {
    const bytes = await png();
    const digest = await sha256Hex(bytes);
    const response = await post(bytes);
    const body = (await response.json()) as { sha256: string; images: Record<string, string> };

    expect(response.status).toBe(201);
    expect(body.sha256).toBe(digest);
    expect(body.images["512"]).toBe(`https://images.peakpump.invalid/uploads/${digest}/512.webp`);
    for (const size of [64, 256, 512] as const) {
      expect(state.bucket.has(imageKey(digest, size))).toBe(true);
    }
    // The row carries the original byte count, the kind, and the uploading wallet.
    expect(state.uploads).toEqual([
      { sha256: digest, kind: "IMAGE", byteSize: bytes.byteLength, uploaderWalletId: "wallet-1" },
    ]);
  });

  it("answers 200 without a second write for the same bytes", async () => {
    const bytes = await png();
    const first = await post(bytes);
    const second = await post(bytes);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(state.uploads).toHaveLength(1);
    // The bucket still holds exactly the three renditions.
    expect(state.bucket.size).toBe(3);
  });

  it("answers 502 rather than a URI for bytes it could not store", async () => {
    state.writeFails = true;
    expect((await post(await png())).status).toBe(502);
    expect(state.uploads).toHaveLength(0);
  });
});

describe("what the route refuses", () => {
  it("refuses a body past the cap with 413", async () => {
    const response = await post(new Uint8Array(2 * 1024 * 1024 + 2));
    expect(response.status).toBe(413);
    expect(state.bucket.size).toBe(0);
  });

  it("answers 422 with the pipeline's own sentence for a file it will not take", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const response = await post(svg);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(422);
    // The words are lib/upload.ts's, not the route's: one sentence per
    // rejection, everywhere it surfaces.
    expect(body.error).toBe("SVG is not accepted. Upload a PNG, JPEG or WebP.");
  });
});
