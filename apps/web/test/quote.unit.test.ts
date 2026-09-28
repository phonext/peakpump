import { buyQuote, sellQuote, splitFee } from "@peakpump/shared/curve";
import { formatTokenAmount, formatUsdc6 } from "@peakpump/shared/format";
import { BaseError } from "viem";
import { describe, expect, it } from "vitest";
import { MIN_BUY_6, QUOTE_STATUS, quoteSentence } from "@/lib/curve-quote";
import { describeReadError } from "@/lib/read-error";
import { feeCeil } from "./fee-base";

// docs/DESIGN.md:266-276, both lists, plus the possessive and plural forms of Arc
// that ARC 1.4 forbids.
const BANNED = [
  "seamlessly",
  "effortlessly",
  "unlock",
  "leverage",
  "robust",
  "elevate",
  "game-changing",
  "revolutionary",
  "dive in",
  "let's",
  "we're excited",
  "kindling",
  "blazing",
  "flashpoint",
  "ember",
  "blaze",
  "inferno",
  "bondfire",
  "bondtoken",
  "arc's",
  "arcs",
];

describe("quoteSentence", () => {
  it("answers for all seven members on both sides", () => {
    for (const status of QUOTE_STATUS) {
      for (const side of ["buy", "sell"] as const) {
        const sentence = quoteSentence(status, { side });
        if (status === "Ok") {
          expect(sentence).toBeNull();
        } else {
          expect(sentence).toBeTypeOf("string");
          expect(sentence?.length ?? 0).toBeGreaterThan(0);
        }
      }
    }
  });

  it("stays inside the copy rules", () => {
    for (const status of QUOTE_STATUS) {
      for (const side of ["buy", "sell"] as const) {
        const sentence = quoteSentence(status, { side, sold: 1n });
        if (sentence === null) continue;
        expect(sentence).not.toContain("!");
        // Emoji, via the property Unicode gives them rather than a list.
        expect(sentence).not.toMatch(/\p{Extended_Pictographic}/u);
        for (const word of BANNED) {
          expect(sentence.toLowerCase()).not.toContain(word);
        }
        // Ends as a sentence, so it can sit beside a control without a period
        // being added by the caller.
        expect(sentence.endsWith(".")).toBe(true);
      }
    }
  });

  it("names the minimum buy rather than describing it", () => {
    expect(quoteSentence("BelowMinimum", { side: "buy" })).toBe(
      `Enter at least ${formatUsdc6(MIN_BUY_6)} USDC.`,
    );
    // MATH.md:338: 1000 six-decimal units is $0.001, and the sentence says so.
    expect(formatUsdc6(MIN_BUY_6)).toBe("0.001");
  });

  it("carries the live sold figure into ExceedsSold", () => {
    const sold = 263_267_338_962_152_052_045_484n;
    expect(quoteSentence("ExceedsSold", { side: "sell", sold })).toContain(
      formatTokenAmount(sold),
    );
    // Without the number the sentence still has to work: a quote read where sold
    // was not asked for is the only case, and it says the same thing without
    // inventing a figure.
    expect(quoteSentence("ExceedsSold", { side: "sell" })).not.toContain(".338");
  });

  it("keeps Closed neutral instead of deleting it", () => {
    // It is unreachable; the member stays and answers.
    expect(quoteSentence("Closed", { side: "buy" })).toBe("This market is not quoting.");
  });
});

describe("the fee base", () => {
  const amounts = [1000n, 1001n, 12_345n, 1_000_000n, 20_000_000_000n, 999_999_999_999n];
  const feeBpsTable = [125n, 30n, 200n];

  it("agrees with the shared curve library on both sides", () => {
    const x = 1_000_000_000n;
    const y = 800_000_000_000_000_000_000_000_000n;
    for (const feeBps of feeBpsTable) {
      for (const amount of amounts) {
        expect(buyQuote(x, y, amount, feeBps).fee6).toBe(feeCeil(amount, feeBps));
        const sell = sellQuote(x, y, amount * 1_000_000_000_000n, feeBps);
        expect(sell.fee6).toBe(feeCeil(sell.gross6, feeBps));
      }
    }
  });

  it("splits top-down so the two shares sum to the whole", () => {
    for (const amount of amounts) {
      const fee6 = feeCeil(amount, 125n);
      const { creatorFee6, protocolFee6 } = splitFee(fee6, 125n, 30n);
      expect(creatorFee6 + protocolFee6).toBe(fee6);
      // Two independent ceils would put creatorFee6 one unit higher here.
      expect(creatorFee6).toBe((fee6 * 30n) / 125n);
    }
  });
});

describe("describeReadError", () => {
  it("classifies a Zero8 revert on the code and keeps the selector", () => {
    const report = describeReadError({ code: 3, data: "0xAB12CD34deadbeef" });
    expect(report.kind).toBe("reverted");
    expect(report.selector).toBe("0xab12cd34");
  });

  it("finds the code through a viem cause chain", () => {
    const inner = new BaseError("inner");
    Object.assign(inner, { code: 3 });
    const outer = new BaseError("outer", { cause: inner });
    expect(describeReadError(outer).kind).toBe("reverted");
  });

  it("separates a shortfall from a revert", () => {
    const report = describeReadError({ code: -32003 });
    expect(report.kind).toBe("insufficient-funds");
    expect(report.selector).toBeUndefined();
  });

  it("hands everything else to the frozen classifier", () => {
    expect(describeReadError({ code: 4001 }).kind).toBe("rejected");
    expect(describeReadError(new Error("nothing coded")).kind).toBe("unknown");
  });

  it("reads no message text", () => {
    // Zero8 reworded these, so the same code with opposite wording must classify
    // the same way.
    const a = describeReadError({ code: 3, message: "execution reverted" });
    const b = describeReadError({ code: 3, message: "call failed for some new reason" });
    expect(a.kind).toBe(b.kind);
  });
});
