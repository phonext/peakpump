import { METADATA_CONTENT_TYPE, metadataKey } from "@/lib/keys";
import { IMMUTABLE_CACHE_CONTROL, getObjectBytes, r2Config } from "@/lib/r2";
import { checkLimit, clientIdentifier, limitHeaders, tooManyRequests } from "@/lib/ratelimit";
import { isSha256Hex } from "@/lib/sha256";

// The public face of a stored document, and the URI that goes on chain. Served through
// this route rather than redirected to the bucket so the on-chain string stays
// independent of where the bytes live; with an immutable CDN response in front, the
// origin is reached about once per document.

// A hash that can become valid the moment someone POSTs it, so the miss is cached for a
// minute rather than not at all or for a year.
const MISS_CACHE_CONTROL = "public, max-age=60";

const NOT_FOUND = "No document at that hash.";

function missing(rate: Record<string, string>): Response {
  return Response.json(
    { error: NOT_FOUND },
    { status: 404, headers: { "cache-control": MISS_CACHE_CONTROL, ...rate } },
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ hash: string }> },
): Promise<Response> {
  const verdict = await checkLimit("read", clientIdentifier(request));
  if (verdict.kind === "limited") return tooManyRequests(verdict);
  const rate = limitHeaders(verdict);

  const { hash } = await context.params;
  // A malformed hash is a 404 and not a 400, so this URL has exactly one meaning: it
  // either is a document or is not. It also keeps an arbitrary path segment out of a
  // storage key.
  if (!isSha256Hex(hash)) return missing(rate);

  const config = r2Config();
  if (config === null) return missing(rate);

  const bytes = await getObjectBytes(config, metadataKey(hash));
  if (bytes === null) return missing(rate);

  // The stored bytes verbatim, never re-serialized: a client that re-hashes this body
  // has to arrive back at the hash in the path.
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": METADATA_CONTENT_TYPE,
      "cache-control": IMMUTABLE_CACHE_CONTROL,
      // Strong, and true by construction: the body is the preimage of the name.
      etag: `"${hash}"`,
      ...rate,
    },
  });
}
