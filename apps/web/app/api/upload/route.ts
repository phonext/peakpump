import { db } from "@/lib/db";
import { IMAGE_SIZES, WEBP_CONTENT_TYPE, imageKey, type ImageSize } from "@/lib/keys";
import { objectExists, publicUrl, putObject, r2Config } from "@/lib/r2";
import { checkLimit, clientIdentifier, limitHeaders, tooManyRequests } from "@/lib/ratelimit";
import { requireSession } from "@/lib/session";
import { MAX_UPLOAD_BYTES, prepareUpload } from "@/lib/upload";
import { boundedBytes } from "@/lib/request-body";

// The route lib/upload.ts was built headless for. Uploading requires a signed-in
// wallet (SPEC 6.7:588): a session is never needed to read
// or to trade, and this is the one write it gates besides the social routes.
//
// No segment config: Next 16 does not cache route handlers, so the Cache-Control
// header is the whole caching story, and this route stores rather than serves.

const NO_STORE = "no-store";

const TOO_LARGE = "That image is over 2 MB. Upload a smaller one.";
const NO_DATABASE = "The database is not configured.";
const WRITE_FAILED = "The image could not be stored.";

function fail(status: number, error: string, rate: Record<string, string>): Response {
  return Response.json({ error }, { status, headers: { "cache-control": NO_STORE, ...rate } });
}

export async function POST(request: Request): Promise<Response> {
  const verdict = await checkLimit("upload", clientIdentifier(request));
  if (verdict.kind === "limited") return tooManyRequests(verdict);
  const rate = limitHeaders(verdict);

  // The auth gate, before storage, before bytes: an unauthenticated request
  // is rejected here and never reaches the bucket.
  const gate = await requireSession();
  if (gate.kind === "denied") return gate.response;

  const config = r2Config();
  if (config === null) return fail(503, "Storage is not configured.", rate);

  // The row is part of the write, not decoration: it records who stored the
  // bytes, so it is a precondition here like the bucket and not a best effort
  // after the bytes have already landed.
  const prisma = db();
  if (prisma === null) return fail(503, NO_DATABASE, rate);

  // The cap plus one byte, so a body exactly at the cap is read whole and a
  // body one byte over is refused by the reader and not by the sniffer.
  const bytes = await boundedBytes(request, MAX_UPLOAD_BYTES + 1);
  if (bytes === null) return fail(413, TOO_LARGE, rate);

  const prepared = await prepareUpload(bytes);
  if (prepared.kind !== "accepted") {
    // prepareUpload's own sentences: the same words a caller met at the pipeline
    // are the words the route answers with, and the status is the one the
    // rejection kind fixes. Too large is 413 here for parity with the reader,
    // the rest are 422 because the bytes are a well-formed body of the wrong
    // kind, not a body past a cap.
    return fail(prepared.kind === "too-large" ? 413 : 422, prepared.message, rate);
  }

  // Dedupe by content address, the metadata route's law: the renditions are a
  // pure function of the original bytes, so identical input means identical
  // keys, and the existence of the object is the record.
  const stored = await Promise.all(prepared.images.map((image) => objectExists(config, image.key)));
  let written = false;
  try {
    for (const [index, image] of prepared.images.entries()) {
      if (stored[index]) continue;
      await putObject(config, image.key, image.bytes, WEBP_CONTENT_TYPE);
      written = true;
    }
  } catch {
    return fail(502, WRITE_FAILED, rate);
  }

  // The row: unique on the digest, so a re-upload of the same bytes updates
  // nothing and the upsert is the idempotence the bucket already guarantees,
  // made visible to the database.
  await prisma.upload.upsert({
    where: { sha256: prepared.sha256 },
    update: {},
    create: {
      sha256: prepared.sha256,
      kind: "IMAGE",
      byteSize: bytes.byteLength,
      uploaderWalletId: gate.session.user.id,
    },
  });

  return Response.json(
    {
      sha256: prepared.sha256,
      images: Object.fromEntries(
        IMAGE_SIZES.map((size: ImageSize) => [String(size), publicUrl(config, imageKey(prepared.sha256, size))]),
      ),
      written,
    },
    { status: written ? 201 : 200, headers: { "cache-control": NO_STORE, ...rate } },
  );
}
