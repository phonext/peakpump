import type { MetadataDocument } from "@/lib/metadata";
import { isSha256Hex, sha256Hex } from "@/lib/sha256";

// Browser safe, and deliberately thin. The document type arrives as `import type`,
// which erases, so neither zod nor anything under lib/r2.ts follows this module into
// the client bundle.
//
// A copy constraint travels with this file: the URI is fixed, the bytes behind it are
// only hash-verifiable, and no UI string may call the metadata immutable. What this
// function proves is that the bytes served today are the bytes that hash was taken
// from, which is a different and smaller claim.

// The deadline lib/graphql.ts applies to the indexer, for the same reason: a host that
// accepts a socket and then says nothing must not hold a panel open indefinitely.
const TIMEOUT_MS = 5_000;

const VERIFIED = "The metadata matches the hash in its URI.";
const DIVERGED = "The metadata does not match the hash in its URI.";
const UNAVAILABLE = "The metadata could not be read.";
const NOT_ADDRESSED = "That URI does not end in a content hash, so it cannot be checked.";
const NOT_A_DOCUMENT = "That URI answered with something that is not a metadata document.";

export type MetadataVerification =
  | { kind: "verified"; message: string; sha256: string; document: MetadataDocument }
  | { kind: "diverged"; message: string; expected: string; actual: string }
  | { kind: "unavailable"; message: string };

// The hash is the last path segment, which is the whole of the /m/<sha256> form. A URI
// that does not end in one is reported rather than guessed at: an older token may
// carry any string at all, since create() takes whatever the caller passes.
export function hashFromUri(uri: string): string | null {
  const path = uri.split("#")[0]?.split("?")[0] ?? "";
  const segment = path.split("/").at(-1) ?? "";
  return isSha256Hex(segment) ? segment : null;
}

export async function verifyMetadata(uri: string): Promise<MetadataVerification> {
  const expected = hashFromUri(uri);
  if (expected === null) return { kind: "unavailable", message: NOT_ADDRESSED };

  let bytes: Uint8Array;
  try {
    const response = await fetch(uri, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return { kind: "unavailable", message: UNAVAILABLE };
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return { kind: "unavailable", message: UNAVAILABLE };
  }

  // The raw bytes as served, never a re-serialization of a parsed object: hashing
  // JSON.stringify output would verify a document nobody published.
  const actual = await sha256Hex(bytes);
  if (actual !== expected) return { kind: "diverged", message: DIVERGED, expected, actual };

  // A body can hash correctly and still not be a document, because the URI on chain
  // is whatever its creator passed to create() and need not have come from our route.
  let document: MetadataDocument;
  try {
    document = JSON.parse(new TextDecoder().decode(bytes)) as MetadataDocument;
  } catch {
    return { kind: "unavailable", message: NOT_A_DOCUMENT };
  }

  return { kind: "verified", message: VERIFIED, sha256: actual, document };
}
