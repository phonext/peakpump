import { imageKey, metadataKey } from "@/lib/keys";
import { getObjectBytes, publicUrl, r2Config } from "@/lib/r2";
import { hashFromUri } from "@/lib/verify-metadata";
import type { MetadataDocument } from "@/lib/metadata";

// A market's own picture, resolved from the one string the chain stores about it.
// The URI is a content address and not a URL the image lives at: its path segment is
// the digest of a metadata document, the document names an upload by that upload's
// digest, and the upload's digest is the key its renditions sit under. Three lookups
// rather than one, because the chain record is deliberately the thinnest thing that
// still resolves — a creator cannot rewrite the URI after create(), so the document
// it points at is the whole story.
//
// Null is every way a market has no picture, and they are deliberately one answer to
// the caller: an empty URI (a market made without one, or by a script that passed
// none), a URI that is not the /m/<sha256> form this deployment writes (create()
// accepts any string a caller hands it), an unconfigured bucket, an object that is
// not there, and a document that carries no image field. A list renders with or
// without a picture, so the identicon that stands in is the design and not a failure.

export async function fetchMarketImage(uri: string | null): Promise<string | null> {
  if (uri === null || uri === "") return null;

  // The document's digest is its path, so a URI without one is not this deployment's
  // own form and is not guessed at.
  const hash = hashFromUri(uri);
  if (hash === null) return null;

  const config = r2Config();
  if (config === null) return null;

  const bytes = await getObjectBytes(config, metadataKey(hash));
  if (bytes === null) return null;

  // The key is the digest of the bytes the metadata route stored under it, so the pair
  // is true by construction rather than checked here: only that route writes this
  // prefix, and it derives the key by hashing what it just stored. A creator cannot
  // reach the bucket, so an object at this key is one this deployment put there.
  let document: MetadataDocument;
  try {
    document = JSON.parse(new TextDecoder().decode(bytes)) as MetadataDocument;
  } catch {
    return null;
  }

  if (document.image === undefined) return null;

  // The rendition URL is rebuilt from the public origin the deployment has today
  // rather than read from the document, so a bucket that moved still serves the
  // picture it already has. The 64px rendition is the size a list and a token page
  // both render at, which is why the pipeline derives it.
  return publicUrl(config, imageKey(document.image.sha256, 64));
}
