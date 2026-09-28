import sharp from "sharp";

import { IMAGE_SIZES, imageKey, type ImageSize } from "@/lib/keys";
import { sha256Hex } from "@/lib/sha256";

// The bytes are validated by their leading bytes, never by a filename or a
// Content-Type header, and exactly three square WebP renditions are derived here at
// upload time so nothing downstream ever resizes an image on demand.
//
// No HTTP surface. SPEC 6.7:588 puts upload behind wallet auth and SIWE is a later
// release, so this ships as a pipeline a route can call once that auth exists rather
// than as a route that would have to be unauthenticated today.
//
// Everything sharp touches lives here and nothing else imports this file, so a route
// that only formats a key never loads a native image library to do it.

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export type ImageType = "png" | "jpeg" | "webp";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

function signatureAt(bytes: Uint8Array, signature: readonly number[], offset: number): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (signatureAt(bytes, PNG, 0)) return "png";
  if (signatureAt(bytes, JPEG, 0)) return "jpeg";
  // RIFF is a container and not a format: WAV and AVI open with the same four bytes,
  // so the form at byte 8 is the half that says WebP.
  if (signatureAt(bytes, RIFF, 0) && signatureAt(bytes, WEBP, 8)) return "webp";
  return null;
}

const SVG_WINDOW = 256;

// Not what keeps SVG out — nothing above accepts it — but a user with a logo is more
// likely to hold an SVG than any other rejected format, and a rejection that names it
// saves them a second attempt with the same file. Looking for the tag rather than for
// a prolog covers a BOM, leading whitespace and an <?xml?> header in one pass, and
// leaves non-SVG XML to the generic rejection, which is the honest answer for it.
export function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, SVG_WINDOW));
  return head.toLowerCase().includes("<svg");
}

const TOO_LARGE = `That image is over ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB. Upload a smaller one.`;
const SVG = "SVG is not accepted. Upload a PNG, JPEG or WebP.";
const UNSUPPORTED = "That file is not a PNG, JPEG or WebP.";
const UNDECODABLE = "That image could not be read. The file may be damaged or incomplete.";

export interface DerivedImage {
  size: ImageSize;
  key: string;
  bytes: Uint8Array;
}

export interface AcceptedUpload {
  kind: "accepted";
  // Of the original bytes, not of any rendition: dedupe has to key on what the user
  // handed us, and the renditions are a pure function of it.
  sha256: string;
  sourceType: ImageType;
  images: readonly DerivedImage[];
}

export interface RejectedUpload {
  kind: "too-large" | "svg" | "unsupported-type" | "undecodable";
  message: string;
}

export type UploadResult = AcceptedUpload | RejectedUpload;

async function square(bytes: Uint8Array, size: ImageSize): Promise<Uint8Array> {
  // autoOrient on the constructor bakes an EXIF-rotated photo upright before the tag
  // is dropped. failOn is left at its default: sharp's own documentation says to keep
  // the strictest level for untrusted input. limitInputPixels is left at its default
  // too, because a 2 MiB byte cap is not a pixel cap and a small PNG can decode to a
  // very large canvas. Metadata is stripped by never calling withMetadata, which is
  // how sharp drops EXIF, ICC and XMP together.
  const webp = await sharp(bytes, { autoOrient: true })
    .resize(size, size, { fit: "cover" })
    .webp()
    .toBuffer();
  return new Uint8Array(webp);
}

export async function prepareUpload(bytes: Uint8Array): Promise<UploadResult> {
  // Re-checked here and not only at whatever route eventually calls this, so the cap
  // cannot be lost by a caller that forgets it.
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return { kind: "too-large", message: TOO_LARGE };

  const sourceType = sniffImageType(bytes);
  if (sourceType === null) {
    return looksLikeSvg(bytes)
      ? { kind: "svg", message: SVG }
      : { kind: "unsupported-type", message: UNSUPPORTED };
  }

  const sha256 = await sha256Hex(bytes);

  // A file can carry a real signature and still be unreadable past it, so the decode
  // is the one step here that fails on well-formed input.
  let images: readonly DerivedImage[];
  try {
    images = await Promise.all(
      IMAGE_SIZES.map(async (size) => ({ size, key: imageKey(sha256, size), bytes: await square(bytes, size) })),
    );
  } catch {
    return { kind: "undecodable", message: UNDECODABLE };
  }

  return { kind: "accepted", sha256, sourceType, images };
}
