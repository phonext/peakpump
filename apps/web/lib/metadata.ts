import { descriptionSchema, nameSchema, symbolSchema } from "@peakpump/shared/validation";
import { z } from "zod";

import { imageKey } from "@/lib/keys";
import { publicUrl, type R2Config } from "@/lib/r2";

// The document, its canonical form and its key. Server only: the browser needs the
// type to read a document and nothing else from this file.

// Composed here rather than in packages/shared, which is frozen. The three field
// rules are shared's own implementations imported as they stand, so this file cannot
// drift from them; strictObject is what makes an unknown key a rejection rather than
// a silent change to the canonical bytes.
export const metadataRequestSchema = z.strictObject({
  name: nameSchema,
  symbol: symbolSchema,
  description: descriptionSchema.optional(),
  // The sha256 of the original upload, not a URL: the caller has no reason to know
  // where the objects live, and the route expands it only after confirming they do.
  image: z
    .string()
    .regex(/^[0-9a-f]{64}$/, "Image must be the 64-character sha256 of an upload")
    .optional(),
});

export type MetadataRequest = z.infer<typeof metadataRequestSchema>;

// An unauthenticated write must not buffer an arbitrary body. The largest legal
// request is a 32-codepoint name, a 10-character symbol, a 500-codepoint description
// and a 64-character hash, which stays under 2.5 KB even with every character at four
// bytes, so this is a wide cap rather than a tight one.
export const MAX_METADATA_BYTES = 8 * 1024;

// Aliases and not interfaces: the canonicalizer below takes an index-signature type,
// and TypeScript infers an implicit index signature for an alias only.
export type MetadataImage = {
  sha256: string;
  "64": string;
  "256": string;
  "512": string;
};

// No links and no socials. No document under docs/ defines any, so a field for them
// here would be invented product surface.
export type MetadataDocument = {
  name: string;
  symbol: string;
  description?: string;
  image?: MetadataImage;
};

// Absolute URLs, so a third party who reads the URI off the chain can resolve the
// images without knowing anything about this deployment. It also keeps
// R2_PUBLIC_BASE_URL server side: the browser is handed the finished document.
export function metadataImage(config: R2Config, sha256: string): MetadataImage {
  return {
    sha256,
    "64": publicUrl(config, imageKey(sha256, 64)),
    "256": publicUrl(config, imageKey(sha256, 256)),
    "512": publicUrl(config, imageKey(sha256, 512)),
  };
}

export function metadataDocument(
  request: MetadataRequest,
  image: MetadataImage | null,
): MetadataDocument {
  return {
    name: request.name,
    symbol: request.symbol,
    ...(request.description === undefined ? {} : { description: request.description }),
    ...(image === null ? {} : { image }),
  };
}

type CanonicalValue = string | { readonly [key: string]: CanonicalValue | undefined };

// Sorted keys, no whitespace, absent fields omitted rather than written as null. The
// document holds only strings and one nested object of strings, so none of RFC 8785's
// number rules apply and this recursion is the whole canonicalizer. JSON.stringify
// handles the escaping, which has been specified to produce well-formed UTF-8 since
// ES2019, so the bytes below are always valid.
function canonical(value: CanonicalValue): string {
  if (typeof value === "string") return JSON.stringify(value);
  const members = Object.keys(value)
    .sort()
    .flatMap((key) => {
      const child = value[key];
      return child === undefined ? [] : [`${JSON.stringify(key)}:${canonical(child)}`];
    });
  return `{${members.join(",")}}`;
}

export function canonicalMetadataJson(document: MetadataDocument): string {
  return canonical(document);
}

// What gets stored, byte for byte. Nothing re-serializes the document afterwards, so
// re-hashing what /m/<hash> serves reproduces the hash in its path.
export function canonicalMetadataBytes(document: MetadataDocument): Uint8Array {
  return new TextEncoder().encode(canonicalMetadataJson(document));
}
