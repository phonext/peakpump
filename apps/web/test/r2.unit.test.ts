import { afterEach, describe, expect, it, vi } from "vitest";

import { imageKey, metadataKey, WEBP_CONTENT_TYPE } from "@/lib/keys";

// No network: SigV4 presigning is arithmetic over the credentials, and what this file
// checks is the shape of the URL our own fetch has to replay.

const VARS = {
  R2_ACCOUNT_ID: "6cf1ba6a1e0d4d6f9b0a11d8e1f22a33",
  R2_ACCESS_KEY_ID: "AKIAEXAMPLEKEYID",
  R2_SECRET_ACCESS_KEY: "an-example-secret-that-is-not-a-credential",
  R2_BUCKET: "peakpump",
  // A trailing slash on purpose: the value comes from a human editing .env.local.
  R2_PUBLIC_BASE_URL: "https://images.peakpump.invalid/",
} as const;

type VarName = keyof typeof VARS;

const NAMES = Object.keys(VARS) as VarName[];

function set(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

// lib/r2.ts keeps one S3Client per module instance, so a case that changes the
// environment loads the module again rather than reassigning a field.
async function loadR2(overrides: Partial<Record<VarName, string>> = {}) {
  vi.resetModules();
  for (const name of NAMES) set(name, name in overrides ? overrides[name] : VARS[name]);
  return await import("@/lib/r2");
}

const original = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of NAMES) set(name, original[name]);
});

const HASH = "c".repeat(64);

type FetchStub = (input: string, init: RequestInit) => Promise<Response>;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reading the configuration", () => {
  it("takes all five fields or reports nothing", async () => {
    const { r2Config } = await loadR2();
    expect(r2Config()).toEqual({
      accountId: VARS.R2_ACCOUNT_ID,
      accessKeyId: VARS.R2_ACCESS_KEY_ID,
      secretAccessKey: VARS.R2_SECRET_ACCESS_KEY,
      bucket: VARS.R2_BUCKET,
      publicBaseUrl: VARS.R2_PUBLIC_BASE_URL,
    });

    for (const name of NAMES) {
      // Absent and empty are the same state: .env.example ships all five with nothing
      // after the equals sign, so "" is the shipped default and not a value.
      const { r2Config: withoutOne } = await loadR2({ [name]: "" });
      expect(withoutOne(), `${name} empty`).toBeNull();
    }
  });
});

describe("the presigned write", () => {
  async function presignedFor(key: string): Promise<URL> {
    const { presignPut, r2Config } = await loadR2();
    const config = r2Config();
    if (config === null) throw new Error("unreachable, the loader sets all five");
    return new URL(await presignPut(config, key));
  }

  it("addresses the bucket path-style at the account's own endpoint", async () => {
    const url = await presignedFor(imageKey(HASH, 64));
    expect(url.host).toBe(`${VARS.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
    // Path-style, so the bucket is the first segment and R2's own hostname stays out
    // of the signature. Virtual-host style would put the bucket in the host.
    expect(url.pathname).toBe(`/${VARS.R2_BUCKET}/uploads/${HASH}/64.webp`);
  });

  it("keeps a key's slashes as path segments", async () => {
    const url = await presignedFor(metadataKey(HASH));
    expect(url.pathname).toBe(`/${VARS.R2_BUCKET}/metadata/${HASH}.json`);
  });

  it("signs the host alone, so the write's own headers stay unsigned", async () => {
    const url = await presignedFor(metadataKey(HASH));
    // This is the contract putObject depends on: with only the host signed, the
    // content-type and cache-control it sends cannot contradict the signature, and R2
    // stores what the request declares. A signed checksum header would break that,
    // which is what requestChecksumCalculation: "WHEN_REQUIRED" prevents.
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(url.searchParams.get("X-Amz-Content-Sha256")).toBe("UNSIGNED-PAYLOAD");
    expect(url.searchParams.get("x-amz-sdk-checksum-algorithm")).toBeNull();
    expect(url.searchParams.get("X-Amz-Checksum-Crc32")).toBeNull();
    // Nor does the presigner carry them in the query, which is why sending them on
    // the PUT is the only thing that puts the long s-maxage on a stored object.
    expect(url.searchParams.get("Cache-Control")).toBeNull();
    expect(url.searchParams.get("Content-Type")).toBeNull();
  });

  it("signs for the auto region and expires in a minute", async () => {
    const url = await presignedFor(metadataKey(HASH));
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Credential")).toContain("/auto/s3/aws4_request");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sends the bytes to that URL under the two headers R2 stores", async () => {
    const { IMMUTABLE_CACHE_CONTROL, putObject, r2Config } = await loadR2();
    const config = r2Config();
    if (config === null) throw new Error("unreachable, the loader sets all five");

    const fetchMock = vi.fn<FetchStub>(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
    await putObject(config, imageKey(HASH, 256), bytes, WEBP_CONTENT_TYPE);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toContain(`/${VARS.R2_BUCKET}/uploads/${HASH}/256.webp?`);
    expect(init?.method).toBe("PUT");
    expect(init?.headers).toEqual({
      "content-type": WEBP_CONTENT_TYPE,
      "cache-control": IMMUTABLE_CACHE_CONTROL,
    });
    expect(init?.body).toBe(bytes);
    // SPEC 6.6:572 is a written MUST about stored objects, and this header is the
    // whole of how it is met.
    expect(IMMUTABLE_CACHE_CONTROL).toContain("s-maxage=31536000");
  });

  it("throws with the key when R2 refuses the write", async () => {
    const { putObject, r2Config } = await loadR2();
    const config = r2Config();
    if (config === null) throw new Error("unreachable, the loader sets all five");

    vi.stubGlobal("fetch", vi.fn<FetchStub>(async () => new Response("no", { status: 403 })));
    // A silent failure here would leave the metadata route returning a URI for bytes
    // that were never stored.
    await expect(putObject(config, metadataKey(HASH), new Uint8Array([1]), "application/json")).rejects.toThrow(
      metadataKey(HASH),
    );
  });
});

describe("the public URL", () => {
  it("joins the base to the key with one slash whatever the base ends in", async () => {
    const { publicUrl, r2Config } = await loadR2();
    const config = r2Config();
    if (config === null) throw new Error("unreachable, the loader sets all five");
    const expected = `https://images.peakpump.invalid/uploads/${HASH}/512.webp`;

    expect(publicUrl(config, imageKey(HASH, 512))).toBe(expected);
    expect(publicUrl({ ...config, publicBaseUrl: "https://images.peakpump.invalid" }, imageKey(HASH, 512))).toBe(expected);
  });
});
