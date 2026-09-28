// The copyright year of the lightweight-charts notice is a digit, and DESIGN.md:22-23
// sets every number in JetBrains Mono while the prose around it stays in the grotesk.
// This module is the split that makes that possible, kept out of the component so the
// test beside it can assert against it without a JSX transform.
//
// The year is matched, never hardcoded: the notice is generated from the installed
// NOTICE at build time and its year moves with the upstream version. The three slices
// are the input read in order with nothing inserted between them, and the test asserts
// against the real constant that they rejoin to it exactly, because a split that
// dropped or doubled a character would corrupt the one string in this product that may
// not be reflowed.

const YEAR = /(?:19|20)\d{2}/;

export interface YearSplit {
  head: string;
  year: string;
  tail: string;
}

export function splitAtYear(text: string): YearSplit | null {
  const match = text.match(YEAR);
  // Both reads are defined on a non-null match, but noUncheckedIndexedAccess types them
  // optional; narrowing them here keeps the slice arithmetic off the caller.
  if (match === null || match.index === undefined || match[0] === undefined) return null;
  return {
    head: text.slice(0, match.index),
    year: match[0],
    tail: text.slice(match.index + match[0].length),
  };
}
