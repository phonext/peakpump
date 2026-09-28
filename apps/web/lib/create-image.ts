// lib/upload.ts owns these checks but imports sharp, so it cannot load in a
// browser tab, and the cropper has to reject the same files the upload
// pipeline would reject before any upload exists (the upload route owns that;
// this release ships no upload at all). The parity test drives this module and that
// one over the same vectors, so a check can never drift between the tab and
// the server. The four sentences are the one part the test cannot pin —
// upload.ts keeps them private — so they are carried by hand: a wording
// change there must be copied here.
//
// The mirror stops at what a browser can check from bytes alone. The decode
// failure is the one step that needs the component's createImageBitmap, and
// the renditions stay server-side forever.

export const CLIENT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;

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
  // RIFF is a container and not a format: WAV and AVI open with the same four
  // bytes, so the form at byte 8 is the half that says WebP.
  if (signatureAt(bytes, RIFF, 0) && signatureAt(bytes, WEBP, 8)) return "webp";
  return null;
}

const SVG_WINDOW = 256;

// Same purpose as on the server: a user with a logo holds an SVG more often
// than any other rejected format, and a rejection that names it saves them a
// second attempt with the same file. The tag, not a prolog, is what is looked
// for, so a BOM, leading whitespace and an <?xml?> header all pass in one
// check while non-SVG XML falls through to the generic sentence.
export function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, SVG_WINDOW));
  return head.toLowerCase().includes("<svg");
}

export const TOO_LARGE_MESSAGE = `That image is over ${CLIENT_MAX_IMAGE_BYTES / (1024 * 1024)} MB. Upload a smaller one.`;
export const SVG_MESSAGE = "SVG is not accepted. Upload a PNG, JPEG or WebP.";
export const UNSUPPORTED_MESSAGE = "That file is not a PNG, JPEG or WebP.";
// Shown by the component when createImageBitmap fails on bytes that passed the
// sniff: a file can carry a real signature and still be unreadable past it.
export const UNDECODABLE_MESSAGE = "That image could not be read. The file may be damaged or incomplete.";

// The cropper's read gate, in the server's own order: size, then sniff, then
// the SVG lookalike only once the sniff has said no. Every reason a file can
// fail before decoding, one call.
export function imageRejectReason(bytes: Uint8Array): string | null {
  if (bytes.byteLength > CLIENT_MAX_IMAGE_BYTES) return TOO_LARGE_MESSAGE;
  if (sniffImageType(bytes) === null) {
    return looksLikeSvg(bytes) ? SVG_MESSAGE : UNSUPPORTED_MESSAGE;
  }
  return null;
}
