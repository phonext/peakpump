import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BaseError } from "viem";
import { describe, expect, it } from "vitest";
import { describeReadError } from "@/lib/read-error";

// The four states a pending surface owes a reader — loading, empty, error,
// success — are a contract here rather than a convention, and the halves of it
// a type cannot hold are what this reads the shipped components for. The
// loading and success halves are the Skeleton and the content themselves, so
// what is asserted is that nothing else stands in for the Skeleton: no spinner,
// and no hand-rolled shimmer box outside it. The error half is a sentence plus
// the retry the failing query already carries, asserted at every site so a new
// surface cannot arrive with the sentence alone.
//
// Read rather than rendered: apps/web's suite runs in node and rendering these
// would need a DOM and a query client the project's rules do not allow it to
// take. What renders is already covered by the visual baseline.

const COMPONENTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "components");

function shipped(): string[] {
  // readdirSync's overloads hand back Buffer when they cannot prove the encoding
  // from the options object, so the string guard is what narrows the entries.
  return readdirSync(COMPONENTS, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".tsx"))
    .map((entry) => path.join(COMPONENTS, entry));
}

const SOURCES = shipped();

describe("the loading half of the contract", () => {
  it("reserves space with the dimensioned Skeleton and nothing else", () => {
    for (const file of SOURCES) {
      const source = readFileSync(file, "utf8");
      // DESIGN.md makes a skeleton state its final width and height so nothing
      // shifts when content arrives. The component's own types require both, so
      // what is left to drift is a caller sizing it from a wrapper without
      // saying so here — a bare <Skeleton /> in a flex row is a zero-height box.
      for (const tag of source.matchAll(/<Skeleton\b[^>]*?\/?>/g)) {
        const opened = tag[0];
        expect(opened, `${file}:${tag.index}`).toMatch(/width=/);
        expect(opened, `${file}:${tag.index}`).toMatch(/height=/);
      }
    }
  });

  it("ships no spinner and no shimmer outside the Skeleton itself", () => {
    for (const file of SOURCES) {
      const source = readFileSync(file, "utf8");
      // A spinner replacing a whole panel is what this rule exists to prevent,
      // and a hand-rolled shimmer box is the same failure one layer down: it
      // bypasses the dimension requirement above. aria-busy stays allowed,
      // because the one control that carries it is a submit button and not a
      // pending surface.
      expect(source, file).not.toMatch(/animate-spin\b/);
      expect(source, file).not.toMatch(/animate-pulse\b/);
      expect(source, file).not.toMatch(/<Spinner\b/);
      expect(source, file).not.toMatch(/pp-shimmer\b/);
    }
  });
});

describe("the error half of the contract", () => {
  it("offers the failing query's own retry at every surface", () => {
    let surfaces = 0;
    for (const file of SOURCES) {
      const source = readFileSync(file, "utf8");
      for (const tag of source.matchAll(/<ReadFailure\b[^>]*?\/?>/g)) {
        surfaces += 1;
        // Every read this component sits on is a react-query result, so the
        // function is in scope at the site; a sentence without it leaves a
        // failed read failed until something else asks again.
        expect(tag[0], `${file}:${tag.index}`).toMatch(/onRetry=/);
      }
    }
    // The count itself is the guard that a new surface cannot be added in a
    // place this loop does not reach: it is every ReadFailure in components/.
    expect(surfaces).toBe(14);
  });

  it("answers every shape a read can fail with a non-empty sentence", () => {
    // describeReadError is the one place the sentence comes from, so the shape
    // coverage here is the coverage of every surface above. Nothing below reads
    // the message text of a node error, so the inputs carry codes and causes
    // rather than sentences a rewording would break.
    const cases: unknown[] = [
      new Error("boom"),
      new BaseError("viem's own wrapper"),
      { code: 3, data: "0x12345678" },
      { code: 3 },
      { code: -32003 },
      { code: 4001 },
      { code: -32000, data: "0xabcdefab" },
      { code: -32005 },
      { code: -32603 },
      { code: 777 },
      { message: "an object with no code" },
      "a bare string",
      undefined,
      null,
    ];
    for (const error of cases) {
      const report = describeReadError(error);
      expect(report.kind, String(error)).toBeTypeOf("string");
      expect(report.message, String(error)).toBeTypeOf("string");
      expect(report.message.length, String(error)).toBeGreaterThan(0);
      // The sentence is the whole failure surface, so it ends like one and it
      // carries no character the copy rules forbid.
      expect(report.message).toMatch(/\.$/);
      expect(report.message).not.toMatch(/[!]/);
      expect(report.message).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("keeps the sentence off the node's own wording", () => {
    // A rewording upstream must not reach a reader: the report for a coded
    // error is the project's sentence, whatever the node said.
    const noisy = describeReadError({ code: -32000, message: "execution reverted: OwnableUnauthorizedAccount" });
    expect(noisy.message).toBe("The contract rejected the call.");
    expect(describeReadError(undefined).message).toBe("The request failed and the wallet gave no reason.");
  });
});
