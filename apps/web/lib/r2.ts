import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { configuredEnv } from "@/lib/env";

// Cloudflare R2 over the S3-compatible API. Writes go through a presigned PUT that
// this code both issues and replays, which is what lets the
// magic-byte check in lib/upload.ts actually gate the write.

// SPEC 6.6:572 requires the long s-maxage on stored objects; immutable is the house
// convention already in next.config.ts, and on a content-addressed key it is true.
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, s-maxage=31536000, immutable";

// The URL is used within the same call that mints it, so this is a bound on clock
// skew rather than on anything a user holds.
const PRESIGN_TTL_SECONDS = 60;

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
}

// Every field or nothing: a half-configured bucket would fail on the first write with
// a signature error rather than reporting itself as unconfigured.
export function r2Config(): R2Config | null {
  const accountId = configuredEnv("R2_ACCOUNT_ID");
  const accessKeyId = configuredEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = configuredEnv("R2_SECRET_ACCESS_KEY");
  const bucket = configuredEnv("R2_BUCKET");
  const publicBaseUrl = configuredEnv("R2_PUBLIC_BASE_URL");
  if (
    accountId === null ||
    accessKeyId === null ||
    secretAccessKey === null ||
    bucket === null ||
    publicBaseUrl === null
  ) {
    return null;
  }
  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

let cached: S3Client | null = null;

// One client per process: it owns a connection pool, and a HEAD runs on every
// metadata write. A test that changes the environment re-imports the module, the
// pattern test/indexer.unit.test.ts already uses for the same reason.
function client(config: R2Config): S3Client {
  if (cached !== null) return cached;
  cached = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // Without this the SDK signs a CRC32 header into the presigned URL that our own
    // fetch would then have to reproduce byte for byte to satisfy the signature.
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  return cached;
}

export function publicUrl(config: R2Config, key: string): string {
  return `${config.publicBaseUrl.replace(/\/+$/, "")}/${key}`;
}

export async function presignPut(config: R2Config, key: string): Promise<string> {
  // The presigner signs the host and nothing else, and it carries no header of the
  // command's into the query either: a Content-Type or Cache-Control set here would
  // be inert. The PUT below sends both as ordinary headers instead.
  return await getSignedUrl(
    client(config),
    new PutObjectCommand({ Bucket: config.bucket, Key: key }),
    { expiresIn: PRESIGN_TTL_SECONDS },
  );
}

export async function putObject(
  config: R2Config,
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const url = await presignPut(config, key);
  // What R2 stores against the object is what the request declares, and the signature
  // covers neither header, so both have to be sent rather than assumed. The long
  // s-maxage on every stored object is SPEC 6.6's requirement and travels from here.
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": contentType, "cache-control": IMMUTABLE_CACHE_CONTROL },
    body: bytes,
  });
  if (!response.ok) {
    throw new Error(`R2 rejected the write of ${key} with ${response.status}`);
  }
}

export async function objectExists(config: R2Config, key: string): Promise<boolean> {
  try {
    await client(config).send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
    return true;
  } catch {
    // A miss and an unreachable bucket both land here. The callers of this treat a
    // false as "do not claim it is there", which is the safe reading of either.
    return false;
  }
}

export async function getObjectBytes(config: R2Config, key: string): Promise<Uint8Array | null> {
  try {
    const object = await client(config).send(
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    );
    const body = await object.Body?.transformToByteArray();
    return body ?? null;
  } catch {
    return null;
  }
}

// HeadBucket proves reachability and credentials in one call, which is what the
// health route wants to report about R2.
export async function bucketReachable(config: R2Config): Promise<void> {
  await client(config).send(new HeadBucketCommand({ Bucket: config.bucket }));
}
