// WebCrypto rather than node:crypto, because lib/verify-metadata.ts re-hashes in
// the browser what the browser fetched, and crypto.subtle is the only digest that
// exists on both sides of that line.
//
// Its own file rather than an addition to lib/hash.ts, whose header says outright
// that it exists so a second hash never gets inlined beside the identicon's FNV-1a.

const HEX_64 = /^[0-9a-f]{64}$/;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Every R2 key and every /m/<hash> path segment in this codebase is this form, and a
// caller checks it before touching storage so an arbitrary URL segment can never be
// interpolated into a key.
export function isSha256Hex(value: string): boolean {
  return HEX_64.test(value);
}
