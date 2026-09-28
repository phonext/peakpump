// FNV-1a over the lowercased address. It has one consumer, TokenImage's fallback
// identicon, and lives in its own file so a second hash never gets inlined somewhere
// else and quietly draws a different picture for the same token.
//
// Not a cryptographic hash and not a checksum: the only requirement is that the same
// address always picks the same colours and the same cells, on the server and in the
// browser, with no import cost.
export function hashAddress(address: string): number {
  const lower = address.toLowerCase();
  let hash = 0x811c9dc5;
  for (let index = 0; index < lower.length; index += 1) {
    hash ^= lower.charCodeAt(index);
    // Math.imul, because the FNV prime multiply overflows 2^53 and a plain * would
    // silently lose the low bits that carry the variation.
    hash = Math.imul(hash, 0x01000193);
  }
  // >>> 0 so callers get a non-negative integer and % lands inside an array.
  return hash >>> 0;
}
