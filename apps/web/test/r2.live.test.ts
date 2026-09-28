import { DeleteObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import { METADATA_CONTENT_TYPE } from "@/lib/keys";
import {
  IMMUTABLE_CACHE_CONTROL,
  bucketReachable,
  getObjectBytes,
  objectExists,
  putObject,
  r2Config,
  type R2Config,
} from "@/lib/r2";
import { sha256Hex } from "@/lib/sha256";

// Opt-in, and off by default: vitest loads no .env file, so this suite runs only for a
// shell that exported the five R2 variables itself. It writes to a real bucket under a
// test/ prefix and removes what it wrote.
const config = r2Config();

// Six round trips to a bucket, which is past vitest's 5 s default.
const TIMEOUT_MS = 20_000;

// The app never deletes an object: a content-addressed write is permanent by design, so
// lib/r2.ts has no delete and the one caller that needs to undo a write is this file.
function admin(config: R2Config): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
}

describe.skipIf(config === null)("a real R2 bucket", () => {
  it(
    "writes an object, reads the same bytes back, and takes it away again",
    async () => {
      // skipIf above is the guarantee; the narrowing is for the compiler.
      if (config === null) throw new Error("unreachable, skipped above");

      // Unique per run, so two runs cannot delete each other's object, and still
      // content-addressed: the key is the digest of exactly these bytes.
      const bytes = new TextEncoder().encode(JSON.stringify({ probe: crypto.randomUUID() }));
      const key = `test/${await sha256Hex(bytes)}.json`;
      const client = admin(config);

      // First, because objectExists reports a miss and a rejected request alike: bad
      // credentials would otherwise satisfy the assertion below for the wrong reason.
      await bucketReachable(config);
      expect(await objectExists(config, key)).toBe(false);

      try {
        await putObject(config, key, bytes, METADATA_CONTENT_TYPE);
        expect(await objectExists(config, key)).toBe(true);
        expect(await getObjectBytes(config, key)).toEqual(bytes);

        // What R2 stored against the object, read over the S3 API rather than the
        // public URL so no CDN cache sits between the write and the assertion. This
        // header is SPEC 6.6:572, and the presigned PUT does not sign it.
        const head = await client.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
        );
        expect(head.CacheControl).toBe(IMMUTABLE_CACHE_CONTROL);
        expect(head.ContentType).toBe(METADATA_CONTENT_TYPE);
      } finally {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
      }

      expect(await objectExists(config, key)).toBe(false);
    },
    TIMEOUT_MS,
  );
});
