// Joins class names. Internal to this package: it is not an export subpath, so
// nothing outside imports it and the barrel rule is untouched. Falsy entries are
// dropped so a caller can write cx(base, cond && extra) without a wrapper.
//
// A loop rather than a method chain, for two reasons. It runs on every render of
// every component and allocates no intermediate array; and Tailwind reads this file
// looking for class names, where a bare method name is indistinguishable from a
// utility and materialises a rule nothing uses.
export function cx(...parts: Array<string | false | null | undefined>): string {
  let out = "";
  for (const part of parts) {
    if (part) out += out === "" ? part : ` ${part}`;
  }
  return out;
}
