import { IMAGE_SIZES, METADATA_CONTENT_TYPE, imageKey, metadataKey } from "@/lib/keys";
import {
  MAX_METADATA_BYTES,
  canonicalMetadataBytes,
  metadataDocument,
  metadataImage,
  metadataRequestSchema,
  type MetadataImage,
} from "@/lib/metadata";
import { objectExists, putObject, r2Config, type R2Config } from "@/lib/r2";
import { checkLimit, clientIdentifier, limitHeaders, tooManyRequests } from "@/lib/ratelimit";
import { sha256Hex } from "@/lib/sha256";

// POST a name, a symbol, an optional description and the sha256 of an upload; get back
// the content-addressed URI of the stored document. No segment config: Next 16 does not
// cache route handlers, so the Cache-Control below is the whole caching story.

const NO_STORE = "no-store";

const NOT_JSON = "The request body must be JSON.";
const TOO_LARGE = "That request body is too large.";
const NO_STORAGE = "Storage is not configured.";
const NO_IMAGE = "That image has not been uploaded.";
const WRITE_FAILED = "The document could not be stored.";

function fail(status: number, error: string, rate: Record<string, string>): Response {
  return Response.json({ error }, { status, headers: { "cache-control": NO_STORE, ...rate } });
}

// Read to the cap and stop, rather than buffering whatever arrives and measuring
// afterwards: the point of a cap on an unauthenticated route is that the bytes past it
// are never held.
async function boundedBody(request: Request): Promise<string | null> {
  const body = request.body;
  if (body === null) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > MAX_METADATA_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk.value);
  }
  const joined = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(joined);
}

// The proxy headers first, because behind one the request URL carries the internal host
// and a URI built from it would resolve nowhere. The caller passes this string to
// create() itself, so nothing here is a trust boundary: it could pass anything at all.
function origin(request: Request): string {
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (proto !== undefined && proto !== "" && host !== undefined && host !== "") {
    return `${proto}://${host}`;
  }
  return new URL(request.url).origin;
}

// Three HEADs in parallel rather than one on the largest: together they cost a single
// round trip, and a set that was written in parallel can in principle be partial.
async function uploadedImage(config: R2Config, sha256: string): Promise<MetadataImage | null> {
  const present = await Promise.all(
    IMAGE_SIZES.map((size) => objectExists(config, imageKey(sha256, size))),
  );
  return present.every(Boolean) ? metadataImage(config, sha256) : null;
}

export async function POST(request: Request): Promise<Response> {
  const verdict = await checkLimit("write", clientIdentifier(request));
  if (verdict.kind === "limited") return tooManyRequests(verdict);
  const rate = limitHeaders(verdict);

  // The route's precondition, checked before any parsing: with no bucket there is no
  // request this route could satisfy.
  const config = r2Config();
  if (config === null) return fail(503, NO_STORAGE, rate);

  const text = await boundedBody(request);
  if (text === null) return fail(413, TOO_LARGE, rate);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, NOT_JSON, rate);
  }

  const input = metadataRequestSchema.safeParse(body);
  if (!input.success) {
    // The first issue's own sentence: these are the messages from
    // packages/shared/src/validation.ts, already written for a person to read.
    return fail(400, input.error.issues[0]?.message ?? NOT_JSON, rate);
  }

  const image = input.data.image === undefined ? null : await uploadedImage(config, input.data.image);
  if (input.data.image !== undefined && image === null) {
    // A document naming objects that do not exist would be permanently wrong, and it is
    // addressed by its own bytes, so it could never be corrected in place.
    return fail(422, NO_IMAGE, rate);
  }

  const document = metadataDocument(input.data, image);
  const bytes = canonicalMetadataBytes(document);
  const sha256 = await sha256Hex(bytes);
  const key = metadataKey(sha256);

  // Identical input gives an identical key, so dedupe is the existence of the object
  // rather than a row in a table: the bytes at that key are the record.
  const written = !(await objectExists(config, key));
  if (written) {
    try {
      await putObject(config, key, bytes, METADATA_CONTENT_TYPE);
    } catch {
      return fail(502, WRITE_FAILED, rate);
    }
  }

  return Response.json(
    { metadataURI: `${origin(request)}/m/${sha256}`, sha256, written },
    { status: written ? 201 : 200, headers: { "cache-control": NO_STORE, ...rate } },
  );
}
