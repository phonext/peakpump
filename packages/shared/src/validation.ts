import { z } from "zod";

// Off-chain validation for token metadata. This repeats the on-chain half of
// the rules for early feedback and adds the checks a contract cannot do:
// character-count lengths, homoglyph script-mixing, and the description. It
// deliberately does NOT apply this project's own forbidden vocabulary or the
// Arc possessive rule to a user's name or symbol — those scope to our own copy.
// A name built from a word this project avoids in its own writing is still a
// legitimate market name, as is an unrelated one like "Meridian".
//
// The rule's own illustration is one of the forbidden words. This comment says
// "Meridian" instead: those eight words are forbidden everywhere in this
// repository, with no exception for a comment or a fixture. The divergence from
// the rule's source text is deliberate and is compliance only — the rule itself
// is unchanged, and its source is left as written.

export const RESERVED_SYMBOLS = ["USDC", "EURC", "WETH", "WBTC", "USDT", "PEAKPUMP"] as const;
const RESERVED = new Set<string>(RESERVED_SYMBOLS);

// Codepoint predicates are written as numeric range tests rather than regex
// literals so the source carries no invisible control, zero-width or bidi bytes
// (a literal here would be unreadable and easy to corrupt in an editor).

// A byte below 0x20 anywhere in the name (on-chain rule, repeated).
function hasControlChar(value: string): boolean {
  for (const ch of value) {
    if (ch.codePointAt(0)! <= 0x1f) return true;
  }
  return false;
}

// Zero-width, bidi control and BOM codepoints (U+200B..U+200F,
// U+202A..U+202E, U+2066..U+2069, U+FEFF).
function hasZeroWidthBidiBom(value: string): boolean {
  for (const ch of value) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x200b && c <= 0x200f) return true;
    if (c >= 0x202a && c <= 0x202e) return true;
    if (c >= 0x2066 && c <= 0x2069) return true;
    if (c === 0xfeff) return true;
  }
  return false;
}

export function codepointLength(value: string): number {
  return [...value].length;
}

// Confusable-script detection. Flags a name that mixes letters from more than
// one of the scripts used in homoglyph attacks (Latin lookalikes in Cyrillic or
// Greek). A name written entirely in one script passes.
export function mixesScripts(value: string): boolean {
  let count = 0;
  if (/\p{Script=Latin}/u.test(value)) count++;
  if (/\p{Script=Cyrillic}/u.test(value)) count++;
  if (/\p{Script=Greek}/u.test(value)) count++;
  return count > 1;
}

export const nameSchema = z
  .string()
  .refine((s) => {
    const n = codepointLength(s);
    return n >= 1 && n <= 32;
  }, "Name must be 1 to 32 characters")
  .refine((s) => !hasControlChar(s), "Name must not contain control characters")
  .refine(
    (s) => !hasZeroWidthBidiBom(s),
    "Name must not contain zero-width, bidi, or BOM characters",
  )
  .refine((s) => !mixesScripts(s), "Name must not mix character scripts");

export const symbolSchema = z
  .string()
  .regex(/^[A-Z0-9]+$/, "Symbol must use only A-Z and 0-9")
  .refine((s) => s.length >= 1 && s.length <= 10, "Symbol must be 1 to 10 characters")
  .refine((s) => !RESERVED.has(s), "Symbol is reserved")
  .refine((s) => !s.startsWith("ARC"), "Symbol must not begin with ARC");

export const descriptionSchema = z
  .string()
  .refine((s) => codepointLength(s) <= 500, "Description must be at most 500 characters");

export const createTokenSchema = z.object({
  name: nameSchema,
  symbol: symbolSchema,
  description: descriptionSchema.optional(),
});

export type CreateTokenInput = z.infer<typeof createTokenSchema>;
