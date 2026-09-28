import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { IMAGE_SIZES, imageKey } from "@/lib/keys";
import { sha256Hex } from "@/lib/sha256";
import {
  MAX_UPLOAD_BYTES,
  looksLikeSvg,
  prepareUpload,
  sniffImageType,
  type UploadResult,
} from "@/lib/upload";

// Every fixture is synthesized here, including the EXIF one, so nothing binary is
// committed and each test says in code what its input actually is.

const RED = "#ff0000";

function solid(width: number, height: number, background: string) {
  return sharp({ create: { width, height, channels: 3, background } });
}

async function png(): Promise<Uint8Array> {
  return new Uint8Array(await solid(24, 24, RED).png().toBuffer());
}

async function jpeg(): Promise<Uint8Array> {
  return new Uint8Array(await solid(24, 24, RED).jpeg().toBuffer());
}

async function webp(): Promise<Uint8Array> {
  return new Uint8Array(await solid(24, 24, RED).webp().toBuffer());
}

// Red on the left, blue on the right, and not square: which half ends up on top after
// the orientation tag is applied is the whole point of the fixture.
async function halvesWithOrientation(orientation: number): Promise<Uint8Array> {
  const blue = await solid(50, 50, "#0000ff").png().toBuffer();
  const bytes = await solid(100, 50, RED)
    .composite([{ input: blue, left: 50, top: 0 }])
    .withMetadata({ orientation })
    .jpeg()
    .toBuffer();
  return new Uint8Array(bytes);
}

async function rgbAt(bytes: Uint8Array, x: number, y: number) {
  const pixel = await sharp(bytes)
    .extract({ left: x, top: y, width: 1, height: 1 })
    .raw()
    .toBuffer();
  return { r: pixel.readUInt8(0), g: pixel.readUInt8(1), b: pixel.readUInt8(2) };
}

function accepted(result: UploadResult) {
  expect(result.kind).toBe("accepted");
  if (result.kind !== "accepted") throw new Error("unreachable, narrowed above");
  return result;
}

describe("what the bytes actually are", () => {
  it("reads each accepted format from its leading bytes", async () => {
    expect(sniffImageType(await png())).toBe("png");
    expect(sniffImageType(await jpeg())).toBe("jpeg");
    expect(sniffImageType(await webp())).toBe("webp");
  });

  it("names SVG in its rejection", async () => {
    const svg = new TextEncoder().encode(
      '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8"/></svg>',
    );
    expect(looksLikeSvg(svg)).toBe(true);
    const result = await prepareUpload(svg);
    expect(result.kind).toBe("svg");
    // The one rejection whose sentence has to say which format was refused: it is the
    // file a user with a logo is most likely to hold.
    if (result.kind === "svg") expect(result.message).toContain("SVG");
  });

  it("rejects a RIFF container that is not WebP", async () => {
    // WAV opens with the same four bytes, so a check on RIFF alone would take it.
    const wav = new Uint8Array(16);
    wav.set(new TextEncoder().encode("RIFF"), 0);
    wav.set(new TextEncoder().encode("WAVE"), 8);
    expect(sniffImageType(wav)).toBeNull();
    expect((await prepareUpload(wav)).kind).toBe("unsupported-type");
  });

  it("reads a JPEG as a JPEG whatever the caller called it", async () => {
    // prepareUpload takes bytes and nothing else: there is no filename and no
    // Content-Type parameter for a .png name or an image/png header to arrive in.
    const result = accepted(await prepareUpload(await jpeg()));
    expect(result.sourceType).toBe("jpeg");
  });

  it("refuses one byte over the cap before it looks at anything else", async () => {
    const oversized = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    oversized.set(await png(), 0);
    // A real PNG signature, so the only ground for refusal is the length.
    const result = await prepareUpload(oversized);
    expect(result.kind).toBe("too-large");
  });

  it("rejects a file whose signature is right and whose body is not", async () => {
    const truncated = (await png()).subarray(0, 40);
    expect(sniffImageType(truncated)).toBe("png");
    expect((await prepareUpload(truncated)).kind).toBe("undecodable");
  });
});

describe("what comes out", () => {
  it("derives exactly the three sizes, each one a WebP under its own key", async () => {
    const source = await png();
    const result = accepted(await prepareUpload(source));

    expect(result.images.map((image) => image.size)).toEqual([...IMAGE_SIZES]);
    for (const image of result.images) {
      expect(sniffImageType(image.bytes)).toBe("webp");
      expect(image.key).toBe(imageKey(result.sha256, image.size));
      const meta = await sharp(image.bytes).metadata();
      expect(meta.width).toBe(image.size);
      expect(meta.height).toBe(image.size);
    }
  });

  it("keys on the digest of the original bytes and not of a rendition", async () => {
    const source = await png();
    const result = accepted(await prepareUpload(source));
    // Dedupe has to answer "have we seen this file", so the hash is taken before sharp
    // touches anything. Computed here independently rather than read back from the
    // result it is meant to check.
    expect(result.sha256).toBe(await sha256Hex(source));
  });

  it("carries no EXIF out of a file that had some", async () => {
    const tagged = await halvesWithOrientation(1);
    expect((await sharp(tagged).metadata()).exif).toBeDefined();

    const result = accepted(await prepareUpload(tagged));
    for (const image of result.images) {
      const meta = await sharp(image.bytes).metadata();
      // withMetadata is never called, which is how sharp drops EXIF, ICC and XMP at
      // once. An orientation tag surviving would also mean the pixels were not baked.
      expect(meta.exif).toBeUndefined();
      expect(meta.orientation).toBeUndefined();
    }
  });

  it("bakes an orientation tag into the pixels", async () => {
    const result = accepted(await prepareUpload(await halvesWithOrientation(6)));
    const smallest = result.images[0];
    expect(smallest?.size).toBe(64);
    if (smallest === undefined) throw new Error("unreachable, asserted above");

    // Orientation 6 is a quarter turn clockwise, so the red left half becomes the red
    // top half. Read unoriented, the same crop would put blue at this point.
    const top = await rgbAt(smallest.bytes, 40, 8);
    expect(top.r).toBeGreaterThan(150);
    expect(top.b).toBeLessThan(100);

    const bottom = await rgbAt(smallest.bytes, 40, 56);
    expect(bottom.b).toBeGreaterThan(150);
    expect(bottom.r).toBeLessThan(100);
  });
});

