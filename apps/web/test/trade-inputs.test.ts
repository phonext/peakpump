import { describe, expect, it } from "vitest";
import { TOKEN_DECIMALS, USDC_QUOTE_DECIMALS, parseAmount, sanitizeAmountText, toAmountText } from "@/lib/amount";
import { DEADLINE_PRESETS_MINUTES, DEFAULT_DEADLINE_MINUTES, deadlineFrom } from "@/lib/deadline";
import {
  DEFAULT_SLIPPAGE_BPS,
  HIGH_SLIPPAGE_BPS,
  MAX_SLIPPAGE_BPS,
  SLIPPAGE_PRESETS_BPS,
  applyTolerance,
  formatSlippagePercent,
  isHighSlippage,
  parseSlippagePercent,
} from "@/lib/slippage";

// Everything the submit control carries that the contract did not hand back: the
// tolerance applied to the quote, the text in the amount field, and the deadline. The
// quoted number itself is never touched, and the first block below is what proves it.

// One micro-USDC short of a whole unit, and a token amount at the 18-decimal scale a
// real balance has, so a floor that silently became a round is visible in the digits.
const ONE_USDC_6 = 1_000_000n;
const TOKENS_18 = 263_138_414_814_066_417_862_214n;

describe("the tolerance applied to a quote", () => {
  it("lowers the quote by each preset exactly", () => {
    expect(SLIPPAGE_PRESETS_BPS).toEqual([50n, 100n, 300n]);
    expect(applyTolerance(ONE_USDC_6, 50n)).toBe(995_000n);
    expect(applyTolerance(ONE_USDC_6, 100n)).toBe(990_000n);
    expect(applyTolerance(ONE_USDC_6, 300n)).toBe(970_000n);
  });

  it("lowers it by a custom value the field accepts", () => {
    // 0.25 percent, which no preset offers.
    expect(applyTolerance(ONE_USDC_6, 25n)).toBe(997_500n);
    expect(applyTolerance(TOKENS_18, 25n)).toBe(262_480_568_777_031_251_817_558n);
    // One expression and not two: subtracting a floored fee share instead lands a
    // single wei higher, and the direction that matters is the one that cannot ask
    // the market for more than the quote promised.
    expect(applyTolerance(TOKENS_18, 25n)).toBeLessThan(TOKENS_18 - (TOKENS_18 * 25n) / 10_000n);
  });

  it("returns the quote verbatim at a zero tolerance", () => {
    // The tolerance rule: the base number is the struct's own field and only the
    // user's tolerance is applied. At zero there is nothing to apply.
    expect(applyTolerance(TOKENS_18, 0n)).toBe(TOKENS_18);
  });

  it("never raises the minimum above what the quote promised", () => {
    // A rounding step in the wrong direction would send a floor the market cannot
    // meet, and the trade would revert on a bound the reader chose to widen. The
    // smallest amounts are where a round-half-up would show.
    for (const quoted of [1n, 2n, 3n, 7n, 999n, ONE_USDC_6, TOKENS_18]) {
      for (const bps of [0n, 1n, 50n, 100n, 300n, 501n, 9_999n]) {
        expect(applyTolerance(quoted, bps)).toBeLessThanOrEqual(quoted);
      }
    }
    // 3 * 9900 / 10000 is 2.97 and the floor is 2, not 3.
    expect(applyTolerance(3n, 100n)).toBe(2n);
  });

  it("leaves no floor at all at the maximum", () => {
    // MAX_SLIPPAGE_BPS is the absence of a bound rather than a bound, and the file
    // says why it is still permitted.
    expect(applyTolerance(TOKENS_18, MAX_SLIPPAGE_BPS)).toBe(0n);
  });

  it("defaults to one percent", () => {
    expect(DEFAULT_SLIPPAGE_BPS).toBe(100n);
    expect(SLIPPAGE_PRESETS_BPS).toContain(DEFAULT_SLIPPAGE_BPS);
  });
});

describe("the high-tolerance gate", () => {
  it("opens above five percent and not at it", () => {
    expect(HIGH_SLIPPAGE_BPS).toBe(500n);
    // The threshold is above five percent, so five percent itself is not the warned case.
    expect(isHighSlippage(500n)).toBe(false);
    expect(isHighSlippage(501n)).toBe(true);
    expect(isHighSlippage(MAX_SLIPPAGE_BPS)).toBe(true);
  });

  it("leaves every preset below it", () => {
    for (const bps of SLIPPAGE_PRESETS_BPS) expect(isHighSlippage(bps)).toBe(false);
  });
});

