import type { CreateState, CroppedImage } from "@/lib/create-state";

// The create flow's submit sequence, isolated from the component that runs it: the
// two routes it calls are the whole of it, and the component's own job is the
// transaction after them. Splitting it here is what makes it testable without a DOM
// and without the wallet, because both halves of the sequence are fetches against
// routes whose contracts are fixed.
//
// The document is stored before any signature exists, because metadataURI is an
// argument of create() itself: the market cannot be created first and annotated
// later. An image goes up before the document, because the document names the image
// by the sha256 of its stored renditions and the metadata route confirms those
// objects exist before it writes — a document pointing at bytes that were never
// stored is a 422, so the upload is a precondition of the document and not a step
// after it.
//
// Upload is session-gated and the metadata route is not. A signed-out creator is the
// one failure this sequence can name in particular, so the caller gates on it before
// pressing rather than discovering it as a 401 after the bytes are in flight: the
// market is not yet created, but neither is the image the creator chose. A market
// without an image is still a legal market, so a failed upload is reported and the
// submit stops rather than the image being dropped silently.

export const METADATA_UNREACHABLE = "The metadata document could not be stored. Try again.";
export const UPLOAD_UNREACHABLE = "The image could not be stored. Try again.";

export type Stored = { kind: "stored"; metadataURI: string } | { kind: "failed"; message: string };

export interface StoreResult {
  stored: Stored;
  // The sha256 the upload answered with, or null when no image was sent. Reported
  // separately from the URI so a caller that wants to show what was stored is not
  // left parsing a document it just wrote.
  imageSha256: string | null;
}

// The cropper's bytes already passed the pipeline's own gates at export time
// (lib/create-image.ts), and the route re-runs the same sniff and cap on arrival, so
// a byte that got through the first is not re-checked here. The sha256 the cropper
// computed is the one the route answers with, because both hash the same bytes.
async function uploadImage(image: CroppedImage): Promise<string | null> {
  try {
    const response = await fetch("/api/upload", { method: "POST", body: image.bytes });
    if (!response.ok) return null;
    const body = (await response.json()) as { sha256: string };
    return body.sha256;
  } catch {
    return null;
  }
}

export async function storeIdentityDocument(identity: CreateState["identity"]): Promise<StoreResult> {
  const image = identity.image;
  if (image !== null) {
    const sha256 = await uploadImage(image);
    if (sha256 === null) return { stored: { kind: "failed", message: UPLOAD_UNREACHABLE }, imageSha256: null };
    const stored = await storeDocument(identity, sha256);
    return { stored, imageSha256: stored.kind === "stored" ? sha256 : null };
  }
  return { stored: await storeDocument(identity), imageSha256: null };
}

async function storeDocument(identity: CreateState["identity"], imageSha256?: string): Promise<Stored> {
  try {
    const response = await fetch("/api/metadata", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: identity.name,
        symbol: identity.symbol,
        // An absent field is omitted rather than written null, matching the
        // route's own canonical form.
        ...(identity.description === "" ? {} : { description: identity.description }),
        // The sha256 of the upload, not a URL: the route expands it to the rendition
        // URLs itself, after confirming the objects exist.
        ...(imageSha256 === undefined ? {} : { image: imageSha256 }),
      }),
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      return {
        kind: "failed",
        message:
          body !== null && typeof (body as { error?: unknown }).error === "string"
            ? (body as { error: string }).error
            : METADATA_UNREACHABLE,
      };
    }
    return {
      kind: "stored",
      metadataURI: ((await response.json()) as { metadataURI: string }).metadataURI,
    };
  } catch {
    return { kind: "failed", message: METADATA_UNREACHABLE };
  }
}
