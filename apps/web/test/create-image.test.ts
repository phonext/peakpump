import { describe, expect, it } from "vitest";

import {
  CLIENT_MAX_IMAGE_BYTES,
  SVG_MESSAGE,
  TOO_LARGE_MESSAGE,
  UNSUPPORTED_MESSAGE,
  imageRejectReason,
  looksLikeSvg,
  sniffImageType,
  type ImageType,
} from "@/lib/create-image";
import { MAX_UPLOAD_BYTES, looksLikeSvg as serverLooksLikeSvg, sniffImageType as serverSniffImageType } from "@/lib/upload";

// Every vector is synthesized bytes, never a committed binary, and each one says
// in code what it is: a sniff cares about the first bytes and nothing past them,
// so a prefix in a table is the whole truth about the input.

function withPrefix(prefix: readonly number[], filler = 0x20): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set(prefix, 0);
  bytes.fill(filler, prefix.length);
  return bytes;
}

const PNG_PREFIX = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_PREFIX = [0xff, 0xd8, 0xff];
const RIFF_PREFIX = [0x52, 0x49, 0x46, 0x46];

function webp(): Uint8Array {
  // RIFF at 0, a length nobody reads at 4, and the form at 8: the two halves a
  // WebP sniff needs, with the same padding a real file would carry past them.
  const bytes = withPrefix(RIFF_PREFIX);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  return bytes;
}

function riffNotWebp(): Uint8Array {
  // WAV opens with the same four bytes as WebP, so it is the one lookalike the
  // container half of the check exists to refuse.
  const bytes = withPrefix(RIFF_PREFIX);
  bytes.set(new TextEncoder().encode("WAVE"), 8);
  return bytes;
}

function svgText(prolog: string): Uint8Array {
  return new TextEncoder().encode(`${prolog}<svg xmlns="http://www.w3.org/2000/svg"></svg>`);
}

interface Vector {
  label: string;
  bytes: Uint8Array;
  type: ImageType | null;
  svg: boolean;
}

// The vector table drives this module and upload.ts over the same inputs below,
// which is the parity the cropper depends on: the tab refuses exactly the files
// the server would refuse, before any upload exists to be refused by.
const VECTORS: readonly Vector[] = [
  { label: "a PNG", bytes: withPrefix(PNG_PREFIX), type: "png", svg: false },
  { label: "a JPEG", bytes: withPrefix(JPEG_PREFIX), type: "jpeg", svg: false },
  { label: "a WebP", bytes: webp(), type: "webp", svg: false },
  { label: "a WAV, which shares RIFF with WebP", bytes: riffNotWebp(), type: null, svg: false },
  { label: "an SVG with an xml prolog", bytes: svgText('<?xml version="1.0"?>'), type: null, svg: true },
  { label: "an SVG behind a BOM and whitespace", bytes: svgText("﻿\n  "), type: null, svg: true },
  { label: "an SVG tag in upper case", bytes: new TextEncoder().encode('<SVG width="8"/>'), type: null, svg: true },
  { label: "empty bytes", bytes: new Uint8Array(0), type: null, svg: false },
  {
    label: "an SVG whose tag starts past the 256-byte window",
    // 260 spaces then the tag: the window has closed before the tag appears,
    // and the honest answer for the whole file is the generic one rather than a
    // guess about bytes never looked at.
    bytes: (() => {
      const bytes = new Uint8Array(300);
      bytes.fill(0x20, 0, 260);
      bytes.set(new TextEncoder().encode("<svg"), 260);
      return bytes;
    })(),
    type: null,
    svg: false,
  },
];

describe("the sniff, from bytes alone", () => {
  it("names each format from its leading bytes", () => {
    for (const vector of VECTORS) {
      expect(sniffImageType(vector.bytes), vector.label).toBe(vector.type);
    }
  });

  it("recognises the SVG a sniff refuses, wherever its tag sits", () => {
    for (const vector of VECTORS) {
      expect(looksLikeSvg(vector.bytes), vector.label).toBe(vector.svg);
    }
  });

  it("prefers the signature over a lookalike tag inside a real image", () => {
    // A PNG whose bytes happen to spell an SVG tag past the signature is a PNG:
    // the SVG check runs only once the sniff has said no, and a file the server
    // would accept must never be refused in the tab.
    const png = withPrefix(PNG_PREFIX);
    png.set(new TextEncoder().encode("<svg"), 12);
    expect(sniffImageType(png)).toBe("png");
    expect(imageRejectReason(png)).toBeNull();
  });
});

describe("the read gate, in the server's own order", () => {
  it("refuses a file one byte over the cap before it looks at anything else", () => {
    const oversized = new Uint8Array(CLIENT_MAX_IMAGE_BYTES + 1);
    oversized.set(PNG_PREFIX, 0);
    // A real PNG signature, so the only ground for refusal is the length.
    expect(imageRejectReason(oversized)).toBe(TOO_LARGE_MESSAGE);
  });

  it("accepts a file exactly at the cap", () => {
    const atCap = new Uint8Array(CLIENT_MAX_IMAGE_BYTES);
    atCap.set(PNG_PREFIX, 0);
    expect(imageRejectReason(atCap)).toBeNull();
  });

  it("names SVG in its refusal and keeps the generic sentence for the rest", () => {
    expect(imageRejectReason(svgText(""))).toBe(SVG_MESSAGE);
    expect(imageRejectReason(riffNotWebp())).toBe(UNSUPPORTED_MESSAGE);
  });
});

describe("parity with the server's own checks", () => {
  it("keeps the two caps one number", () => {
    // The cropper refuses on the client cap and the route would refuse again on
    // the server one; a drift between them would let a file through the tab that
    // dies only after a round trip.
    expect(CLIENT_MAX_IMAGE_BYTES).toBe(MAX_UPLOAD_BYTES);
  });

  it("answers identically to upload.ts over every vector", () => {
    for (const vector of VECTORS) {
      expect(serverSniffImageType(vector.bytes), vector.label).toBe(vector.type);
      expect(serverLooksLikeSvg(vector.bytes), vector.label).toBe(vector.svg);
    }
  });
});