describe("the tolerance field", () => {
  it("reads the values a reader can type", () => {
    expect(parseSlippagePercent("0.5")).toBe(50n);
    expect(parseSlippagePercent("1")).toBe(100n);
    expect(parseSlippagePercent("3")).toBe(300n);
    expect(parseSlippagePercent("0.05")).toBe(5n);
    expect(parseSlippagePercent("100")).toBe(MAX_SLIPPAGE_BPS);
    expect(parseSlippagePercent(" 1 ")).toBe(100n);
  });

  it("refuses anything that is not one", () => {
    // A half-typed or unparseable field must not move the number the submit control
    // carries, so each of these is null rather than a nearest reading.
    for (const text of ["", ".", "-5", "1e3", "1.234", "1000", "100.01", "0x1", "1,5"]) {
      expect(parseSlippagePercent(text)).toBeNull();
    }
  });

  it("prints a tolerance the field would read back unchanged", () => {
    for (const bps of [5n, 25n, 50n, 100n, 300n, 501n, 1_000n, MAX_SLIPPAGE_BPS]) {
      expect(parseSlippagePercent(formatSlippagePercent(bps))).toBe(bps);
    }
    expect(formatSlippagePercent(50n)).toBe("0.5");
    expect(formatSlippagePercent(100n)).toBe("1");
    expect(formatSlippagePercent(5n)).toBe("0.05");
  });
});

describe("the amount field", () => {
  it("scales what was typed without rounding it", () => {
    expect(parseAmount("1", USDC_QUOTE_DECIMALS)).toBe(ONE_USDC_6);
    expect(parseAmount("1.5", USDC_QUOTE_DECIMALS)).toBe(1_500_000n);
    // Seven decimals in a six-decimal field: the last digit is dropped, not carried.
    expect(parseAmount("1.1234567", USDC_QUOTE_DECIMALS)).toBe(1_123_456n);
    expect(parseAmount("0.0000009", USDC_QUOTE_DECIMALS)).toBe(0n);
  });

  it("accepts a field a reader is halfway through", () => {
    expect(parseAmount(".5", USDC_QUOTE_DECIMALS)).toBe(500_000n);
    expect(parseAmount("5.", USDC_QUOTE_DECIMALS)).toBe(5_000_000n);
  });

  it("refuses a field that is not an amount", () => {
    for (const text of ["", ".", "1.2.3", "abc"]) {
      expect(parseAmount(text, USDC_QUOTE_DECIMALS)).toBeNull();
    }
  });

  it("strips what a paste carries and leaves what makes a paste invalid", () => {
    expect(sanitizeAmountText("$1,234.50")).toBe("1234.50");
    // The count of points is untouched, so a pasted range is still refused rather
    // than reinterpreted as one of its ends.
    expect(sanitizeAmountText("1.2.3")).toBe("1.2.3");
    expect(parseAmount(sanitizeAmountText("1.2.3"), USDC_QUOTE_DECIMALS)).toBeNull();
  });

  it("reproduces a balance exactly, which is what Max on a sell needs", () => {
    const text = toAmountText(TOKENS_18, TOKEN_DECIMALS);
    expect(text).toBe("263138.414814066417862214");
    // A truncated round trip would leave a remainder behind and turn "sell everything"
    // into a sell of nearly everything.
    expect(parseAmount(text, TOKEN_DECIMALS)).toBe(TOKENS_18);
  });

  it("prints a whole amount without a point and a single micro with one", () => {
    expect(toAmountText(ONE_USDC_6, USDC_QUOTE_DECIMALS)).toBe("1");
    expect(toAmountText(1_500_000n, USDC_QUOTE_DECIMALS)).toBe("1.5");
    expect(toAmountText(1n, USDC_QUOTE_DECIMALS)).toBe("0.000001");
    expect(toAmountText(0n, USDC_QUOTE_DECIMALS)).toBe("0");
  });
});

describe("the deadline", () => {
  it("adds the chosen window to the chain's own second", () => {
    const chainSeconds = 1_757_000_000n;
    expect(deadlineFrom(chainSeconds, 5)).toBe(chainSeconds + 300n);
    expect(DEADLINE_PRESETS_MINUTES).toContain(DEFAULT_DEADLINE_MINUTES);
    for (const minutes of DEADLINE_PRESETS_MINUTES) {
      // Strictly ahead, so the contract's block.timestamp <= deadline is satisfiable
      // even when the next block shares this one's timestamp.
      expect(deadlineFrom(chainSeconds, minutes)).toBeGreaterThan(chainSeconds);
    }
  });
});
