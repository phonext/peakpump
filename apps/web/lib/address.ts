// A wallet or curve address as this API accepts it: 0x and 40 hex digits,
// case-insensitive on the way in, lowercase from the first line that stores or
// compares it. viem's isAddress is not used because its strict mode is about
// checksums, and a caller sending an all-lowercase address is not an error
// anywhere in this codebase.

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function isAddress(value: string): boolean {
  return ADDRESS.test(value);
}
