// The R2 key layout, in one file, because two modules derive keys from it and neither
// should have to import the other's dependencies to spell a path.
//
// uploads/<sha256 of the original bytes>/<size>.webp
// metadata/<sha256 of the canonical bytes>.json
//
// The prefix carries the hash and the leaf carries the rendition, so one upload's three
// sizes sit under one directory and a bucket listing reads as one entry per image.

// The trio components/token/TokenImage.tsx already renders at, and the exact sizes
// the upload pipeline derives. Declared here rather than imported from that component so no server module
// pulls in JSX for a number.
export const IMAGE_SIZES = [64, 256, 512] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

export const WEBP_CONTENT_TYPE = "image/webp";
export const METADATA_CONTENT_TYPE = "application/json; charset=utf-8";

export function imageKey(sha256: string, size: ImageSize): string {
  return `uploads/${sha256}/${size}.webp`;
}

export function metadataKey(sha256: string): string {
  return `metadata/${sha256}.json`;
}
