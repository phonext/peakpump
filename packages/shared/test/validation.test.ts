import { describe, expect, it } from "vitest";

import {
  nameSchema,
  symbolSchema,
  descriptionSchema,
  createTokenSchema,
  codepointLength,
  mixesScripts,
  RESERVED_SYMBOLS,
} from "../src/validation";

// Test strings that must contain otherwise-invisible codepoints are built with
// fromCodePoint so no zero-width or control byte ever sits in this source file.
const cp = (code: number): string => String.fromCodePoint(code);

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown): boolean =>
  schema.safeParse(v).success;

describe("nameSchema", () => {
  it("accepts a plain single-script name", () => {
    expect(ok(nameSchema, "Basecamp")).toBe(true);
    expect(ok(nameSchema, "a")).toBe(true);
    expect(ok(nameSchema, "a".repeat(32))).toBe(true);
  });

  it("rejects empty and over-32-codepoint names", () => {
    expect(ok(nameSchema, "")).toBe(false);
    expect(ok(nameSchema, "a".repeat(33))).toBe(false);
  });

  it("rejects control characters", () => {
    expect(ok(nameSchema, `ab${cp(0x01)}cd`)).toBe(false);
    expect(ok(nameSchema, `ab${cp(0x1f)}cd`)).toBe(false);
  });

  it("rejects zero-width, bidi and BOM codepoints", () => {
    expect(ok(nameSchema, `ab${cp(0x200b)}cd`)).toBe(false); // zero-width space
    expect(ok(nameSchema, `ab${cp(0x200f)}cd`)).toBe(false); // right-to-left mark
    expect(ok(nameSchema, `ab${cp(0x202e)}cd`)).toBe(false); // right-to-left override
    expect(ok(nameSchema, `ab${cp(0x2066)}cd`)).toBe(false); // left-to-right isolate
    expect(ok(nameSchema, `ab${cp(0xfeff)}cd`)).toBe(false); // BOM
  });

  it("rejects homoglyph script-mixing but allows a single script", () => {
    // Latin 'A' + Cyrillic small a: a classic confusable pair.
    expect(ok(nameSchema, `A${cp(0x0430)}`)).toBe(false);
    // Pure Cyrillic and pure Greek names pass.
    expect(ok(nameSchema, `${cp(0x0410)}${cp(0x0430)}`)).toBe(true);
    expect(ok(nameSchema, `${cp(0x0391)}${cp(0x03b1)}`)).toBe(true);
  });

  it("does not apply this project's own copy rules to a user's name", () => {
    // Both words are on this project's banned marketing-word list, which governs the copy
    // this project writes. The rule scopes that to our copy and not to a market a user
    // names, so the schema must accept them. The rule's own example is a word banned
    // here everywhere with no fixture exception, so these stand in for it.
    expect(ok(nameSchema, "Leverage")).toBe(true);
    expect(ok(nameSchema, "Unlock")).toBe(true);
  });
});

describe("codepointLength and mixesScripts", () => {
  it("counts codepoints, not UTF-16 units", () => {
    // A non-BMP codepoint is two UTF-16 units but one codepoint.
    expect(codepointLength(cp(0x1f600))).toBe(1);
    expect(cp(0x1f600).length).toBe(2);
  });

  it("flags Latin/Cyrillic/Greek mixing only when more than one is present", () => {
    expect(mixesScripts("hello")).toBe(false);
    expect(mixesScripts(`h${cp(0x0430)}`)).toBe(true);
  });
});

describe("symbolSchema", () => {
  it("accepts 1-10 uppercase alphanumerics", () => {
    expect(ok(symbolSchema, "BASE")).toBe(true);
    expect(ok(symbolSchema, "A1")).toBe(true);
    expect(ok(symbolSchema, "A".repeat(10))).toBe(true);
  });

  it("rejects lowercase, punctuation, empty and over-10", () => {
    expect(ok(symbolSchema, "base")).toBe(false);
    expect(ok(symbolSchema, "BA-SE")).toBe(false);
    expect(ok(symbolSchema, "")).toBe(false);
    expect(ok(symbolSchema, "A".repeat(11))).toBe(false);
  });

  it("rejects every reserved symbol", () => {
    for (const sym of RESERVED_SYMBOLS) {
      expect(ok(symbolSchema, sym)).toBe(false);
    }
  });

  it("rejects any symbol beginning with ARC", () => {
    expect(ok(symbolSchema, "ARC")).toBe(false);
    expect(ok(symbolSchema, "ARCADE")).toBe(false);
  });
});

describe("descriptionSchema", () => {
  it("accepts up to 500 codepoints and rejects more", () => {
    expect(ok(descriptionSchema, "a".repeat(500))).toBe(true);
    expect(ok(descriptionSchema, "a".repeat(501))).toBe(false);
    expect(ok(descriptionSchema, "")).toBe(true);
  });
});

describe("createTokenSchema", () => {
  it("accepts a full valid payload with optional description", () => {
    expect(ok(createTokenSchema, { name: "Summit", symbol: "SMT", description: "a market" })).toBe(true);
    expect(ok(createTokenSchema, { name: "Summit", symbol: "SMT" })).toBe(true);
  });

  it("rejects when any field is invalid", () => {
    expect(ok(createTokenSchema, { name: "", symbol: "SMT" })).toBe(false);
    expect(ok(createTokenSchema, { name: "Summit", symbol: "usdc" })).toBe(false);
    expect(ok(createTokenSchema, { name: "Summit", symbol: "USDC" })).toBe(false);
  });
});
